import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// ─── Configuration ───────────────────────────────────────────
const PORT = process.env.PORT || 8080;
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:5001';
const AUDIO_BUFFER_DURATION_MS = 2000; // 2-second audio windows

// ─── Express App ─────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Health Check ────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'emotera-backend',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ─── Twilio Voice Webhook ────────────────────────────────────
// When Twilio receives a call, it hits this endpoint.
// We return TwiML that tells Twilio to stream audio to our WebSocket.
app.post('/voice', (req, res) => {
  const host = req.headers.host;
  const protocol = req.secure ? 'wss' : 'ws';
  
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Welcome to Emotera AI emotion analysis. This call is being analyzed in real time.</Say>
  <Connect>
    <Stream url="${protocol}://${host}/twilio-stream" />
  </Connect>
  <Pause length="3600"/>
</Response>`;

  res.type('text/xml');
  res.send(twiml);
  log('TWILIO', 'Voice webhook triggered, streaming started');
});

// ─── HTTP Server + WebSocket ─────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Track connected frontend clients vs Twilio streams
const frontendClients = new Set();
const twilioStreams = new Map();

// ─── Structured Logging ─────────────────────────────────────
function log(category, message, data = null) {
  const entry = {
    timestamp: new Date().toISOString(),
    category,
    message,
    ...(data && { data })
  };
  console.log(JSON.stringify(entry));
}

// ─── Broadcast to All Frontend Clients ───────────────────────
function broadcastToFrontend(payload) {
  const message = JSON.stringify(payload);
  for (const client of frontendClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// ─── Send Audio to ML Service for Analysis ───────────────────
async function analyzeAudio(audioBuffer) {
  try {
    const response = await axios.post(`${ML_SERVICE_URL}/analyze`, audioBuffer, {
      headers: { 'Content-Type': 'application/octet-stream' },
      timeout: 5000,
      responseType: 'json'
    });

    const result = {
      emotion: response.data.emotion || 'neutral',
      suggestion: response.data.suggestion || 'Continue monitoring.',
      confidence: response.data.confidence || 0,
      timestamp: new Date().toISOString()
    };

    log('PREDICTION', `Emotion: ${result.emotion} (${result.confidence}%)`, result);
    broadcastToFrontend(result);
    return result;

  } catch (error) {
    log('ERROR', `ML Service call failed: ${error.message}`);
    
    // Fallback: send a "processing" status so the UI doesn't hang
    broadcastToFrontend({
      emotion: 'neutral',
      suggestion: 'Processing audio stream...',
      confidence: 0,
      timestamp: new Date().toISOString()
    });
    return null;
  }
}

// ─── μ-law Decode (Twilio sends audio in μ-law format) ───────
function mulawDecode(mulawByte) {
  const MULAW_BIAS = 33;
  let sign, exponent, mantissa, sample;
  
  mulawByte = ~mulawByte & 0xFF;
  sign = (mulawByte & 0x80);
  exponent = (mulawByte >> 4) & 0x07;
  mantissa = mulawByte & 0x0F;
  sample = (mantissa << (exponent + 3)) + MULAW_BIAS;
  sample = sample << (exponent);
  
  if (sign !== 0) sample = -sample;
  return sample;
}

function decodeMulawBuffer(mulawBuffer) {
  const pcmBuffer = Buffer.alloc(mulawBuffer.length * 2);
  for (let i = 0; i < mulawBuffer.length; i++) {
    const sample = mulawDecode(mulawBuffer[i]);
    pcmBuffer.writeInt16LE(sample, i * 2);
  }
  return pcmBuffer;
}

// ─── Create WAV Header ───────────────────────────────────────
function createWavBuffer(pcmData, sampleRate = 8000, numChannels = 1, bitsPerSample = 16) {
  const dataSize = pcmData.length;
  const buffer = Buffer.alloc(44 + dataSize);
  
  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  
  // fmt sub-chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);                    // Sub-chunk size
  buffer.writeUInt16LE(1, 20);                     // PCM format
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * bitsPerSample / 8, 28);
  buffer.writeUInt16LE(numChannels * bitsPerSample / 8, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  
  // data sub-chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcmData.copy(buffer, 44);
  
  return buffer;
}

// ─── WebSocket Connection Handler ────────────────────────────
wss.on('connection', (ws, req) => {
  const url = req.url || '/';
  
  // ── Twilio Stream Connection ──
  if (url.includes('twilio-stream')) {
    log('TWILIO', 'Twilio audio stream connected');
    
    const streamState = {
      streamSid: null,
      audioBuffer: Buffer.alloc(0),
      lastFlush: Date.now(),
      chunkCount: 0
    };
    
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        switch (data.event) {
          case 'connected':
            log('TWILIO', 'Stream connected', { protocol: data.protocol });
            break;
            
          case 'start':
            streamState.streamSid = data.start?.streamSid;
            log('TWILIO', `Stream started: ${streamState.streamSid}`, {
              tracks: data.start?.tracks,
              mediaFormat: data.start?.mediaFormat
            });
            break;
            
          case 'media':
            // Decode base64 μ-law audio payload from Twilio
            const audioChunk = Buffer.from(data.media.payload, 'base64');
            const pcmChunk = decodeMulawBuffer(audioChunk);
            streamState.audioBuffer = Buffer.concat([streamState.audioBuffer, pcmChunk]);
            streamState.chunkCount++;
            
            // Flush buffer every AUDIO_BUFFER_DURATION_MS
            const now = Date.now();
            if (now - streamState.lastFlush >= AUDIO_BUFFER_DURATION_MS && streamState.audioBuffer.length > 0) {
              const wavBuffer = createWavBuffer(streamState.audioBuffer);
              streamState.audioBuffer = Buffer.alloc(0);
              streamState.lastFlush = now;
              
              log('AUDIO', `Flushing ${streamState.chunkCount} chunks (${wavBuffer.length} bytes)`);
              streamState.chunkCount = 0;
              
              // Send to ML service asynchronously
              analyzeAudio(wavBuffer);
            }
            break;
            
          case 'stop':
            log('TWILIO', 'Stream stopped');
            break;
        }
      } catch (err) {
        log('ERROR', `Failed to process Twilio message: ${err.message}`);
      }
    });
    
    ws.on('close', () => {
      log('TWILIO', 'Twilio stream disconnected');
    });
    
    ws.on('error', (err) => {
      log('ERROR', `Twilio WebSocket error: ${err.message}`);
    });
    
  // ── Frontend Dashboard Connection ──
  } else {
    log('FRONTEND', 'Dashboard client connected');
    frontendClients.add(ws);
    
    // Send initial status
    ws.send(JSON.stringify({
      emotion: 'neutral',
      suggestion: 'Connected to Emotera AI backend. Waiting for audio stream...',
      confidence: 0,
      timestamp: new Date().toISOString()
    }));
    
    ws.on('close', () => {
      frontendClients.delete(ws);
      log('FRONTEND', 'Dashboard client disconnected');
    });
    
    ws.on('error', (err) => {
      frontendClients.delete(ws);
      log('ERROR', `Frontend WebSocket error: ${err.message}`);
    });
  }
});

// ─── Graceful Shutdown ───────────────────────────────────────
process.on('SIGINT', () => {
  log('SERVER', 'Shutting down gracefully...');
  wss.clients.forEach(client => client.close());
  server.close(() => {
    log('SERVER', 'Server closed');
    process.exit(0);
  });
});

// ─── Start Server ────────────────────────────────────────────
server.listen(PORT, () => {
  log('SERVER', `Emotera AI Backend running on port ${PORT}`);
  log('SERVER', `WebSocket: ws://localhost:${PORT}`);
  log('SERVER', `Twilio Webhook: http://localhost:${PORT}/voice`);
  log('SERVER', `Health Check: http://localhost:${PORT}/health`);
  log('SERVER', `ML Service target: ${ML_SERVICE_URL}`);
});
