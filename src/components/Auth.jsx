import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Mail, Lock, ArrowRight, Zap } from 'lucide-react';

const Sparkle = ({ style }) => (
  <svg 
    viewBox="0 0 24 24" 
    fill="currentColor" 
    className="sparkle-icon"
    style={{ width: '20px', height: '20px', ...style }}
  >
    <path d="M12 0L14.59 9.41L24 12L14.59 14.59L12 24L9.41 14.59L0 12L9.41 9.41L12 0Z" />
  </svg>
);

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { login, signup } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (isLogin) {
        await login(email, password);
      } else {
        await signup(email, password);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

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
              {isLogin ? 'Sign In' : 'Join'}
            </h2>
            <p style={{ color: 'var(--accent-muted)', fontSize: '1rem' }}>
              {isLogin ? 'Welcome to the elite workspace.' : 'Step into the future of business.'}
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
              {loading ? 'Authenticating...' : (isLogin ? 'Initialize Access' : 'Create Organization')}
              {!loading && <ArrowRight size={18} />}
            </button>
          </form>


          <div style={{ marginTop: '2rem', textAlign: 'center' }}>
            <button 
              onClick={() => setIsLogin(!isLogin)}
              style={{ background: 'none', border: 'none', color: 'var(--accent-muted)', fontWeight: 600, cursor: 'pointer', fontSize: '0.8125rem' }}
            >
              {isLogin ? "New to the suite? Request access" : "Already a member? Sign in"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Auth;
