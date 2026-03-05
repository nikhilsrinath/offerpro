import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Mail, Lock, ArrowRight, Zap } from 'lucide-react';
import Registration from './Registration';

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { login, loginWithGoogle } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      const msg = err.code === 'auth/invalid-credential' ? 'Invalid email or password.'
        : err.code === 'auth/user-not-found' ? 'No account found with this email.'
        : err.code === 'auth/wrong-password' ? 'Incorrect password.'
        : err.code === 'auth/too-many-requests' ? 'Too many attempts. Please try again later.'
        : err.message;
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await loginWithGoogle();
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!isLogin) {
    return <Registration onBack={() => setIsLogin(true)} />;
  }

  return (
    <div className="auth-split-wrapper">
      {/* Left Side: Premium Visual */}
      <div className="auth-visual-side">
        <div className="sparkle-container" style={{ position: 'relative', zIndex: 10, textAlign: 'center', padding: '2rem' }}>
          <div className="animate-in" style={{ animationDelay: '0.1s' }}>
            <div className="badge-cinematic" style={{ marginBottom: '2rem' }}>Royal Infrastructure</div>
            <h1 style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(3rem, 5vw, 5rem)',
              lineHeight: 0.9,
              marginBottom: '2rem',
              letterSpacing: '-0.04em',
              fontWeight: 800
            }}>
              Pure <br /> Intelligence.
            </h1>
            <p style={{
              color: 'var(--accent-muted)',
              fontSize: '1.25rem',
              maxWidth: '460px',
              margin: '0 auto',
              lineHeight: 1.5,
              fontWeight: 400
            }}>
              The ultimate high-performance workspace for elite business automation and document engineering.
            </p>
          </div>

          <div style={{ marginTop: '5rem', opacity: 0.3 }}>
            <Zap size={120} strokeWidth={0.5} />
          </div>
        </div>
      </div>

      {/* Right Side: Form */}
      <div className="auth-form-side">
        <div style={{ width: '100%', maxWidth: '400px' }} className="animate-in">
          <div style={{ marginBottom: '2.5rem' }}>
            <div className="nav-logo" style={{ marginBottom: '2rem', fontSize: '1.25rem' }}>
              <Zap size={28} fill="white" />
              OFFERPRO
            </div>
            <h2 style={{
              fontFamily: 'var(--font-display)',
              fontSize: '2.5rem',
              marginBottom: '0.25rem',
              letterSpacing: '-0.04em',
              fontWeight: 800
            }}>
              Sign In
            </h2>
            <p style={{ color: 'var(--accent-muted)', fontSize: '1rem' }}>
              Welcome to the elite workspace.
            </p>
          </div>

          {error && (
            <div style={{
              background: 'rgba(220, 38, 38, 0.05)',
              color: '#f87171',
              padding: '1rem',
              borderRadius: '12px',
              marginBottom: '2rem',
              fontSize: '0.875rem',
              border: '1px solid rgba(220, 38, 38, 0.1)',
              textAlign: 'center'
            }}>
              {error}
            </div>
          )}

          {/* Google Sign-In Button */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            style={{
              width: '100%',
              height: '52px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.75rem',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '12px',
              color: 'white',
              fontSize: '0.9375rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              marginBottom: '1.5rem'
            }}
            className="auth-input-focus"
          >
            <GoogleIcon />
            Continue with Google
          </button>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            marginBottom: '1.5rem'
          }}>
            <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.08)' }} />
            <span style={{ color: 'var(--accent-muted)', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em' }}>or</span>
            <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.08)' }} />
          </div>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{
                display: 'block',
                fontSize: '0.65rem',
                fontWeight: 850,
                textTransform: 'uppercase',
                color: 'var(--accent-muted)',
                marginBottom: '0.5rem',
                letterSpacing: '0.15em'
              }}>Corporate Identity</label>
              <div style={{ position: 'relative' }}>
                <Mail size={16} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--accent-muted)', opacity: 0.5 }} />
                <input
                  type="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '12px',
                    padding: '0.875rem 1rem 0.875rem 3rem',
                    color: 'white',
                    outline: 'none',
                    fontSize: '0.9375rem',
                    transition: 'all 0.3s ease'
                  }}
                  className="auth-input-focus"
                />
              </div>
            </div>

            <div style={{ marginBottom: '2rem' }}>
              <label style={{
                display: 'block',
                fontSize: '0.65rem',
                fontWeight: 850,
                textTransform: 'uppercase',
                color: 'var(--accent-muted)',
                marginBottom: '0.5rem',
                letterSpacing: '0.15em'
              }}>Access Key</label>
              <div style={{ position: 'relative' }}>
                <Lock size={16} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--accent-muted)', opacity: 0.5 }} />
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '12px',
                    padding: '0.875rem 1rem 0.875rem 3rem',
                    color: 'white',
                    outline: 'none',
                    fontSize: '0.9375rem',
                    transition: 'all 0.3s ease'
                  }}
                  className="auth-input-focus"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-cinematic"
              style={{ width: '100%', height: '52px', justifyContent: 'center', fontSize: '0.9375rem', borderRadius: '12px' }}
            >
              {loading ? 'Authenticating...' : 'Initialize Access'}
              {!loading && <ArrowRight size={18} />}
            </button>
          </form>

          <div style={{ marginTop: '2rem', textAlign: 'center' }}>
            <button
              onClick={() => setIsLogin(!isLogin)}
              style={{ background: 'none', border: 'none', color: 'var(--accent-muted)', fontWeight: 600, cursor: 'pointer', fontSize: '0.8125rem' }}
            >
              New to the suite? Request access
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Auth;
