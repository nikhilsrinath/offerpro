import React, { useState, useRef, useEffect } from 'react';
import { ArrowRight, ArrowLeft, Check, ChevronRight } from 'lucide-react';
import { ref, set, push } from 'firebase/database';
import { db } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';

const QUESTIONS = [
    { id: 'welcome', type: 'welcome' },
    { id: 'company_email', type: 'email', label: "What is your official company email address?", subtitle: "This forms your core organizational identity." },
    { id: 'password', type: 'password', label: "Create a secure administration password.", subtitle: "Required for workspace access. Minimum 6 characters." },
    { id: 'company_name', type: 'text', label: "What is your Organization / Brand Name?" },
    { id: 'company_website', type: 'text', label: "Company website or online presence?", subtitle: "Website / LinkedIn / Portfolio (Optional)", optional: true },
    { id: 'industry', type: 'multiselect', label: "Which industry categorises you best?", options: ['Technology', 'Finance', 'Healthcare', 'Education', 'E-commerce', 'Agency/Consulting', 'Real Estate', 'Other'] },
    { id: 'company_description', type: 'textarea', label: "Briefly describe your core business.", subtitle: "1-2 lines on what you do." },
    { id: 'country', type: 'text', label: "Which country is your headquarters located in?" },
    { id: 'city', type: 'text', label: "And which city do you operate from?" },
    { id: 'company_size', type: 'select', label: "What is your organizational scale?", options: ['Solo', '2–10', '11–50', '50+'] },
    { id: 'owner_full_name', type: 'text', label: "What is your full name?", subtitle: "As the primary account administrator." },
    { id: 'owner_role', type: 'select', label: "What is your operational role?", options: ['Founder', 'HR', 'Admin', 'Manager', 'Other'] },
    { id: 'primary_contact_name', type: 'text', label: "Primary Contact Person's Name", subtitle: "Name to appear on generated documents (if different from your name).", optional: true },
    { id: 'document_designation', type: 'text', label: "Preferred designation on official documents?", subtitle: "(e.g., Founder, HR Manager, Authorized Signatory)" },
    { id: 'use_cases', type: 'multiselect', label: "Primary platform usage intent?", options: ['Offer Letters', 'Certificates', 'MOUs', 'Reports', 'Team Management'] },
    { id: 'include_logo', type: 'select_boolean', label: "Include company logo on generated documents?", options: ['Yes', 'No'] },
    { id: 'logo_url', type: 'text', label: "Company Logo URL", subtitle: "Provide a link to your asset. You can configure this later in settings.", optional: true },
    { id: 'account_usage', type: 'select', label: "Account Scope:", options: ['Just me', 'Small team', 'Entire organization'] },
    { id: 'referral_source', type: 'text', label: "How did you discover OfferPro?", optional: true }
];

// Questions for Google-authenticated users (skip email/password)
const GOOGLE_QUESTIONS = QUESTIONS.filter(q => q.id !== 'company_email' && q.id !== 'password');

export default function Registration({ onBack, isGoogleUser }) {
    const { user, signup, completeOnboarding } = useAuth();

    const questions = isGoogleUser ? GOOGLE_QUESTIONS : QUESTIONS;

    const [step, setStep] = useState(() => {
        const savedStep = localStorage.getItem('offerpro_reg_step');
        const parsedStep = savedStep ? parseInt(savedStep, 10) : 0;
        return isNaN(parsedStep) || parsedStep >= questions.length ? 0 : parsedStep;
    });

    const [formData, setFormData] = useState(() => {
        const saved = localStorage.getItem('offerpro_reg_data');
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch {
                console.error('Error parsing local storage data');
            }
        }
        return {
            company_email: user?.email || '',
            password: '',
            company_name: '',
            company_website: '',
            industry: [],
            company_description: '',
            country: '',
            city: '',
            company_size: '',
            owner_full_name: user?.displayName || '',
            owner_role: '',
            primary_contact_name: '',
            document_designation: '',
            use_cases: [],
            include_logo: 'No',
            logo_url: '',
            account_usage: '',
            referral_source: ''
        };
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

        // Logic for conditional logo display
        if (currentQ.id === 'include_logo' && formData.include_logo === 'No') {
            setStep(s => s + 2);
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

        let prevStep = step - 1;
        if (questions[step].id === 'account_usage' && formData.include_logo === 'No') {
            prevStep = step - 2;
        }

        setStep(prevStep);
    };

    const storeOrgData = async (userId) => {
        // Create organization in Firebase Realtime Database
        const orgRef = push(ref(db, 'organizations'));
        const orgId = orgRef.key;

        const orgData = {
            id: orgId,
            company_email: isGoogleUser ? user.email : formData.company_email,
            company_name: formData.company_name,
            company_website: formData.company_website || null,
            industry: formData.industry,
            company_description: formData.company_description,
            country: formData.country,
            city: formData.city,
            company_size: formData.company_size,
            owner_full_name: formData.owner_full_name,
            owner_role: formData.owner_role,
            primary_contact_name: formData.primary_contact_name || null,
            document_designation: formData.document_designation,
            use_cases: formData.use_cases,
            include_logo: formData.include_logo === 'Yes',
            logo_url: formData.logo_url || null,
            account_usage: formData.account_usage,
            referral_source: formData.referral_source || null,
            created_at: new Date().toISOString(),
            trial_start_date: new Date().toISOString(),
            owner_uid: userId
        };

        // Store the organization data
        await set(orgRef, orgData);

        // Create membership: link user to org
        const membershipRef = push(ref(db, 'memberships'));
        await set(membershipRef, {
            organization_id: orgId,
            user_id: userId,
            role: 'owner',
            created_at: new Date().toISOString()
        });

        // Store user → org mapping for quick lookup
        await set(ref(db, `users/${userId}/organizations/${orgId}`), true);

        return orgId;
    };

    const submitRegistration = async () => {
        setLoading(true);
        setError(null);

        try {
            if (isGoogleUser && user) {
                // User is already authenticated via Google, just store org data
                await storeOrgData(user.uid);

                localStorage.removeItem('offerpro_reg_data');
                localStorage.removeItem('offerpro_reg_step');

                completeOnboarding();
                setStep('redirecting');
            } else {
                // Email/Password signup flow
                // Use the callback pattern to store org data BEFORE React re-renders
                await signup(formData.company_email, formData.password, async (uid) => {
                    await storeOrgData(uid);
                });

                localStorage.removeItem('offerpro_reg_data');
                localStorage.removeItem('offerpro_reg_step');
                setStep('redirecting');
            }
        } catch (err) {
            console.error("Firebase Operation Failed:", err);
            const msg = err.code === 'auth/email-already-in-use' ? 'This email is already registered. Please sign in instead.'
                : err.code === 'auth/weak-password' ? 'Password should be at least 6 characters.'
                    : err.code === 'auth/invalid-email' ? 'Please enter a valid email address.'
                        : err.message || 'Registration failed. Please try again.';
            setError(msg);
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
                    onChange={(e) => setFormData({ ...formData, [currentQ.id]: e.target.value })}
                    onKeyDown={handleKeyDown}
                    placeholder="Type your answer here..."
                    className="reg-text-input registration-input"
                />
            );
        }

        if (currentQ.type === 'textarea') {
            return (
                <textarea
                    ref={inputRef}
                    value={formData[currentQ.id]}
                    onChange={(e) => setFormData({ ...formData, [currentQ.id]: e.target.value })}
                    rows={3}
                    placeholder="Start typing..."
                    className="reg-textarea"
                />
            );
        }

        if (currentQ.type === 'select' || currentQ.type === 'select_boolean') {
            return (
                <div className="reg-options-list">
                    {currentQ.options.map((option, idx) => {
                        const isSelected = formData[currentQ.id] === option;
                        return (
                            <button
                                key={option}
                                onClick={() => {
                                    setFormData({ ...formData, [currentQ.id]: option });
                                    setTimeout(handleNext, 300);
                                }}
                                className={`reg-option-btn ${isSelected ? 'selected' : ''}`}
                            >
                                <div className={`reg-option-key ${isSelected ? 'selected' : ''}`}>
                                    <span className="reg-option-key-text">
                                        {String.fromCharCode(65 + idx)}
                                    </span>
                                </div>
                                {option}
                            </button>
                        );
                    })}
                </div>
            );
        }

        if (currentQ.type === 'multiselect') {
            return (
                <div className="reg-options-list">
                    {currentQ.options.map((option) => {
                        const isSelected = formData[currentQ.id].includes(option);
                        return (
                            <button
                                key={option}
                                onClick={() => toggleMultiSelect(option)}
                                className={`reg-option-btn ${isSelected ? 'selected' : ''}`}
                            >
                                <div className={`reg-option-key ${isSelected ? 'selected' : ''}`}>
                                    {isSelected && <Check size={16} style={{ color: 'var(--background)' }} />}
                                </div>
                                {option}
                            </button>
                        );
                    })}
                </div>
            );
        }
    };

    if (step === 'success') {
        return (
            <div className="reg-fullscreen-centered">
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
            <div className="reg-fullscreen-centered">
                <div className="animate-in" style={{ textAlign: 'center' }}>
                    <div className="reg-spinner" />
                    <h2 className="reg-spinner-title">Initializing Workspace...</h2>
                </div>
            </div>
        );
    }

    return (
        <div className="reg-fullscreen">
            {/* Top Progress Bar */}
            {typeof step === 'number' && step > 0 && (
                <div className="reg-progress-bar">
                    <div className="reg-progress-fill" style={{ width: `${progress}%` }} />
                </div>
            )}

            {/* Main Content Vertical Center */}
            <div className="reg-content">
                <div className="reg-content-inner">
                    <div key={`step-${step}`} className="animate-in" style={{ animationDuration: '0.5s' }}>

                        {typeof step === 'number' && step > 0 && (
                            <div className="reg-step-indicator">
                                <span className="reg-step-number">{step}</span>
                                <span><ArrowRight size={14} opacity={0.5} /></span>
                                <span>{currentQ.id.replace('_', ' ').toUpperCase()}</span>
                            </div>
                        )}

                        {currentQ.type === 'welcome' ? (
                            <div style={{ textAlign: 'center' }}>
                                <h1 className="reg-welcome-title">
                                    {isGoogleUser ? 'Complete Your Profile' : 'Welcome to OfferPro'}
                                </h1>
                                <p className="reg-welcome-subtitle">
                                    {isGoogleUser
                                        ? "You're almost there. Let's set up your organization to get started."
                                        : "Let's initialize your corporate workspace. This multi-step process configures your organization's entire document footprint."
                                    }
                                </p>
                                <button
                                    onClick={handleNext}
                                    className="btn-cinematic"
                                    style={{ fontSize: '1.125rem', padding: '1rem 2.5rem', borderRadius: '99px' }}
                                >
                                    Begin Configuration <ArrowRight size={20} />
                                </button>
                            </div>
                        ) : (
                            <div>
                                <h2 className="reg-question-title" style={{ marginBottom: currentQ.subtitle ? '0.5rem' : '2rem' }}>
                                    {currentQ.label}
                                    {currentQ.optional && <span className="reg-optional-tag">(Optional)</span>}
                                </h2>

                                {currentQ.subtitle && (
                                    <p className="reg-question-subtitle">{currentQ.subtitle}</p>
                                )}

                                {renderInput()}

                                {error && (
                                    <div className="reg-error">
                                        <div className="reg-error-dot" />
                                        <div className="reg-error-text">
                                            <strong>Error:</strong> {error}
                                        </div>
                                    </div>
                                )}

                                <div className="reg-actions">
                                    <button
                                        onClick={handleNext}
                                        disabled={loading}
                                        className="btn-cinematic"
                                        style={{ padding: '0.75rem 2rem', fontSize: '1.125rem' }}
                                    >
                                        {loading ? 'Processing...' : (step === questions.length - 1 ? 'Complete Setup' : 'Next')}
                                        {!loading && <ChevronRight size={20} />}
                                    </button>

                                    {currentQ.type === 'text' || currentQ.type === 'email' || currentQ.type === 'password' || currentQ.type === 'textarea' ? (
                                        <span className="reg-enter-hint">
                                            Press <strong>Enter ↵</strong>
                                        </span>
                                    ) : null}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

            </div>

            {/* Navigation Controls Footer */}
            <div className="reg-footer">
                <button
                    onClick={handleBack}
                    disabled={loading}
                    className="reg-back-btn"
                >
                    <ArrowLeft size={16} />
                    {step === 0 ? (isGoogleUser ? 'Sign Out' : 'Back to Sign In') : 'Go Back'}
                </button>

                {typeof step === 'number' && step > 0 && (
                    <div className="reg-progress-text">
                        {Math.round(progress)}% COMPLETED
                    </div>
                )}
            </div>
        </div>
    );
}
