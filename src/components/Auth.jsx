import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Mail, Lock, ArrowRight, Zap } from 'lucide-react';
import Registration from './Registration';

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
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
    <div className="auth-split-wrapper" data-theme="dark">
      {/* Left Side: Premium Visual */}
      <div className="auth-visual-side">
        <div className="sparkle-container auth-sparkle-container">
          <div className="animate-in" style={{ animationDelay: '0.1s' }}>
            <div className="badge-cinematic" style={{ marginBottom: '2rem' }}>Royal Infrastructure</div>
            <h1 className="auth-hero-title">
              Pure <br /> Intelligence.
            </h1>
            <p className="auth-hero-subtitle">
              The ultimate high-performance workspace for elite business automation and document engineering.
            </p>
          </div>

          <div className="auth-hero-icon">
            <Zap size={120} strokeWidth={0.5} />
          </div>
        </div>
      </div>

      {/* Right Side: Form */}
      <div className="auth-form-side">
        <div className="auth-form-container animate-in">
          <div className="auth-form-header">
            <div className="nav-logo auth-logo">
              <img src="/edgeos-logo.png" alt="EdgeOS" style={{ height: '24px', width: 'auto' }} />
            </div>
            <h2 className="auth-form-title">Sign In</h2>
            <p className="auth-form-subtitle">Welcome to the elite workspace.</p>
          </div>

          {error && (
            <div className="auth-error-banner">{error}</div>
          )}

          {/* Google Sign-In Button */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="auth-google-btn auth-input-focus"
          >
            <GoogleIcon />
            Continue with Google
          </button>

          <div className="auth-divider">
            <div className="auth-divider-line" />
            <span className="auth-divider-text">or</span>
            <div className="auth-divider-line" />
          </div>

          <form onSubmit={handleSubmit}>
            <div className="auth-field">
              <label className="auth-label">Corporate Identity</label>
              <div className="auth-input-wrapper">
                <Mail size={16} className="auth-input-icon" />
                <input
                  type="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="auth-input auth-input-focus"
                />
              </div>
            </div>

            <div className="auth-field-last">
              <label className="auth-label">Access Key</label>
              <div className="auth-input-wrapper">
                <Lock size={16} className="auth-input-icon" />
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="auth-input auth-input-focus"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-cinematic auth-submit-btn"
            >
              {loading ? 'Authenticating...' : 'Initialize Access'}
              {!loading && <ArrowRight size={18} />}
            </button>
          </form>

          <div className="auth-footer">
            <button
              onClick={() => setIsLogin(!isLogin)}
              className="auth-switch-btn"
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
