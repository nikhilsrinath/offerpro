import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowLeft, Check, ChevronRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { createOrganization } from '../services/orgProvisioning';
import { authErrorMessage } from '../lib/authErrors';
import { displayNameOf } from '../lib/user';

// The wizard asks for the six things an organization cannot exist without:
// credentials, who the company is, who signs for it, and the one line of
// context the AI co-founder reads. Everything else — address, phone, logo,
// signature, designation — is prompted for from the hub afterwards, where
// there is a real form with previews instead of a one-question-at-a-time run.
// See lib/profileCompletion.js for what the hub then chases.
const QUESTIONS = [
    { id: 'welcome', type: 'welcome', category: 'Welcome' },
    { id: 'company_email', type: 'email', label: "What is your work email?", subtitle: "This becomes your sign-in and your organization's identity.", category: 'Work email' },
    { id: 'password', type: 'password', label: "Create a password.", subtitle: "Minimum 6 characters.", category: 'Password' },
    { id: 'company_name', type: 'text', label: "What is your company called?", subtitle: "The name that appears on everything you issue.", category: 'Company name' },
    { id: 'owner_full_name', type: 'text', label: "What is your full name?", subtitle: "As the primary account administrator.", category: 'Your name' },
    { id: 'owner_role', type: 'select', label: "What is your role?", options: ['Founder', 'HR', 'Admin', 'Manager', 'Other'], category: 'Your role' },
    { id: 'industry', type: 'select', label: "Which industry fits you best?", options: ['Technology', 'Finance', 'Healthcare', 'Education', 'E-commerce', 'Agency/Consulting', 'Real Estate', 'Other'], category: 'Industry' }
];

// Questions for Google-authenticated users (skip email/password)
const GOOGLE_QUESTIONS = QUESTIONS.filter(q => q.id !== 'company_email' && q.id !== 'password');

export default function Registration({ onBack, isGoogleUser }) {
    const { user, signup, completeOnboarding } = useAuth();
    const navigate = useNavigate();

    const questions = isGoogleUser ? GOOGLE_QUESTIONS : QUESTIONS;

    const [step, setStep] = useState(() => {
        const savedStep = localStorage.getItem('offerpro_reg_step');
        const parsedStep = savedStep ? parseInt(savedStep, 10) : 0;
        return isNaN(parsedStep) || parsedStep >= questions.length ? 0 : parsedStep;
    });

    const [formData, setFormData] = useState(() => {
        const defaults = {
            company_email: user?.email || '',
            password: '',
            company_name: '',
            owner_full_name: displayNameOf(user),
            owner_role: '',
            industry: '',
            // Not asked any more, but the organization row still has the
            // column and `false` here would strip the logo off every issued
            // document. Opt in; the hub asks for the image itself.
            include_logo: 'Yes'
        };
        // Merged over the defaults rather than used as-is: a run abandoned
        // before this wizard was shortened is missing keys the questions now
        // bind to, and `value={undefined}` turns the input uncontrolled.
        const saved = localStorage.getItem('offerpro_reg_data');
        if (saved) {
            try {
                return { ...defaults, ...JSON.parse(saved) };
            } catch {
                console.error('Error parsing local storage data');
            }
        }
        return defaults;
    });

    useEffect(() => {
        localStorage.setItem('offerpro_reg_data', JSON.stringify(formData));
    }, [formData]);

    useEffect(() => {
        if (step !== 'success' && step !== 'redirecting') {
            localStorage.setItem('offerpro_reg_step', step.toString());
        }
    }, [step]);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const inputRef = useRef(null);

    useEffect(() => {
        if (inputRef.current && step > 0) {
            inputRef.current.focus();
        }
    }, [step]);

    const currentQ = questions[step];
    const progress = (step / (questions.length - 1)) * 100;

    const handleNext = async () => {
        if (loading) return;
        setError(null);
        if (!currentQ.optional && currentQ.type !== 'welcome') {
            const val = formData[currentQ.id];
            if (!val || (Array.isArray(val) && val.length === 0)) {
                setError('This field is required.');
                return;
            }
        }

        if (currentQ.id === 'password' && formData.password.length < 6) {
            setError('Password must be at least 6 characters.');
            return;
        }

        if (step < questions.length - 1) {
            setStep(s => s + 1);
        } else {
            await submitRegistration();
        }
    };

    const handleBack = () => {
        setError(null);
        if (step === 0) {
            onBack();
            return;
        }

        setStep(step - 1);
    };


    const submitRegistration = async () => {
        setLoading(true);
        setError(null);

        try {
            if (isGoogleUser && user) {
                // User is already authenticated via Google, execute dual-write
                await createOrganization(formData.company_name, { ...formData, company_email: user.email });

                localStorage.removeItem('offerpro_reg_data');
                localStorage.removeItem('offerpro_reg_step');

                completeOnboarding();
                setStep('redirecting');
                navigate('/hub', { replace: true });
            } else {
                // Email/Password signup flow
                // Use the callback pattern to store org data BEFORE React re-renders
                await signup(formData.company_email, formData.password, async () => {
                    await createOrganization(formData.company_name, formData);
                });

                localStorage.removeItem('offerpro_reg_data');
                localStorage.removeItem('offerpro_reg_step');
                setStep('redirecting');
                // Signup leaves the browser on /signup, which matches no route
                // inside the app shell. The hub is where a new workspace opens.
                navigate('/hub', { replace: true });
            }
        } catch (err) {
            console.error('Registration failed:', err);
            setError(authErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleNext();
        }
    };

    const toggleMultiSelect = (option) => {
        const curr = formData[currentQ.id];
        if (curr.includes(option)) {
            setFormData({ ...formData, [currentQ.id]: curr.filter(o => o !== option) });
        } else {
            setFormData({ ...formData, [currentQ.id]: [...curr, option] });
        }
    };

    const renderInput = () => {
        if (currentQ.type === 'welcome') return null;

        if (currentQ.type === 'text' || currentQ.type === 'email' || currentQ.type === 'password') {
            return (
                <input
                    ref={inputRef}
                    disabled={loading}
                    type={currentQ.type}
                    value={formData[currentQ.id]}
                    onChange={(e) => {
                        setFormData({ ...formData, [currentQ.id]: e.target.value });
                        setError(null);
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder="Type your answer here..."
                    className="reg-text-input-v2"
                    autoFocus
                />
            );
        }

        if (currentQ.type === 'textarea') {
            return (
                <textarea
                    ref={inputRef}
                    disabled={loading}
                    value={formData[currentQ.id]}
                    onChange={(e) => {
                        setFormData({ ...formData, [currentQ.id]: e.target.value });
                        setError(null);
                    }}
                    onKeyDown={handleKeyDown}
                    rows={4}
                    placeholder="Type your answer here..."
                    className="reg-textarea-v2"
                    autoFocus
                />
            );
        }

        if (currentQ.type === 'select' || currentQ.type === 'select_boolean') {
            return (
                <div className="reg-options-list-v2">
                    {currentQ.options.map((option, idx) => {
                        const isSelected = formData[currentQ.id] === option;
                        return (
                            <button
                                key={option}
                                disabled={loading}
                                onClick={() => {
                                    setFormData({ ...formData, [currentQ.id]: option });
                                    setError(null);
                                }}
                                className={`reg-option-btn-v2 ${isSelected ? 'selected' : ''}`}
                            >
                                <span className="reg-option-letter">{String.fromCharCode(65 + idx)}</span>
                                <span className="reg-option-text">{option}</span>
                            </button>
                        );
                    })}
                </div>
            );
        }

        if (currentQ.type === 'multiselect') {
            return (
                <div className="reg-options-list-v2">
                    {currentQ.options.map((option) => {
                        const isSelected = formData[currentQ.id].includes(option);
                        return (
                            <button
                                key={option}
                                disabled={loading}
                                onClick={() => {
                                    toggleMultiSelect(option);
                                    setError(null);
                                }}
                                className={`reg-option-btn-v2 ${isSelected ? 'selected' : ''}`}
                            >
                                <span className="reg-option-check">{isSelected && <Check size={18} />}</span>
                                <span className="reg-option-text">{option}</span>
                            </button>
                        );
                    })}
                </div>
            );
        }
    };

    if (step === 'success') {
        return (
            <div className="reg-fullscreen-centered" data-theme="light">
                <div className="animate-in" style={{ textAlign: 'center', maxWidth: '500px' }}>
                    <div className="reg-success-icon">
                        <Check size={32} />
                    </div>
                    <h1 className="reg-success-title">Configuration Complete</h1>
                    <p className="reg-success-subtitle">
                        Your core organizational identity has been successfully initialized.
                    </p>
                    <button onClick={onBack} className="btn-cinematic" style={{ padding: '1rem 3rem', borderRadius: '99px', fontSize: '1.125rem' }}>
                        Return to Sign In
                    </button>
                </div>
            </div>
        );
    }

    if (step === 'redirecting') {
        return (
            <div className="reg-fullscreen-centered" data-theme="light">
                <div className="animate-in" style={{ textAlign: 'center' }}>
                    <div className="reg-spinner" />
                    <h2 className="reg-spinner-title">Initializing Workspace...</h2>
                </div>
            </div>
        );
    }

    return (
        <div className="reg-fullscreen-v2" data-theme="light">
            {/* Top Progress Bar */}
            {typeof step === 'number' && step > 0 && (
                <div className="reg-progress-bar-v2">
                    <div className="reg-progress-fill-v2" style={{ width: `${progress}%` }} />
                </div>
            )}

            {/* Main Content */}
            <div className="reg-content-v2">
                <div className="reg-content-inner-v2">
                    <div key={`step-${step}`} className="animate-in-v2" style={{ animationDuration: '0.5s' }}>

                        {currentQ.type === 'welcome' ? (
                            <div className="reg-welcome-v2">
                                <h1 className="reg-welcome-title-v2">
                                    {isGoogleUser ? 'Complete Your Profile' : 'Welcome to EdgeOS'}
                                </h1>
                                <p className="reg-welcome-subtitle-v2">
                                    {isGoogleUser
                                        ? "You're almost there. Four quick questions and your workspace is ready."
                                        : "Six quick questions and your workspace is ready. Everything else — logo, address, signature — you can add later from your company profile."
                                    }
                                </p>
                                <button
                                    onClick={handleNext}
                                    disabled={loading}
                                    className="reg-submit-btn-v2"
                                >
                                    Begin Configuration <ArrowRight size={20} />
                                </button>
                            </div>
                        ) : (
                            <div className="reg-question-container-v2">
                                {/* Question Number and Category */}
                                <div className="reg-category-label-v2">
                                    <span>{step}. {currentQ.category}</span>
                                </div>

                                {/* Question Title */}
                                <h2 className="reg-question-title-v2">
                                    {currentQ.label}
                                </h2>

                                {/* Input Field */}
                                {renderInput()}

                                {/* Error Message */}
                                {error && (
                                    <div className="reg-error-v2">
                                        {error}
                                    </div>
                                )}

                                {/* Submit Button - Right aligned */}
                                <div className="reg-submit-container-v2">
                                    <button
                                        onClick={handleNext}
                                        disabled={loading}
                                        className="reg-submit-btn-v2"
                                    >
                                        {loading ? 'Processing...' : (step === questions.length - 1 ? 'Complete Setup' : 'Submit >')}
                                    </button>
                                </div>

                                {/* Enter key hint for text inputs */}
                                {(currentQ.type === 'text' || currentQ.type === 'email' || currentQ.type === 'password' || currentQ.type === 'textarea') && (
                                    <div className="reg-enter-hint-v2">
                                        Press <strong>Enter ↵</strong>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

            </div>

            {/* Back Button - Bottom Left */}
            <button
                onClick={handleBack}
                disabled={loading}
                className="reg-back-btn-v2"
            >
                <ArrowLeft size={16} />
                {step === 0 ? (isGoogleUser ? 'Sign Out' : 'Back to Sign In') : 'Go Back'}
            </button>
        </div>
    );
}
