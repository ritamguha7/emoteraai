import React, { useState, useEffect, useRef } from 'react';
import { Line } from 'react-chartjs-2';

export default function LiveCall() {
  const [wsStatus, setWsStatus] = useState('Disconnected');
  const [emotion, setEmotion] = useState('Waiting...');
  const [suggestion, setSuggestion] = useState('Connecting to analysis stream...');
  const [duration, setDuration] = useState(0);
  const [chartData, setChartData] = useState({
    labels: [],
    datasets: [{
      label: 'Emotion Trajectory',
      data: [],
      borderColor: '#3b82f6',
      backgroundColor: 'rgba(59,130,246,0.2)',
      borderWidth: 2,
      tension: 0.4,
      fill: true
    }]
  });

  const ws = useRef(null);
  const timerRef = useRef(null);

  const getEmotionColor = (em) => {
    switch(em.toLowerCase()) {
      case 'happy': return 'var(--warning)';
      case 'sad': return 'var(--accent-main)';
      case 'angry': return 'var(--danger)';
      case 'neutral': return 'var(--success)';
      default: return 'var(--text-sub)';
    }
  };

  const getEmotionScore = (em) => {
    switch(em.toLowerCase()) {
      case 'happy': return 100;
      case 'neutral': return 75;
      case 'sad': return 50;
      case 'angry': return 25;
      default: return 75; // Default middle
    }
  };

  const getEmotionEmoji = (em) => {
     switch(em.toLowerCase()) {
      case 'happy': return '😊';
      case 'sad': return '😔';
      case 'angry': return '😠';
      case 'neutral': return '😐';
      default: return '⏳';
     }
  };

  useEffect(() => {
    // Initialize WebSocket
    const connectWs = () => {
      setWsStatus('Connecting...');
      ws.current = new WebSocket('ws://localhost:8080');

      ws.current.onopen = () => {
        setWsStatus('Connected');
        setSuggestion('Stream active. Awaiting data...');
        timerRef.current = setInterval(() => {
          setDuration(prev => prev + 1);
        }, 1000);
      };

      ws.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.emotion) {
            setEmotion(data.emotion);
            setChartData(prev => {
              const newLabels = [...prev.labels, new Date().toLocaleTimeString()];
              const newData = [...prev.datasets[0].data, getEmotionScore(data.emotion)];
              if (newLabels.length > 20) { 
                newLabels.shift(); 
                newData.shift(); 
              }
              return { 
                labels: newLabels, 
                datasets: [{ ...prev.datasets[0], data: newData }] 
              };
            });
          }
          if (data.suggestion) {
            setSuggestion(data.suggestion);
          }
        } catch(err) {
          console.error("Failed to parse websocket message", err);
        }
      };

      ws.current.onclose = () => {
        setWsStatus('Disconnected');
        setEmotion('Waiting...');
        setSuggestion('Connection lost. Waiting for data...');
        clearInterval(timerRef.current);
        // Attempt reconnect
        setTimeout(connectWs, 3000);
      };
      
      ws.current.onerror = (err) => {
        console.error('WebSocket Error:', err);
        ws.current.close();
      }
    };

    connectWs();

    return () => {
      if (ws.current) {
        ws.current.close();
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="animate-fade">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h2 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Live Call Analysis</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ 
              display: 'inline-block', 
              width: '10px', 
              height: '10px', 
              borderRadius: '50%', 
              background: wsStatus === 'Connected' ? 'var(--success)' : 'var(--danger)',
              boxShadow: wsStatus === 'Connected' ? '0 0 10px var(--success)' : 'none'
            }}></span>
            <span style={{ color: 'var(--text-sub)' }}>{wsStatus}</span>
          </div>
        </div>
        <div className="glass-card" style={{ padding: '1rem 2rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Call Duration</div>
          <div style={{ fontSize: '2rem', fontWeight: 700, fontFamily: 'monospace' }}>{formatTime(duration)}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', marginBottom: '2rem' }}>
        
        {/* Emotion Card */}
        <div className="glass-card" style={{ padding: '2rem', textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <h3 style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>Current Emotion</h3>
          <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>{getEmotionEmoji(emotion)}</div>
          <div style={{ 
            fontSize: '2rem', 
            fontWeight: 'bold', 
            textTransform: 'uppercase', 
            color: getEmotionColor(emotion),
            textShadow: `0 0 20px ${getEmotionColor(emotion)}40`
          }}>
            {emotion}
          </div>
        </div>

        {/* Suggestion Panel */}
        <div className="glass-card" style={{ padding: '2rem', background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.2)' }}>
          <h3 style={{ color: 'var(--accent-main)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>🤖</span> AI Suggestion
          </h3>
          <div style={{ fontSize: '1.2rem', lineHeight: '1.6', color: 'var(--text-main)', fontStyle: 'italic' }}>
            "{suggestion}"
          </div>
        </div>
      </div>

      {/* Trajectory Graph */}
      <div className="glass-card" style={{ padding: '2rem' }}>
        <h3 style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between' }}>
          <span>Emotion Trajectory</span>
          {wsStatus === 'Connected' && (
            <div style={{ display: 'flex', gap: '0.2rem', alignItems: 'center' }}>
              <div style={{ width: '3px', height: '10px', background: 'var(--accent-main)', animation: 'pulse 1s infinite alternate', animationDelay: '0s' }}></div>
              <div style={{ width: '3px', height: '15px', background: 'var(--accent-main)', animation: 'pulse 1s infinite alternate', animationDelay: '0.2s' }}></div>
              <div style={{ width: '3px', height: '8px', background: 'var(--accent-main)', animation: 'pulse 1s infinite alternate', animationDelay: '0.4s' }}></div>
            </div>
          )}
        </h3>
        <div style={{ height: '300px', width: '100%' }}>
          <Line 
            data={chartData} 
            options={{ 
              responsive: true, 
              maintainAspectRatio: false,
              animation: { duration: 0 },
              scales: { 
                y: { 
                  display: true, 
                  min: 0, 
                  max: 120,
                  ticks: {
                    callback: function(value) {
                      if (value === 25) return 'Angry';
                      if (value === 50) return 'Sad';
                      if (value === 75) return 'Neutral';
                      if (value === 100) return 'Happy';
                      return '';
                    }
                  }
                },
                x: { display: true }
              },
              plugins: { 
                legend: { display: false }
              }
            }} 
          />
        </div>
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes pulse {
          0% { height: 5px; opacity: 0.5; }
          100% { height: 20px; opacity: 1; }
        }
      `}} />
    </div>
  );
}
