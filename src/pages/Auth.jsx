import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { doc, setDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import { countryCodes } from '../data/countryCodes';

export default function Auth() {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [fullName, setFullName] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState(null);
  const [demoRemaining, setDemoRemaining] = useState(3);
  
  const navigate = useNavigate();

  useEffect(() => {
    const getDemoRemaining = () => {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${now.getMonth() + 1}`;
      const usage = JSON.parse(localStorage.getItem('emoteraDemoUsage') || '{}');
      if (usage.month !== currentMonth) return 3;
      return Math.max(0, 3 - (usage.count || 0));
    };
    setDemoRemaining(getDemoRemaining());
  }, []);

  const handleToggle = (newMode) => {
    setMode(newMode);
    setMessage(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage({ type: 'success', text: 'Processing...' });

    if (mode === 'signup') {
      if (password !== confirmPassword) {
        setMessage({ type: 'error', text: 'Passwords do not match!' });
        return;
      }
      try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        
        await setDoc(doc(db, "users", user.uid), {
          name: fullName,
          email: email,
          phoneNumber: `${countryCode}${phone}`,
          countryCode: countryCode,
          createdAt: serverTimestamp()
        });

        setMessage({ type: 'success', text: `Account created, ${fullName}! Redirecting...` });
        localStorage.removeItem('emoteraUser'); // clear mock
        setTimeout(() => navigate('/dashboard'), 1000);
      } catch (error) {
        setMessage({ type: 'error', text: error.message.replace('Firebase: ', '') });
      }
    } else {
      // login
      if (!email || !password) {
        setMessage({ type: 'error', text: 'Please fill out all fields.' });
        return;
      }
      try {
        await signInWithEmailAndPassword(auth, email, password);
        setMessage({ type: 'success', text: `Welcome back! Redirecting...` });
        localStorage.removeItem('emoteraUser'); // clear mock
        setTimeout(() => navigate('/dashboard'), 1000);
      } catch (error) {
        setMessage({ type: 'error', text: 'Invalid login credentials. Please try again.' });
      }
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        await setDoc(userRef, {
          name: user.displayName || 'Google User',
          email: user.email,
          profilePic: user.photoURL || '',
          provider: "google",
          createdAt: serverTimestamp()
        });
      }

      setMessage({ type: 'success', text: 'Google Sign-In successful! Redirecting...' });
      localStorage.removeItem('emoteraUser');
      setTimeout(() => navigate('/dashboard'), 1000);
    } catch (error) {
      console.error("Google Sign-in Error:", error);
      setMessage({ type: 'error', text: 'Google authentication failed or was cancelled.' });
    }
  };

  const handleDemo = () => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${now.getMonth() + 1}`;
    let usage = JSON.parse(localStorage.getItem('emoteraDemoUsage') || '{}');
    
    if (usage.month !== currentMonth) {
      usage = { count: 0, month: currentMonth };
    }

    if (usage.count >= 3) {
      setMessage({ type: 'error', text: 'Monthly demo limit reached (3/3 logs). Please Create an Account.' });
      return;
    }

    usage.count += 1;
    localStorage.setItem('emoteraDemoUsage', JSON.stringify(usage));
    setDemoRemaining(3 - usage.count);

    setMessage({ type: 'success', text: `Demo activated! (${usage.count}/3 uses). Redirecting...` });
    setTimeout(() => {
      localStorage.setItem('emoteraUser', 'Demo User');
      navigate('/dashboard');
    }, 1200);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '2rem' }}>
      <div className="glass-card animate-fade" style={{ width: '100%', maxWidth: '440px', padding: '3rem' }}>
        <div className="text-center" style={{ marginBottom: '2rem' }}>
          <h1 className="gradient-text" style={{ fontSize: '2.5rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <img src="/logo.png" alt="Emotera AI Logo" style={{ height: '48px', objectFit: 'contain' }} />
            Emotera AI
          </h1>
          <p style={{ color: 'var(--text-sub)' }}>Welcome back! Log in or try demo.</p>
        </div>

        {message && (
          <div style={{ 
            padding: '1rem', 
            borderRadius: 'var(--radius-sm)', 
            marginBottom: '1.5rem', 
            borderLeft: '4px solid',
            borderColor: message.type === 'error' ? 'var(--danger)' : 'var(--success)',
            backgroundColor: message.type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)',
            color: message.type === 'error' ? 'var(--danger)' : 'var(--success)'
          }}>
            {message.text}
          </div>
        )}

        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-sm)', marginBottom: '2rem', overflow: 'hidden' }}>
          <button 
            type="button"
            onClick={() => handleToggle('login')}
            style={{ 
               flex: 1, padding: '1rem', border: 'none', cursor: 'pointer', fontWeight: 600,
               background: mode === 'login' ? 'linear-gradient(135deg, var(--accent-main), var(--accent-sub))' : 'transparent',
               color: mode === 'login' ? 'white' : 'var(--text-sub)'
            }}
          >
            Log In
          </button>
          <button 
            type="button"
            onClick={() => handleToggle('signup')}
            style={{ 
               flex: 1, padding: '1rem', border: 'none', cursor: 'pointer', fontWeight: 600,
               background: mode === 'signup' ? 'linear-gradient(135deg, var(--accent-main), var(--accent-sub))' : 'transparent',
               color: mode === 'signup' ? 'white' : 'var(--text-sub)'
            }}
          >
            Sign Up
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <>
              <div className="input-group animate-fade" style={{ animationDelay: '0.1s' }}>
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="Full Name" 
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required 
                />
              </div>
              <div className="input-group animate-fade" style={{ animationDelay: '0.1s', display: 'flex', gap: '0.5rem' }}>
                <select 
                  className="input-field" 
                  style={{ width: '110px', padding: '1rem 0.5rem', cursor: 'pointer' }}
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                >
                  {countryCodes.map(c => (
                    <option key={c.name} value={c.code}>{c.flag} {c.code}</option>
                  ))}
                </select>
                <input 
                  type="text" 
                  pattern="[0-9]{8,12}"
                  title="Phone number must be between 8 and 12 digits"
                  className="input-field" 
                  placeholder="Phone Number" 
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                  required 
                  style={{ flex: 1 }}
                />
              </div>
            </>
          )}

          <div className="input-group">
            <input 
              type="text" 
              className="input-field" 
              placeholder={mode === 'login' ? "Email or Phone" : "Email address"} 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required 
            />
          </div>
          <div className="input-group">
            <input 
              type="password" 
              className="input-field" 
              placeholder="Password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required 
            />
          </div>
          {mode === 'signup' && (
            <div className="input-group animate-fade">
              <input 
                type="password" 
                className="input-field" 
                placeholder="Confirm Password" 
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required 
              />
            </div>
          )}

          <button type="submit" className="btn-primary" style={{ marginTop: '1rem' }}>
            {mode === 'login' ? 'Log In' : 'Create Account'}
          </button>
        </form>

        <div style={{ textAlign: 'center', margin: '2rem 0', position: 'relative' }}>
          <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: '1px', background: 'var(--glass-border)' }}></div>
          <span style={{ position: 'relative', background: 'var(--bg-primary)', padding: '0 1rem', color: 'var(--text-muted)' }}>or</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <button type="button" className="btn-secondary" onClick={handleGoogleSignIn} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}>
            <svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>

          <div style={{ textAlign: 'center', margin: '0.5rem 0', position: 'relative' }}>
            <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: '1px', background: 'var(--glass-border)' }}></div>
            <span style={{ position: 'relative', background: 'var(--bg-primary)', padding: '0 1rem', color: 'var(--text-muted)' }}>or</span>
          </div>

          <button type="button" className="btn-secondary" onClick={handleDemo}>
            Try Demo
          </button>
        </div>

        <div style={{ textAlign: 'center', marginTop: '1rem' }}>
          <p style={{ color: demoRemaining === 0 ? 'var(--danger)' : 'var(--text-sub)', fontSize: '0.9rem', fontWeight: 500 }}>
             {demoRemaining} / 3 demo uses remaining this month
          </p>
        </div>
      </div>
    </div>
  );
}
