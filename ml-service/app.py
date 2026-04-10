"""
Emotera AI — Real-Time Emotion Detection & Speech-to-Text ML Service
FastAPI service providing:
  1. Emotion analysis from audio streams (existing)
  2. File-based speech-to-text via OpenAI Whisper (POST /transcribe)
  3. Real-time streaming speech-to-text via WebSocket (/ws/transcribe)

Architecture:
  - Receives raw audio bytes (WAV format) from the Node.js backend
  - Extracts acoustic features using librosa (MFCC, Pitch, Energy)
  - Classifies emotion using sklearn model or heuristic classifier
  - Transcribes speech using OpenAI Whisper (base model)
  - Returns results as JSON via REST or WebSocket
"""

import io
import os
import time
import json
import asyncio
import logging
import pickle
import tempfile
from typing import Optional
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from fastapi import FastAPI, Request, HTTPException, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from suggestion_engine import get_suggestion
from emotion_expander import expand_emotion

# ─── Logging ──────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s'
)
logger = logging.getLogger("emotera-ml")

# ─── FastAPI App ──────────────────────────────────────────────
app = FastAPI(
    title="Emotera AI ML Service",
    description="Real-time emotion detection and speech-to-text from audio streams",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

# ─── Thread Pool for CPU-bound Whisper Inference ──────────────
# Whisper inference is CPU-bound; run in thread pool to avoid blocking the event loop
whisper_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="whisper")

# ─── ML Model Loading (Emotion) ──────────────────────────────
MODEL_PATH = os.path.join(os.path.dirname(__file__), "emotion_model.pkl")
trained_model = None

def load_model():
    """Attempt to load a pre-trained sklearn emotion model."""
    global trained_model
    if os.path.exists(MODEL_PATH):
        try:
            with open(MODEL_PATH, 'rb') as f:
                trained_model = pickle.load(f)
            logger.info(f"Loaded trained model from {MODEL_PATH}")
        except Exception as e:
            logger.warning(f"Failed to load model: {e}. Using heuristic classifier.")
            trained_model = None
    else:
        logger.info("No emotion_model.pkl found. Using heuristic classifier.")

load_model()

# ─── Whisper Model Loading ────────────────────────────────────
WHISPER_MODEL_SIZE = os.environ.get("WHISPER_MODEL", "base")

@app.on_event("startup")
async def startup_load_whisper():
    """Load Whisper model at application startup."""
    try:
        from whisper_engine import load_whisper_model
        # Run in thread pool since model loading is CPU-bound and slow
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            whisper_executor,
            load_whisper_model,
            WHISPER_MODEL_SIZE
        )
        logger.info(f"Whisper model '{WHISPER_MODEL_SIZE}' ready for transcription")
    except Exception as e:
        logger.error(f"Failed to load Whisper model: {e}")
        logger.warning("Speech-to-text endpoints will attempt to load model on first request")

# ─── Feature Extraction ──────────────────────────────────────
def extract_features(audio_data: np.ndarray, sr: int) -> dict:
    """
    Extract acoustic features from audio using librosa.
    Returns a dictionary of feature values and a flat feature vector.
    """
    import librosa

    features = {}
    
    # 1. MFCC (13 coefficients) — captures vocal tract shape
    mfccs = librosa.feature.mfcc(y=audio_data, sr=sr, n_mfcc=13)
    mfcc_mean = np.mean(mfccs, axis=1)
    mfcc_std = np.std(mfccs, axis=1)
    features['mfcc_mean'] = mfcc_mean.tolist()
    features['mfcc_std'] = mfcc_std.tolist()
    
    # 2. Pitch (Fundamental Frequency f0) — higher pitch may indicate stress/anger
    f0, voiced_flag, voiced_probs = librosa.pyin(
        audio_data, fmin=librosa.note_to_hz('C2'), fmax=librosa.note_to_hz('C7'), sr=sr
    )
    f0_clean = f0[~np.isnan(f0)] if f0 is not None else np.array([0])
    features['pitch_mean'] = float(np.mean(f0_clean)) if len(f0_clean) > 0 else 0.0
    features['pitch_std'] = float(np.std(f0_clean)) if len(f0_clean) > 0 else 0.0
    features['pitch_range'] = float(np.ptp(f0_clean)) if len(f0_clean) > 0 else 0.0
    
    # 3. RMS Energy — overall volume/intensity
    rms = librosa.feature.rms(y=audio_data)[0]
    features['energy_mean'] = float(np.mean(rms))
    features['energy_std'] = float(np.std(rms))
    features['energy_max'] = float(np.max(rms))
    
    # 4. Zero Crossing Rate — roughness/noisiness
    zcr = librosa.feature.zero_crossing_rate(audio_data)[0]
    features['zcr_mean'] = float(np.mean(zcr))
    
    # 5. Spectral Centroid — brightness of sound
    spectral_centroid = librosa.feature.spectral_centroid(y=audio_data, sr=sr)[0]
    features['spectral_centroid_mean'] = float(np.mean(spectral_centroid))
    
    # 6. Spectral Rolloff — frequency below which 85% of energy is concentrated
    rolloff = librosa.feature.spectral_rolloff(y=audio_data, sr=sr)[0]
    features['spectral_rolloff_mean'] = float(np.mean(rolloff))
    
    # Build flat feature vector for ML model
    feature_vector = np.concatenate([
        mfcc_mean, mfcc_std,
        [features['pitch_mean'], features['pitch_std'], features['pitch_range']],
        [features['energy_mean'], features['energy_std'], features['energy_max']],
        [features['zcr_mean'], features['spectral_centroid_mean'], features['spectral_rolloff_mean']]
    ])
    
    features['feature_vector'] = feature_vector
    return features

# ─── Heuristic Emotion Classifier ────────────────────────────
def heuristic_classify(features: dict) -> tuple:
    """
    Classify emotion based on acoustic feature thresholds.
    This is the fallback when no trained model is available.
    
    Research-backed heuristics:
    - High pitch + high energy + high ZCR → angry
    - Low pitch + low energy → sad
    - Moderate pitch + high energy + pitch variation → happy
    - Moderate everything → neutral
    """
    pitch = features['pitch_mean']
    pitch_var = features['pitch_std']
    energy = features['energy_mean']
    energy_max = features['energy_max']
    zcr = features['zcr_mean']
    spectral = features['spectral_centroid_mean']
    
    scores = {
        'angry': 0.0,
        'happy': 0.0,
        'sad': 0.0,
        'neutral': 0.0
    }
    
    # Energy-based scoring
    if energy > 0.08:
        scores['angry'] += 0.3
        scores['happy'] += 0.2
    elif energy < 0.02:
        scores['sad'] += 0.3
    else:
        scores['neutral'] += 0.2
    
    # Pitch-based scoring
    if pitch > 250:
        scores['angry'] += 0.25
        scores['happy'] += 0.15
    elif pitch < 120:
        scores['sad'] += 0.25
    else:
        scores['neutral'] += 0.2
    
    # Pitch variability
    if pitch_var > 50:
        scores['happy'] += 0.2
        scores['angry'] += 0.1
    elif pitch_var < 15:
        scores['sad'] += 0.15
        scores['neutral'] += 0.1
    
    # ZCR scoring (rough voice textures)
    if zcr > 0.1:
        scores['angry'] += 0.15
    elif zcr < 0.03:
        scores['sad'] += 0.1
    
    # Spectral brightness
    if spectral > 2000:
        scores['angry'] += 0.1
        scores['happy'] += 0.1
    
    # Normalize & pick winner
    total = sum(scores.values())
    if total > 0:
        scores = {k: v / total for k, v in scores.items()}
    
    emotion = max(scores, key=scores.get)
    confidence = round(scores[emotion] * 100, 1)
    
    return emotion, confidence

# ─── Prediction Function ─────────────────────────────────────
def predict_emotion(features: dict) -> tuple:
    """Route to trained model or heuristic classifier."""
    if trained_model is not None:
        try:
            feature_vector = features['feature_vector'].reshape(1, -1)
            emotion = trained_model.predict(feature_vector)[0]
            
            # Get confidence if model supports predict_proba
            confidence = 0.0
            if hasattr(trained_model, 'predict_proba'):
                proba = trained_model.predict_proba(feature_vector)[0]
                confidence = round(float(np.max(proba)) * 100, 1)
            else:
                confidence = 75.0
            
            return str(emotion), confidence
        except Exception as e:
            logger.warning(f"Model prediction failed: {e}. Falling back to heuristic.")
            return heuristic_classify(features)
    else:
        return heuristic_classify(features)


# ─── Helper for Bytes Emotion Analysis ─────────────────────────
def _analyze_audio_bytes(wav_bytes: bytes, transcript: str = None) -> dict:
    """Helper to extract features, predict, and expand emotion from WAV bytes."""
    import io
    import soundfile as sf
    import librosa
    
    try:
        audio_buffer = io.BytesIO(wav_bytes)
        audio_data, sr = sf.read(audio_buffer, dtype='float32')
        
        if len(audio_data.shape) > 1:
            audio_data = np.mean(audio_data, axis=1)
            
        if sr != 22050:
            audio_data = librosa.resample(audio_data, orig_sr=sr, target_sr=22050)
            sr = 22050
            
        rms = np.sqrt(np.mean(audio_data ** 2))
        if rms < 0.001:
            return {"emotion": "neutral", "base_emotion": "neutral", "confidence": 0.0}
            
        features = extract_features(audio_data, sr)
        base_emotion, confidence = predict_emotion(features)
        
        expanded = expand_emotion(
            base_emotion,
            confidence,
            features=features,
            transcript=transcript
        )
        return expanded
    except Exception as e:
        logger.error(f"Emotion analysis on transcribe failed: {e}")
        return {"emotion": "neutral", "base_emotion": "neutral", "confidence": 0.0}


# ═══════════════════════════════════════════════════════════════
#  API ENDPOINTS
# ═══════════════════════════════════════════════════════════════

# ─── Response Models ──────────────────────────────────────────

class AnalysisResult(BaseModel):
    emotion: str
    base_emotion: Optional[str] = None
    suggestion: str
    confidence: float
    timestamp: str
    processing_time_ms: float

class TranscriptionResult(BaseModel):
    text: str
    language: str
    processing_time_ms: float
    emotion: Optional[str] = None
    base_emotion: Optional[str] = None
    confidence: Optional[float] = None

# ─── Health Check ─────────────────────────────────────────────

@app.get("/health")
def health_check():
    from whisper_engine import is_model_loaded, get_model_info
    from audio_utils import check_ffmpeg
    
    whisper_info = get_model_info()
    return {
        "status": "ok",
        "service": "emotera-ml",
        "version": "2.0.0",
        "emotion_model_loaded": trained_model is not None,
        "emotion_classifier": "sklearn" if trained_model else "heuristic",
        "whisper": whisper_info,
        "ffmpeg_available": check_ffmpeg(),
    }

# ─── Emotion Analysis (existing) ─────────────────────────────

@app.post("/analyze", response_model=AnalysisResult)
async def analyze_audio(request: Request):
    """
    Analyze raw audio data and return emotion prediction.
    
    Expects:
      - Content-Type: application/octet-stream
      - Body: raw WAV audio bytes
    
    Returns:
      - emotion, suggestion, confidence, timestamp, processing_time_ms
    """
    start_time = time.time()
    
    # Read raw audio bytes
    body = await request.body()
    if len(body) < 100:
        raise HTTPException(status_code=400, detail="Audio data too small to analyze")
    
    logger.info(f"Received audio: {len(body)} bytes")
    
    try:
        import librosa
        import soundfile as sf
        
        # Load audio from bytes
        audio_buffer = io.BytesIO(body)
        audio_data, sr = sf.read(audio_buffer, dtype='float32')
        
        # Ensure mono
        if len(audio_data.shape) > 1:
            audio_data = np.mean(audio_data, axis=1)
        
        # Resample to 22050 Hz for consistent feature extraction
        if sr != 22050:
            audio_data = librosa.resample(audio_data, orig_sr=sr, target_sr=22050)
            sr = 22050
        
        # Check if audio has meaningful content (not silence)
        rms = np.sqrt(np.mean(audio_data ** 2))
        if rms < 0.001:
            logger.info("Audio chunk is silence, skipping analysis")
            return AnalysisResult(
                emotion="neutral",
                suggestion="No speech activity detected in this segment.",
                confidence=0.0,
                timestamp=time.strftime('%Y-%m-%dT%H:%M:%S'),
                processing_time_ms=round((time.time() - start_time) * 1000, 1)
            )
        
        # Extract features
        features = extract_features(audio_data, sr)
        
        # Predict base emotion
        base_emotion, confidence = predict_emotion(features)
        
        # Expand to nuanced emotion (no transcript available in /analyze)
        expanded = expand_emotion(
            base_emotion=base_emotion,
            confidence=confidence,
            features=features,
            transcript=None,
        )
        emotion = expanded["emotion"]
        confidence = expanded["confidence"]
        
        # Generate suggestion
        suggestion = get_suggestion(emotion)
        
        processing_time = round((time.time() - start_time) * 1000, 1)
        
        logger.info(f"Prediction: {base_emotion}→{emotion} ({confidence}%) in {processing_time}ms")
        
        return AnalysisResult(
            emotion=emotion,
            base_emotion=expanded["base_emotion"],
            suggestion=suggestion,
            confidence=confidence,
            timestamp=time.strftime('%Y-%m-%dT%H:%M:%S'),
            processing_time_ms=processing_time
        )
        
    except Exception as e:
        logger.error(f"Analysis failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Audio analysis failed: {str(e)}")


# ═══════════════════════════════════════════════════════════════
#  WHISPER SPEECH-TO-TEXT ENDPOINTS
# ═══════════════════════════════════════════════════════════════

# ─── Supported audio formats ─────────────────────────────────
SUPPORTED_EXTENSIONS = {"wav", "mp3", "webm", "ogg", "flac", "m4a", "aac"}

def _get_file_extension(filename: str) -> str:
    """Extract and validate file extension."""
    if not filename or "." not in filename:
        return ""
    return filename.rsplit(".", 1)[-1].lower()


# ─── REST: File Upload Transcription ─────────────────────────

@app.post("/transcribe", response_model=TranscriptionResult)
async def transcribe_audio_file(file: UploadFile = File(...)):
    """
    Transcribe an uploaded audio file using OpenAI Whisper.
    
    Accepts:
      - multipart/form-data with field name 'file'
      - Supported formats: wav, mp3, webm, ogg, flac, m4a, aac
    
    Returns:
      {
        "text": "transcribed speech",
        "language": "en",
        "processing_time_ms": 1423.5
      }
    """
    request_start = time.time()
    
    # ── Validate file ──
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="No audio file provided")
    
    ext = _get_file_extension(file.filename)
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported audio format '.{ext}'. Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}"
        )
    
    # ── Read file bytes ──
    try:
        file_bytes = await file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read uploaded file: {str(e)}")
    
    if len(file_bytes) < 100:
        raise HTTPException(status_code=400, detail="Audio file is too small or empty")
    
    logger.info(f"POST /transcribe — file: {file.filename} ({len(file_bytes)} bytes)")
    
    # ── Convert to WAV if not already ──
    try:
        from audio_utils import convert_to_wav_bytes
        
        if ext != "wav":
            logger.info(f"Converting {ext} → WAV (16kHz mono)...")
            wav_bytes = convert_to_wav_bytes(file_bytes, input_format=ext)
        else:
            # Even WAV files get normalized to 16kHz mono
            wav_bytes = convert_to_wav_bytes(file_bytes, input_format="wav")
    except RuntimeError as e:
        logger.error(f"Audio conversion failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Audio conversion failed: {str(e)}. Ensure ffmpeg is installed."
        )
    
    # ── Run Whisper transcription in thread pool ──
    try:
        from whisper_engine import transcribe_wav_bytes
        
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            whisper_executor,
            transcribe_wav_bytes,
            wav_bytes,
            None  # language=None → auto-detect
        )
    except RuntimeError as e:
        logger.error(f"Whisper transcription failed: {e}")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")
    except Exception as e:
        logger.error(f"Unexpected transcription error: {e}")
        raise HTTPException(status_code=500, detail=f"Transcription error: {str(e)}")
    
    # ── Run Emotion Analysis ──
    try:
        emotion_info = _analyze_audio_bytes(wav_bytes, transcript=result["text"])
    except Exception as e:
        logger.error(f"Emotion analysis in transcribe failed: {e}")
        emotion_info = {"emotion": "neutral", "base_emotion": "neutral", "confidence": 0.0}

    total_time = round((time.time() - request_start) * 1000, 1)
    
    logger.info(
        f"Transcription result: \"{result['text'][:80]}...\" "
        f"lang={result['language']}, total={total_time}ms"
    )
    
    return TranscriptionResult(
        text=result["text"],
        language=result["language"],
        processing_time_ms=total_time,
        emotion=emotion_info.get("emotion"),
        base_emotion=emotion_info.get("base_emotion"),
        confidence=emotion_info.get("confidence")
    )


# ─── WebSocket: Real-Time Streaming Transcription ─────────────

@app.websocket("/ws/transcribe")
async def websocket_transcribe(websocket: WebSocket):
    """
    Real-time speech-to-text via WebSocket.
    
    Protocol:
      1. Client connects to ws://localhost:5001/ws/transcribe
      2. Client sends binary audio chunks (webm/pcm, any size)
      3. Server buffers chunks into ~2-second windows
      4. Server converts buffered audio → WAV → Whisper transcription
      5. Server sends JSON results back:
         {
           "text": "partial or final transcript",
           "timestamp": "2026-04-07T18:30:00",
           "is_final": false,
           "buffer_duration_s": 2.0
         }
      6. On error: { "error": "message" }
      7. Client can send JSON control messages:
         - {"action": "stop"} — flush remaining buffer and close
         - {"action": "reset"} — clear buffer and start fresh
         - {"action": "config", "format": "webm", "sample_rate": 16000}
    """
    await websocket.accept()
    logger.info("WS /ws/transcribe — client connected")
    
    # ── Stream state ──
    audio_buffer: list[bytes] = []
    buffer_size: int = 0
    last_flush_time: float = time.time()
    total_transcribed: int = 0
    audio_format: str = "webm"  # Default format for incoming chunks
    sample_rate: int = 16000
    
    # Buffer threshold: ~2 seconds of audio
    # At 16kHz, 16-bit mono: 2s = 64,000 bytes
    # For compressed formats (webm): ~16,000-32,000 bytes per 2s
    BUFFER_THRESHOLD_BYTES = 32_000  # ~2s of compressed audio
    BUFFER_TIMEOUT_SECONDS = 3.0     # Force flush after 3s even if under threshold
    
    async def flush_buffer() -> Optional[dict]:
        """Convert buffered audio to WAV and transcribe with Whisper."""
        nonlocal audio_buffer, buffer_size, last_flush_time, total_transcribed
        
        if not audio_buffer or buffer_size == 0:
            return None
        
        # Collect all buffered chunks
        combined = b"".join(audio_buffer)
        chunk_count = len(audio_buffer)
        audio_buffer = []
        buffer_size = 0
        last_flush_time = time.time()
        
        logger.info(
            f"WS buffer flush: {chunk_count} chunks, "
            f"{len(combined)} bytes, format={audio_format}"
        )
        
        try:
            from audio_utils import convert_to_wav_bytes
            from whisper_engine import transcribe_wav_bytes
            
            # Convert to WAV
            wav_bytes = convert_to_wav_bytes(
                combined,
                input_format=audio_format,
                sample_rate=16000,
                channels=1
            )
            
            # Run Whisper in thread pool (non-blocking)
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                whisper_executor,
                transcribe_wav_bytes,
                wav_bytes,
                None
            )
            
            total_transcribed += 1
            text = result.get("text", "").strip()
            
            if text:
                logger.info(f"WS transcription #{total_transcribed}: \"{text[:60]}\"")
                
            # ── Run Emotion Analysis ──
            try:
                emotion_info = _analyze_audio_bytes(wav_bytes, transcript=text)
            except Exception as e:
                logger.error(f"WS emotion analysis failed: {e}")
                emotion_info = {"emotion": "neutral", "base_emotion": "neutral", "confidence": 0.0}
            
            return {
                "text": text,
                "language": result.get("language", "unknown"),
                "timestamp": time.strftime('%Y-%m-%dT%H:%M:%S'),
                "is_final": False,
                "buffer_duration_s": round(len(combined) / max(sample_rate * 2, 1), 2),
                "chunk_index": total_transcribed,
                "emotion": emotion_info.get("emotion"),
                "base_emotion": emotion_info.get("base_emotion"),
                "confidence": emotion_info.get("confidence")
            }
            
        except Exception as e:
            logger.error(f"WS transcription failed: {e}")
            return {"error": f"Transcription failed: {str(e)}"}
    
    try:
        while True:
            # Wait for data with a timeout to handle buffer flushing
            try:
                data = await asyncio.wait_for(
                    websocket.receive(),
                    timeout=BUFFER_TIMEOUT_SECONDS
                )
            except asyncio.TimeoutError:
                # Timeout — flush buffer if we have data
                if audio_buffer:
                    result = await flush_buffer()
                    if result:
                        await websocket.send_json(result)
                continue
            
            # ── Handle text messages (control commands) ──
            if "text" in data:
                try:
                    message = json.loads(data["text"])
                    action = message.get("action", "")
                    
                    if action == "stop":
                        # Flush remaining buffer and close
                        logger.info("WS received stop command")
                        if audio_buffer:
                            result = await flush_buffer()
                            if result:
                                result["is_final"] = True
                                await websocket.send_json(result)
                        await websocket.close()
                        break
                    
                    elif action == "reset":
                        # Clear buffer
                        audio_buffer = []
                        buffer_size = 0
                        total_transcribed = 0
                        last_flush_time = time.time()
                        logger.info("WS buffer reset")
                        await websocket.send_json({
                            "text": "",
                            "timestamp": time.strftime('%Y-%m-%dT%H:%M:%S'),
                            "is_final": False,
                            "message": "Buffer reset"
                        })
                    
                    elif action == "config":
                        # Update stream configuration
                        audio_format = message.get("format", audio_format)
                        sample_rate = message.get("sample_rate", sample_rate)
                        threshold = message.get("buffer_threshold", BUFFER_THRESHOLD_BYTES)
                        BUFFER_THRESHOLD_BYTES_LOCAL = threshold
                        logger.info(
                            f"WS config updated: format={audio_format}, "
                            f"sr={sample_rate}, threshold={threshold}"
                        )
                        await websocket.send_json({
                            "message": "Configuration updated",
                            "format": audio_format,
                            "sample_rate": sample_rate,
                        })
                    
                    else:
                        await websocket.send_json({
                            "error": f"Unknown action: {action}"
                        })
                
                except json.JSONDecodeError:
                    await websocket.send_json({
                        "error": "Invalid JSON in text message"
                    })
            
            # ── Handle binary messages (audio data) ──
            elif "bytes" in data:
                chunk = data["bytes"]
                if chunk and len(chunk) > 0:
                    audio_buffer.append(chunk)
                    buffer_size += len(chunk)
                    
                    # Check if buffer is ready to flush
                    time_since_flush = time.time() - last_flush_time
                    should_flush = (
                        buffer_size >= BUFFER_THRESHOLD_BYTES
                        or time_since_flush >= BUFFER_TIMEOUT_SECONDS
                    )
                    
                    if should_flush:
                        result = await flush_buffer()
                        if result:
                            await websocket.send_json(result)
    
    except WebSocketDisconnect:
        logger.info(
            f"WS /ws/transcribe — client disconnected "
            f"(total transcriptions: {total_transcribed})"
        )
    except Exception as e:
        logger.error(f"WS /ws/transcribe error: {e}")
        try:
            await websocket.send_json({"error": f"Server error: {str(e)}"})
            await websocket.close(code=1011)
        except Exception:
            pass
    finally:
        # Clean up buffer
        audio_buffer.clear()
        logger.info("WS /ws/transcribe — connection cleaned up")


# ─── Run with Uvicorn ─────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    logger.info("Starting Emotera AI ML Service on port 5001...")
    logger.info("Endpoints:")
    logger.info("  POST /analyze          — Emotion analysis (existing)")
    logger.info("  POST /transcribe       — File-based speech-to-text")
    logger.info("  WS   /ws/transcribe    — Real-time streaming speech-to-text")
    logger.info("  GET  /health           — Service health check")
    uvicorn.run(app, host="0.0.0.0", port=5001, log_level="info")
