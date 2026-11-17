import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { authErrorMessage } from '../lib/authErrors';
import { Mail, Lock, ArrowLeft, Eye, EyeOff, AlertCircle } from 'lucide-react';
import Registration from './Registration';
import { DashboardScreen, Scaled } from './landing/home/ProductScreens';
import './landing/home/landing.css';
import './auth.css';

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

const Auth = () => {
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { login, loginWithGoogle } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(email, password);
      navigate('/dashboard/overview', { replace: true });
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      // Redirect-based: the browser leaves this page and returns to the dashboard with a
      // session, where AuthContext picks it up. Nothing after this line runs on
      // the success path, so there is no navigate() here.
      await loginWithGoogle();
    } catch (err) {
      setError(authErrorMessage(err));
      setLoading(false);
    }
  };

  if (!isLogin) {
    return <Registration onBack={() => setIsLogin(true)} />;
  }

  return (
    <div className="op-auth" data-theme="light">
      <main className="op-auth-form-side">
        <div className="op-auth-top">
          <a href="/" className="op-auth-logo" aria-label="Opstead home"><img src="/opstead-logo.png" alt="Opstead" /></a>
          <button type="button" className="op-auth-back" onClick={() => navigate('/')}>
            <ArrowLeft size={14} /> Back To Home
          </button>
        </div>

        <div className="op-auth-card">
          <h1>Welcome Back</h1>
          <p className="op-auth-sub">Sign in to your Opstead workspace.</p>

          {error && (
            <div className="op-auth-error" role="alert"><AlertCircle size={15} /> <span>{error}</span></div>
          )}

          <button type="button" onClick={handleGoogleSignIn} disabled={loading} className="op-auth-google">
            <GoogleIcon /> Continue With Google
          </button>

          <div className="op-auth-divider"><span>or sign in with email</span></div>

          <form onSubmit={handleSubmit}>
            <label className="op-auth-field">
              <span>Email</span>
              <span className="op-auth-input">
                <Mail size={15} aria-hidden="true" />
                <input
                  type="email" autoComplete="email" placeholder="name@company.com"
                  value={email} onChange={(e) => setEmail(e.target.value)} required
                />
              </span>
            </label>

            <label className="op-auth-field">
              <span>Password</span>
              <span className="op-auth-input">
                <Lock size={15} aria-hidden="true" />
                <input
                  type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Your password"
                  value={password} onChange={(e) => setPassword(e.target.value)} required
                />
                <button
                  type="button" className="op-auth-eye" onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </span>
            </label>

            <button type="submit" disabled={loading} className="op-auth-submit">
              {loading ? 'Signing In…' : 'Sign In'}
            </button>
          </form>

          <p className="op-auth-switch">
            New to Opstead? <button type="button" onClick={() => setIsLogin(false)}>Create Your Workspace</button>
          </p>
        </div>

        <p className="op-auth-legal">
          By continuing you agree to the <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.
        </p>
      </main>

      <aside className="op-auth-visual" aria-hidden="true">
        <div className="op-sky"><i className="c1" /><i className="c2" /><i className="c3" /><i className="c4" /></div>
        <div className="op-auth-visual-copy">
          <h2>An Agentic Operating System<br />For Businesses</h2>
          <p>Projects, clients, ledgers, payroll and documents in one workspace, with AI that answers from your own books.</p>
        </div>
        <div className="op-auth-shot">
          <Scaled width={1120} className="op-auth-window"><DashboardScreen /></Scaled>
        </div>
      </aside>
    </div>
  );
};

export default Auth;
