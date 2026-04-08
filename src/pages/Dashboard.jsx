import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Line } from 'react-chartjs-2';
import 'chart.js/auto'; // Register chartjs elements
import { auth, db } from '../firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, collection, addDoc, serverTimestamp, query, where, orderBy, onSnapshot, updateDoc, deleteDoc } from 'firebase/firestore';
import { countryCodes } from '../data/countryCodes';
import LiveCall from '../components/LiveCall';

export default function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState('User');
  const [currentView, setCurrentView] = useState('dashboard'); // 'dashboard' | 'history' | 'profile' | 'about'

  const [uploadFile, setUploadFile] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState({});
  const [uploadHistory, setUploadHistory] = useState([]);

  const [isRecording, setIsRecording] = useState(false);
  const [isAnalyzingFile, setIsAnalyzingFile] = useState(false);
  const [emotion, setEmotion] = useState('NEUTRAL');

  const [isEditingPhone, setIsEditingPhone] = useState(false);
  const [editCountryCode, setEditCountryCode] = useState('+91');
  const [editPhone, setEditPhone] = useState('');

  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState('');
  const [confidence, setConfidence] = useState(0);
  const [samples, setSamples] = useState(0);
  const [timer, setTimer] = useState(0);
  const [history, setHistory] = useState([]);
  
  // Real or stub chart data
  const [chartData, setChartData] = useState({
    labels: [],
    datasets: [{
      label: 'Emotion Confidence',
      data: [],
      borderColor: 'rgb(59,130,246)',
      backgroundColor: 'rgba(59,130,246, 0.2)',
      tension: 0.4,
      fill: true
    }]
  });

  const intervalRef = useRef(null);
  const timerRef = useRef(null);
  const streamRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [micError, setMicError] = useState(null);

  useEffect(() => {
    let unsubSnaps = () => {};

    const unsubAuth = onAuthStateChanged(auth, async (fbUser) => {
      const demoUser = localStorage.getItem('emoteraUser');
      if (fbUser) {
        setCurrentUser(fbUser);
        const userDoc = await getDoc(doc(db, "users", fbUser.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          setUserProfile(data);
          setUser(data.name || fbUser.email);
        } else {
          setUser(fbUser.email);
          setUserProfile({ email: fbUser.email });
        }
        
        // Subscription to history
        const q = query(
           collection(db, "uploads"),
           where("userId", "==", fbUser.uid)
        );
        unsubSnaps = onSnapshot(q, (snapshot) => {
           const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
           docs.sort((a, b) => {
             const ta = a.timestamp?.toDate?.() || new Date(0);
             const tb = b.timestamp?.toDate?.() || new Date(0);
             return tb - ta;
           });
           setUploadHistory(docs);
        }, (err) => {
           console.error('History snapshot error:', err);
        });
        
      } else if (demoUser === 'Demo User') {
        setUser('Demo User');
        setCurrentUser(null);
        setUserProfile({});
      } else {
        navigate('/login');
      }
    });

    // Cleanup on unmount
    return () => {
      unsubAuth();
      unsubSnaps();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      cancelAnimationFrame(animFrameRef.current);
      clearInterval(intervalRef.current);
      clearInterval(timerRef.current);
    };
  }, [navigate]);

  const handleLogout = () => {
    signOut(auth).then(() => {
      localStorage.removeItem('emoteraUser');
      navigate('/login');
    });
  };

  const handleUpdatePhone = async () => {
    if (!currentUser || !editPhone) return;
    if (editPhone.length < 8 || editPhone.length > 12) {
      alert("Phone number must be between 8 and 12 digits.");
      return;
    }
    try {
      await updateDoc(doc(db, "users", currentUser.uid), {
        phoneNumber: `${editCountryCode}${editPhone}`,
        countryCode: editCountryCode
      });
      setUserProfile(prev => ({ ...prev, phoneNumber: `${editCountryCode}${editPhone}`, countryCode: editCountryCode }));
      setIsEditingPhone(false);
    } catch (err) {
      console.error("Failed to update phone", err);
      alert("Failed to update phone number.");
    }
  };

  const handleUpdateName = async () => {
    if (!currentUser || !editName.trim()) return;
    try {
      await updateDoc(doc(db, "users", currentUser.uid), {
        name: editName.trim()
      });
      setUserProfile(prev => ({ ...prev, name: editName.trim() }));
      setUser(editName.trim());
      setIsEditingName(false);
    } catch (err) {
      console.error("Failed to update name", err);
      alert("Failed to update username.");
    }
  };

  const getRandomEmotion = () => {
    const emotions = ['NEUTRAL', 'HAPPY', 'SAD', 'ANGRY'];
    return emotions[Math.floor(Math.random() * emotions.length)];
  };

  // Monitor live audio level from analyser
  const monitorAudio = () => {
    if (!analyserRef.current) return;
    const dataArray = new Uint8Array(analyserRef.current.fftSize);
    const tick = () => {
      analyserRef.current.getByteTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const v = (dataArray[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      setAudioLevel(Math.min(1, rms * 3)); // Normalize 0-1
      animFrameRef.current = requestAnimationFrame(tick);
    };
    tick();
  };

  const startRecording = async () => {
    setMicError(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Browser is blocking microphone access. This usually happens if you are not using localhost or HTTPS.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Set up Web Audio analyser for live level metering
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      setIsRecording(true);
      setTimer(0);
      setSamples(0);

      // Start level monitor
      monitorAudio();

      // Timer
      timerRef.current = setInterval(() => {
        setTimer(prev => prev + 1);
      }, 1000);

      // Stub emotion analysis every 2s (replace with real ML model later)
      intervalRef.current = setInterval(() => {
        const em = getRandomEmotion();
        const conf = Math.floor(Math.random() * 30 + 70);
        setEmotion(em);
        setConfidence(conf);
        setSamples(s => s + 1);

        setHistory(prev => {
          const newHist = [{ em, conf, time: new Date().toLocaleTimeString() }, ...prev];
          return newHist.slice(0, 5);
        });

        setChartData(prev => {
          const newLabels = [...prev.labels, new Date().toLocaleTimeString()];
          const newData = [...prev.datasets[0].data, conf];
          if (newLabels.length > 10) { newLabels.shift(); newData.shift(); }
          return { labels: newLabels, datasets: [{ ...prev.datasets[0], data: newData }] };
        });
      }, 2000);

    } catch (err) {
      console.error('Mic error details:', err);
      
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setMicError('Microphone access is blocked! Please click the lock 🔒 icon in your browser address bar to allow permissions, or check your Mac System Settings > Privacy > Microphone.');
      } else if (err.name === 'NotFoundError') {
        setMicError('No microphone could be found connected to this device.');
      } else {
        setMicError(err.message || 'Unknown microphone error occurred.');
      }
    }
  };

  const stopRecording = async () => {
    setIsRecording(false);
    setAudioLevel(0);
    clearInterval(intervalRef.current);
    clearInterval(timerRef.current);
    cancelAnimationFrame(animFrameRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (currentUser && samples > 0) {
      try {
        await addDoc(collection(db, "uploads"), {
           userId: currentUser.uid,
           fileName: `🎤 Live Mic Recording (${timer}s)`,
           timestamp: serverTimestamp()
        });
      } catch (err) {
        console.error("Error saving recording:", err);
      }
    }
  };

  const startFileAnalysis = () => {
    setIsAnalyzingFile(true);
    setTimer(0);
    setSamples(0);

    // Timer
    timerRef.current = setInterval(() => {
      setTimer(prev => prev + 1);
    }, 1000);

    // File analysis interval (1s for speedier feel than mic)
    intervalRef.current = setInterval(() => {
      const em = getRandomEmotion();
      const conf = Math.floor(Math.random() * 30 + 70);
      setEmotion(em);
      setConfidence(conf);
      setSamples(s => s + 1);

      setHistory(prev => {
        const newHist = [{ em, conf, time: new Date().toLocaleTimeString() }, ...prev];
        return newHist.slice(0, 5);
      });

      setChartData(prev => {
        const newLabels = [...prev.labels, new Date().toLocaleTimeString()];
        const newData = [...prev.datasets[0].data, conf];
        if (newLabels.length > 10) { newLabels.shift(); newData.shift(); }
        return { labels: newLabels, datasets: [{ ...prev.datasets[0], data: newData }] };
      });
    }, 1500);
  };

  const stopFileAnalysis = async () => {
    setIsAnalyzingFile(false);
    clearInterval(intervalRef.current);
    clearInterval(timerRef.current);
    if (currentUser && uploadFile) {
      try {
        await addDoc(collection(db, "uploads"), {
           userId: currentUser.uid,
           fileName: `📁 ${uploadFile.name} (${timer}s analysis)`,
           timestamp: serverTimestamp()
        });
      } catch (err) {
        console.error("Error saving file analysis:", err);
      }
    }
  };

  const processFile = async (file) => {
    if (!file) return;
    
    if (file.type !== 'audio/mpeg' && !file.name.toLowerCase().endsWith('.mp3')) {
      setUploadError("Invalid file type. Only strictly .mp3 files are allowed.");
      setUploadFile(null);
      return;
    }
    
    setUploadError(null);
    setUploadFile(file);
  };

  const deleteSession = async (id) => {
    if (!window.confirm("Delete this session record?")) return;
    try {
      await deleteDoc(doc(db, "uploads", id));
    } catch (err) {
      console.error("Failed to delete session", err);
    }
  };

  const clearHistory = async () => {
    if (!uploadHistory.length) return;
    if (!window.confirm("Are you sure you want to clear your entire history?")) return;
    try {
      await Promise.all(uploadHistory.map(session => deleteDoc(doc(db, "uploads", session.id))));
    } catch (err) {
      console.error("Failed to clear history", err);
    }
  };

  const handleFileChange = async (e) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const getEmotionColor = (em) => {
    switch(em) {
      case 'HAPPY': return 'var(--warning)';
      case 'SAD': return 'var(--accent-main)';
      case 'ANGRY': return 'var(--danger)';
      default: return 'var(--text-sub)';
    }
  };

  // Mock historical sessions
  const mockHistoricalSessions = [];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-gradient)' }}>
      {/* Sidebar */}
      <nav style={{ width: '260px', background: 'var(--bg-secondary)', borderRight: '1px solid var(--glass-border)', padding: '2rem 0' }}>
        <div style={{ padding: '0 1.5rem 2rem', borderBottom: '1px solid var(--glass-border)', marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img src="/logo.png" alt="Logo" style={{ height: '32px', objectFit: 'contain' }} />
          <h2 className="gradient-text" style={{ fontSize: '1.5rem', margin: 0 }}>Emotera AI</h2>
        </div>
        <ul style={{ listStyle: 'none', padding: '0 1rem' }}>
          <li style={{ marginBottom: '0.5rem' }}>
            <button 
              onClick={() => setCurrentView('dashboard')}
              style={{ width: '100%', textAlign: 'left', display: 'block', padding: '1rem', border: 'none', cursor: 'pointer', fontSize: '1rem', 
                color: currentView === 'dashboard' ? 'var(--accent-main)' : 'var(--text-sub)', 
                background: currentView === 'dashboard' ? 'var(--glass-bg)' : 'transparent', 
                borderLeft: currentView === 'dashboard' ? '3px solid var(--accent-main)' : '3px solid transparent', 
                borderRadius: '4px' 
              }}>
              Dashboard
            </button>
          </li>
          <li>
            <button 
              onClick={() => setCurrentView('history')}
              style={{ width: '100%', textAlign: 'left', display: 'block', padding: '1rem', border: 'none', cursor: 'pointer', fontSize: '1rem', 
                color: currentView === 'history' ? 'var(--accent-main)' : 'var(--text-sub)', 
                background: currentView === 'history' ? 'var(--glass-bg)' : 'transparent', 
                borderLeft: currentView === 'history' ? '3px solid var(--accent-main)' : '3px solid transparent', 
                borderRadius: '4px',
                marginBottom: '0.5rem'
              }}>
              History
            </button>
          </li>
          <li style={{ marginBottom: '0.5rem' }}>
            <button 
              onClick={() => setCurrentView('profile')}
              style={{ width: '100%', textAlign: 'left', display: 'block', padding: '1rem', border: 'none', cursor: 'pointer', fontSize: '1rem', 
                color: currentView === 'profile' ? 'var(--accent-main)' : 'var(--text-sub)', 
                background: currentView === 'profile' ? 'var(--glass-bg)' : 'transparent', 
                borderLeft: currentView === 'profile' ? '3px solid var(--accent-main)' : '3px solid transparent', 
                borderRadius: '4px' 
              }}>
              Profile
            </button>
          </li>
          <li style={{ marginBottom: '0.5rem' }}>
            <button 
              onClick={() => setCurrentView('live')}
              style={{ width: '100%', textAlign: 'left', display: 'block', padding: '1rem', border: 'none', cursor: 'pointer', fontSize: '1rem', 
                color: currentView === 'live' ? 'var(--accent-main)' : 'var(--text-sub)', 
                background: currentView === 'live' ? 'var(--glass-bg)' : 'transparent', 
                borderLeft: currentView === 'live' ? '3px solid var(--accent-main)' : '3px solid transparent', 
                borderRadius: '4px' 
              }}>
              Live WebSocket
            </button>
          </li>
          <li>
            <button 
              onClick={() => setCurrentView('about')}
              style={{ width: '100%', textAlign: 'left', display: 'block', padding: '1rem', border: 'none', cursor: 'pointer', fontSize: '1rem', 
                color: currentView === 'about' ? 'var(--accent-main)' : 'var(--text-sub)', 
                background: currentView === 'about' ? 'var(--glass-bg)' : 'transparent', 
                borderLeft: currentView === 'about' ? '3px solid var(--accent-main)' : '3px solid transparent', 
                borderRadius: '4px' 
              }}>
              About Us
            </button>
          </li>
        </ul>
      </nav>

      {/* Main content */}
      <main style={{ flex: 1, padding: '2rem' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid var(--glass-border)' }}>
          <div className="animate-fade">
            <h2 style={{ fontSize: '2.5rem', fontWeight: 800 }}>
              {currentView === 'dashboard' && 'Emotion Analysis'}
              {currentView === 'history' && 'Session History'}
              {currentView === 'profile' && 'User Profile'}
              {currentView === 'about' && 'About Emotera AI'}
            </h2>
            <p style={{ color: 'var(--text-sub)' }}>
              {currentView === 'dashboard' && 'Live voice emotion detection'}
              {currentView === 'history' && 'Review your past emotional analysis sessions'}
              {currentView === 'profile' && 'Manage your account details'}
              {currentView === 'about' && 'Learn more about our intelligent system'}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontWeight: 500 }}>{user}</span>
            <button className="btn-secondary" onClick={handleLogout} style={{ padding: '0.5rem 1rem', width: 'auto' }}>
              Logout
            </button>
          </div>
        </header>

        {currentView === 'dashboard' ? (
          <>
            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem', marginBottom: '2.5rem' }}>
              <div className="glass-card animate-fade" style={{ animationDelay: '0.1s' }}>
                <div style={{ color: getEmotionColor(emotion), fontSize: '2.5rem', fontWeight: 700 }}>{emotion}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase' }}>Current Emotion</div>
              </div>
              <div className="glass-card animate-fade" style={{ animationDelay: '0.2s' }}>
                <div style={{ fontSize: '2.5rem', fontWeight: 700 }}>{confidence}%</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase' }}>Accuracy</div>
              </div>
              <div className="glass-card animate-fade" style={{ animationDelay: '0.3s' }}>
                <div style={{ fontSize: '2.5rem', fontWeight: 700, color: isRecording ? 'var(--accent-main)' : 'var(--text-primary)' }}>
                  {formatTime(timer)}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase' }}>Recording Time</div>
              </div>
              <div className="glass-card animate-fade" style={{ animationDelay: '0.4s' }}>
                <div style={{ fontSize: '2.5rem', fontWeight: 700 }}>{samples}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase' }}>Samples</div>
              </div>
            </div>

            {/* Chart & History */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem', marginBottom: '2.5rem' }}>
              <div className="glass-card animate-fade" style={{ animationDelay: '0.5s' }}>
                <h3 style={{ marginBottom: '1.5rem' }}>Emotion Trends</h3>
                <div style={{ height: '300px' }}>
                  <Line 
                    data={chartData} 
                    options={{ 
                      responsive: true, maintainAspectRatio: false,
                      scales: { 
                        y: { beginAtZero: true, max: 100, grid: { color: 'rgba(255,255,255,0.05)' } },
                        x: { grid: { color: 'rgba(255,255,255,0.05)' } }
                      },
                      plugins: { legend: { display: false } }
                    }} 
                  />
                </div>
              </div>
              <div className="glass-card animate-fade" style={{ animationDelay: '0.6s' }}>
                <h3 style={{ marginBottom: '1.5rem' }}>Recent Detections ({history.length})</h3>
                <ul style={{ listStyle: 'none' }}>
                  {history.length === 0 ? (
                    <li style={{ padding: '1rem', color: 'var(--text-muted)', textAlign: 'center' }}>No data yet.</li>
                  ) : (
                    history.map((h, i) => (
                      <li key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem', borderBottom: i < history.length - 1 ? '1px solid var(--glass-border)' : 'none', borderLeft: `3px solid ${getEmotionColor(h.em)}`, backgroundColor: 'var(--glass-bg)', marginBottom: '0.5rem', borderRadius: '4px' }}>
                        <span style={{ fontWeight: 600 }}>{h.em}</span>
                        <span style={{ color: 'var(--text-sub)' }}>{h.conf}%</span>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>

            {/* Controls */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
              {micError && (
                <div style={{ padding: '1rem', borderRadius: 'var(--radius-sm)', borderLeft: '4px solid var(--danger)', backgroundColor: 'rgba(239,68,68,0.1)', color: 'var(--danger)', maxWidth: '500px', width: '100%', textAlign: 'center' }}>
                  {micError}
                </div>
              )}

              {isRecording && (
                <div style={{ width: '300px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Mic Level</div>
                  <div style={{ height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${audioLevel * 100}%`, background: audioLevel > 0.6 ? 'var(--danger)' : 'var(--accent-main)', borderRadius: '4px', transition: 'width 0.1s ease' }}></div>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '1.5rem' }}>
                {!isRecording ? (
                  <button className="btn-primary animate-fade" onClick={startRecording} style={{ width: '250px', fontSize: '1.1rem', boxShadow: '0 0 20px rgba(59,130,246,0.5)' }}>
                    Start Recording
                  </button>
                ) : (
                  <button className="btn-primary animate-fade" onClick={stopRecording} style={{ width: '250px', fontSize: '1.1rem', background: 'var(--danger)', boxShadow: '0 0 20px rgba(239,68,68,0.5)' }}>
                    Stop Recording
                  </button>
                )}
              </div>

              {/* File Upload Section */}
              <div 
                className="glass-card animate-fade" 
                style={{ width: '100%', maxWidth: '600px', marginTop: '2rem', textAlign: 'center', borderStyle: 'dashed', borderWidth: '2px', borderColor: 'var(--glass-border)', cursor: 'pointer' }}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onClick={() => document.getElementById('audio-upload').click()}
              >
                <input 
                  type="file" 
                  id="audio-upload" 
                  accept=".mp3,audio/mpeg" 
                  style={{ display: 'none' }} 
                  onChange={handleFileChange}
                />
                <div style={{ fontSize: '2rem', marginBottom: '1rem', color: 'var(--accent-main)' }}>📁</div>
                <h4 style={{ marginBottom: '0.5rem' }}>Drag & Drop your audio file here</h4>
                <p style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.9rem' }}>Accepts strictly .mp3 formats</p>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <button className="btn-secondary" style={{ width: 'auto', padding: '0.75rem 1.5rem' }} onClick={(e) => { e.stopPropagation(); document.getElementById('audio-upload').click(); }}>
                    Choose File
                  </button>
                </div>
                {uploadError && (
                  <div style={{ marginTop: '1.5rem', padding: '0.75rem', background: 'rgba(239,68,68,0.1)', border: '1px solid var(--danger)', borderRadius: '4px', color: 'var(--danger)', fontSize: '0.9rem' }}>
                    {uploadError}
                  </div>
                )}
                {uploadFile && !uploadError && (
                  <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center' }}>
                    <div style={{ padding: '0.75rem 1.5rem', width: '100%', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ color: 'var(--success)' }}>✓</span> 
                        <span style={{ wordBreak: 'break-all' }}>{uploadFile.name}</span>
                      </div>
                      <button 
                        className="btn-secondary" 
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          setUploadFile(null); 
                          if (isAnalyzingFile) stopFileAnalysis(); 
                        }} 
                        style={{ padding: '0.2rem 0.6rem', fontSize: '0.9rem', width: 'auto', background: 'transparent', color: 'var(--danger)', borderColor: 'var(--danger)' }}
                        title="Remove file"
                      >
                        ✕
                      </button>
                    </div>
                    {!isAnalyzingFile ? (
                      <button 
                        className="btn-primary animate-fade" 
                        onClick={(e) => { e.stopPropagation(); startFileAnalysis(); }} 
                        style={{ width: 'auto', padding: '0.75rem 2.5rem', boxShadow: '0 0 20px rgba(59,130,246,0.5)' }}
                      >
                        Generate Analysis
                      </button>
                    ) : (
                      <button 
                        className="btn-primary animate-fade" 
                        onClick={(e) => { e.stopPropagation(); stopFileAnalysis(); }} 
                        style={{ width: 'auto', padding: '0.75rem 2.5rem', background: 'var(--danger)', boxShadow: '0 0 20px rgba(239,68,68,0.5)' }}
                      >
                        Stop Generating
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : currentView === 'history' ? (
          <div className="glass-card animate-fade" style={{ animationDelay: '0.1s' }}>
             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '1rem' }}>
               <h3 style={{ fontSize: '1.5rem', margin: 0 }}>Overall Session Logs</h3>
               {uploadHistory.length > 0 && (
                 <button className="btn-secondary" onClick={clearHistory} style={{ padding: '0.4rem 1rem', fontSize: '0.9rem', width: 'auto', background: 'var(--danger)', color: 'white', borderColor: 'var(--danger)' }}>
                   Clear History
                 </button>
               )}
             </div>
             <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {uploadHistory.length === 0 ? (
                  <div style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px dashed var(--glass-border)' }}>
                    No historical sessions found. Complete a recording to see it here!
                  </div>
                ) : (
                  uploadHistory.map(session => {
                    const dateObj = session.timestamp ? session.timestamp.toDate() : new Date();
                    return (
                      <div key={session.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)', borderRadius: '8px', borderLeft: `4px solid var(--accent-main)` }}>
                        <div>
                          <div style={{ fontWeight: 'bold', fontSize: '1.1rem', marginBottom: '0.25rem' }}>{session.fileName}</div>
                          <div style={{ color: 'var(--text-muted)' }}>Date: {dateObj.toLocaleDateString()} at {dateObj.toLocaleTimeString()}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                          <span style={{ color: 'var(--accent-main)', fontWeight: 'bold', fontSize: '1.2rem' }}>COMPLETED</span>
                          <button className="btn-secondary" onClick={() => deleteSession(session.id)} style={{ padding: '0.4rem 0.8rem', fontSize: '0.9rem', color: 'var(--danger)', borderColor: 'var(--danger)' }}>
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
             </div>
          </div>
        ) : currentView === 'profile' ? (
          <div className="glass-card animate-fade" style={{ animationDelay: '0.1s', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem', maxWidth: '500px', margin: '0 auto' }}>
             <div style={{ width: '120px', height: '120px', borderRadius: '50%', background: 'var(--glass-bg)', border: '2px solid var(--glass-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '4rem', marginBottom: '1.5rem', color: 'var(--accent-main)', transition: 'transform 0.3s ease', cursor: 'pointer', overflow: 'hidden' }} onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'} onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}>
                {userProfile?.profilePic ? (
                  <img src={userProfile.profilePic} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} referrerPolicy="no-referrer" />
                ) : (
                  <span>👤</span>
                )}
             </div>
             <h3 style={{ fontSize: '2rem', marginBottom: '2rem' }}>Profile Details</h3>
             
             <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
               <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                 <span style={{ color: 'var(--text-muted)' }}>Full Name</span>
                 {isEditingName ? (
                   <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                     <input 
                       type="text" 
                       value={editName} 
                       onChange={(e) => setEditName(e.target.value)}
                       className="input-field" 
                       style={{ padding: '0.5rem', margin: 0, width: '200px', height: 'auto' }}
                       placeholder="Your Name" 
                     />
                     <button className="btn-primary" style={{ padding: '0.5rem', width: 'auto' }} onClick={handleUpdateName}>Save</button>
                     <button className="btn-secondary" style={{ padding: '0.5rem', width: 'auto' }} onClick={() => setIsEditingName(false)}>Cancel</button>
                   </div>
                 ) : (
                   <span style={{ fontWeight: 500 }}>{userProfile.name || user}</span>
                 )}
               </div>
               <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                 <span style={{ color: 'var(--text-muted)' }}>Email Account</span>
                 <span style={{ fontWeight: 500 }}>{userProfile.email || 'N/A'}</span>
               </div>
               <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                 <span style={{ color: 'var(--text-muted)' }}>Phone Number</span>
                 {isEditingPhone ? (
                   <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <select 
                      className="input-field" 
                      style={{ padding: '0.5rem', width: '90px', margin: 0, height: 'auto' }}
                      value={editCountryCode}
                      onChange={(e) => setEditCountryCode(e.target.value)}
                    >
                      {countryCodes.map(c => <option key={c.name} value={c.code}>{c.flag} {c.code}</option>)}
                    </select>
                    <input 
                      type="text" 
                      value={editPhone} 
                      onChange={(e) => setEditPhone(e.target.value.replace(/\D/g, ''))}
                      className="input-field" 
                      style={{ padding: '0.5rem', margin: 0, width: '130px', height: 'auto' }}
                      placeholder="Number" 
                    />
                    <button className="btn-primary" style={{ padding: '0.5rem', width: 'auto' }} onClick={handleUpdatePhone}>Save</button>
                    <button className="btn-secondary" style={{ padding: '0.5rem', width: 'auto' }} onClick={() => setIsEditingPhone(false)}>Cancel</button>
                   </div>
                 ) : (
                   <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                     <span style={{ fontWeight: 500 }}>{userProfile.phoneNumber || 'N/A'}</span>
                     {currentUser && (
                       <button className="btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem', width: 'auto' }} onClick={() => {
                          setIsEditingPhone(true);
                          setEditCountryCode(userProfile.countryCode || '+91');
                          setEditPhone(userProfile.phoneNumber ? userProfile.phoneNumber.replace(userProfile.countryCode, '') : '');
                       }}>Edit</button>
                     )}
                   </div>
                 )}
               </div>
             </div>

              <button 
                 className="btn-secondary" 
                 style={{ width: '100%' }}
                 onClick={() => {
                   setIsEditingName(true);
                   setEditName(userProfile.name || user);
                 }}
              >
                 Edit Profile
              </button>
           </div>
        ) : currentView === 'about' ? (
          <div className="glass-card animate-fade" style={{ animationDelay: '0.1s', padding: '3rem', maxWidth: '800px', margin: '0 auto', textAlign: 'center' }}>
             <div style={{ marginBottom: '1.5rem', display: 'inline-block', transition: 'transform 0.3s ease', cursor: 'pointer' }} onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.1)'} onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}>
               <img src="/logo.png" alt="Emotera AI Logo" style={{ height: '64px', objectFit: 'contain' }} />
             </div>
             <h3 style={{ fontSize: '2.5rem', marginBottom: '1.5rem' }}>About Emotera AI</h3>
             <p style={{ color: 'var(--text-main)', fontSize: '1.2rem', lineHeight: '1.8', marginBottom: '2.5rem' }}>
                Emotera AI is a real-time multilingual emotion intelligence system that analyzes voice input to detect human emotions and provide actionable AI-driven suggestions.
             </p>
             
             <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', marginBottom: '2.5rem' }}>
               <div className="glass-card" style={{ padding: '1.5rem', cursor: 'pointer' }} onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--accent-main)'} onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--glass-border)'}>
                 <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🎤</div>
                 <h4 style={{ marginBottom: '0.5rem' }}>Voice Analysis</h4>
                 <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Real-time feature extraction</p>
               </div>
               <div className="glass-card" style={{ padding: '1.5rem', cursor: 'pointer' }} onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--accent-main)'} onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--glass-border)'}>
                 <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🧠</div>
                 <h4 style={{ marginBottom: '0.5rem' }}>Emotion AI</h4>
                 <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Advanced detection models</p>
               </div>
               <div className="glass-card" style={{ padding: '1.5rem', cursor: 'pointer' }} onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--accent-main)'} onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--glass-border)'}>
                 <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🌍</div>
                 <h4 style={{ marginBottom: '0.5rem' }}>Multilingual</h4>
                 <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Language agnostic inputs</p>
               </div>
             </div>

             <div style={{ textAlign: 'right', marginTop: '2rem' }}>
                <span style={{ color: 'var(--text-sub)' }}>Contact: </span>
                <a href="mailto:emoteraai@gmail.com" style={{ color: 'var(--accent-main)', textDecoration: 'none', fontWeight: 600, transition: 'all 0.3s' }} onMouseEnter={(e) => e.currentTarget.style.textShadow = '0 0 10px rgba(59,130,246,0.5)'} onMouseLeave={(e) => e.currentTarget.style.textShadow = 'none'}>
                  emoteraai@gmail.com
                </a>
             </div>
          </div>
        ) : currentView === 'live' ? (
          <LiveCall />
        ) : null}
      </main>
    </div>
  );
}
