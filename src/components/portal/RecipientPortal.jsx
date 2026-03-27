import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Check, X, ShieldCheck, Mail, AlertCircle, Building, FileText, CheckCircle2 } from 'lucide-react';
import SignatureCanvas from '../bulk/shared/SignatureCanvas';
import RecipientStatusBadge from '../bulk/shared/RecipientStatusBadge';

export default function RecipientPortal({ documentId }) {
    const [loading, setLoading] = useState(true);
    const [docData, setDocData] = useState(null);
    const [status, setStatus] = useState('pending'); // pending, signed, declined, expired
    const [showSignModal, setShowSignModal] = useState(false);
    const [showDeclineModal, setShowDeclineModal] = useState(false);

    const signatureRef = useRef(null);

    useEffect(() => {
        // Simulate fetching document data securely via token/ID
        const timer = setTimeout(() => {
            setDocData({
                id: documentId || 'DOC-90210',
                type: 'Offer Letter',
                title: 'Full-Time Employment Offer',
                companyName: 'Acme Corp',
                recipientName: 'Rahul Sharma',
                role: 'UI Designer',
                expiryDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toLocaleDateString(),
                contentHtml: `
          <div style="font-family: serif; line-height: 1.6; color: #333;">
            <h2 style="text-align: center; margin-bottom: 2rem;">OFFER OF EMPLOYMENT</h2>
            <p>Dear Rahul,</p>
            <p>We are thrilled to offer you the position of <strong>UI Designer</strong> at Acme Corp. We believe your skills and experience are an excellent match for our company.</p>
            <p><strong>Start Date:</strong> April 1, 2026<br/>
               <strong>Location:</strong> Chennai (Hybrid)<br/>
               <strong>Compensation:</strong> ₹25,000 per month
            </p>
            <p>This offer is contingent upon the successful completion of a background check. By signing this document, you accept the terms outlined within the full employment agreement attached.</p>
            <br/><br/>
            <p>Sincerely,</p>
            <p><strong>Nikhil Srinath</strong><br/>CEO, Acme Corp</p>
          </div>
        `
            });
            setLoading(false);
        }, 1200);
        return () => clearTimeout(timer);
    }, [documentId]);

    const handleSign = () => {
        if (signatureRef.current) {
            const sigData = signatureRef.current.getSignatureData();
            if (!sigData) {
                alert('Please provide a signature before submitting.');
                return;
            }
            // Simulate API call to save signature
            setShowSignModal(false);
            setStatus('signed');
        }
    };

    const handleDecline = () => {
        // Simulate API call to decline offer
        setShowDeclineModal(false);
        setStatus('declined');
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#0A0A0F', color: '#fff' }}>
                <div style={{ width: '40px', height: '40px', border: '3px solid rgba(255,255,255,0.1)', borderTopColor: 'var(--gold, #F5C842)', borderRadius: '50%', animation: 'spin 1s linear infinite', marginBottom: '1.5rem' }} />
                <span style={{ fontWeight: 600, fontSize: '0.875rem', opacity: 0.6, letterSpacing: '0.05em' }}>SECURING SECURE CONNECTION...</span>
            </div>
        );
    }

    // Determine portal theme based on light/dark. We force a clean, trusted look.
    return (
        <div style={{ minHeight: '100vh', background: '#f8f9fb', fontFamily: 'var(--font-main, sans-serif)', color: '#18181b' }}>
            {/* Top Navbar */}
            <nav style={{ background: '#fff', borderBottom: '1px solid rgba(0,0,0,0.08)', padding: '1rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 100 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ background: '#0A0A0F', color: '#F5C842', padding: '0.5rem', borderRadius: '8px' }}>
                        <Building size={20} />
                    </div>
                    <div>
                        <h1 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 800 }}>{docData?.companyName}</h1>
                        <p style={{ margin: 0, fontSize: '0.75rem', color: '#71717a' }}>Secure Document Portal</p>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.875rem', color: '#71717a' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><ShieldCheck size={16} color="#2EE8A0" /> Encrypted</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Mail size={16} /> {docData?.recipientName}</span>
                </div>
            </nav>

            {/* Main Content Area */}
            <div className="recipient-portal-layout" style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>

                {/* Document Viewer */}
                <div style={{ flex: 1 }}>
                    {status === 'signed' && (
                        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '1.5rem', borderRadius: '12px', marginBottom: '1.5rem', display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                            <CheckCircle2 size={24} color="#059669" style={{ marginTop: '0.25rem' }} />
                            <div>
                                <h3 style={{ margin: '0 0 0.25rem 0', color: '#065f46', fontSize: '1.125rem' }}>Document Signed Successfully</h3>
                                <p style={{ margin: 0, color: '#047857', fontSize: '0.875rem' }}>You have legally signed this document. A confirmation email with the final PDF will be sent to your inbox shortly.</p>
                            </div>
                        </motion.div>
                    )}

                    {status === 'declined' && (
                        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '1.5rem', borderRadius: '12px', marginBottom: '1.5rem', display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                            <AlertCircle size={24} color="#dc2626" style={{ marginTop: '0.25rem' }} />
                            <div>
                                <h3 style={{ margin: '0 0 0.25rem 0', color: '#991b1b', fontSize: '1.125rem' }}>Document Declined</h3>
                                <p style={{ margin: 0, color: '#b91c1c', fontSize: '0.875rem' }}>You have declined this document. The issuer has been notified of your decision.</p>
                            </div>
                        </motion.div>
                    )}

                    <div style={{ background: '#fff', borderRadius: '12px', boxShadow: '0 4px 24px rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                        <div style={{ padding: '1.5rem', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafafa' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <FileText size={20} color="#71717a" />
                                <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Page 1 of 1</span>
                            </div>
                            <button style={{ background: 'transparent', border: '1px solid rgba(0,0,0,0.1)', padding: '0.4rem 0.8rem', borderRadius: '6px', fontSize: '0.8125rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.375rem', fontWeight: 600 }}>
                                <Download size={14} /> Download PDF
                            </button>
                        </div>

                        {/* The Document Page */}
                        <div style={{ padding: '4rem', minHeight: '800px', background: '#fff' }} dangerouslySetInnerHTML={{ __html: docData?.contentHtml }} />

                        {status === 'signed' && (
                            <div style={{ padding: '0 4rem 4rem 4rem' }}>
                                <div style={{ borderTop: '2px solid #000', width: '250px', paddingTop: '0.5rem', marginTop: '2rem' }}>
                                    <img src="https://upload.wikimedia.org/wikipedia/commons/f/fa/Signature_of_John_Hancock.png" alt="Signature" style={{ maxHeight: '60px', width: 'auto', display: 'block', marginBottom: '0.5rem', opacity: 0.8 }} />
                                    <div style={{ fontSize: '0.75rem', color: '#71717a', fontFamily: 'monospace' }}>
                                        Digitally Signed by {docData?.recipientName}<br />
                                        {new Date().toLocaleString()}<br />
                                        IP: 192.168.1.1 &bull; ID: {docData?.id}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Action Sidebar */}
                <div className="recipient-portal-sidebar">
                    <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid rgba(0,0,0,0.08)', padding: '2rem', boxShadow: '0 10px 30px rgba(0,0,0,0.04)' }}>
                        <div style={{ marginBottom: '1.5rem' }}>
                            <RecipientStatusBadge status={status === 'signed' ? 'accepted' : status} />
                        </div>
                        <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.5rem', fontWeight: 800 }}>{docData?.title}</h2>
                        <p style={{ margin: '0 0 2rem 0', color: '#71717a', fontSize: '0.875rem', lineHeight: 1.6 }}>Please review the document carefully. By signing, you agree to the terms and conditions set forth by {docData?.companyName}.</p>

                        <div style={{ background: '#f4f4f5', padding: '1rem', borderRadius: '8px', marginBottom: '2rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                                <span style={{ color: '#71717a' }}>Document ID</span>
                                <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{docData?.id}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                                <span style={{ color: '#71717a' }}>Expires On</span>
                                <span style={{ fontWeight: 600 }}>{docData?.expiryDate}</span>
                            </div>
                        </div>

                        {status === 'pending' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                <button onClick={() => setShowSignModal(true)} style={{ width: '100%', background: '#0A0A0F', color: '#F5C842', border: 'none', padding: '1rem', borderRadius: '8px', fontSize: '1rem', fontWeight: 700, cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', transition: 'transform 0.2s', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                                    <Check size={18} /> Sign Document
                                </button>
                                <button onClick={() => setShowDeclineModal(true)} style={{ width: '100%', background: 'transparent', color: '#71717a', border: '1px solid rgba(0,0,0,0.1)', padding: '1rem', borderRadius: '8px', fontSize: '1rem', fontWeight: 600, cursor: 'pointer', transition: 'background 0.2s' }}>
                                    Decline to Sign
                                </button>
                            </div>
                        )}

                        {(status === 'signed' || status === 'declined') && (
                            <div style={{ textAlign: 'center', padding: '1rem', background: '#f4f4f5', borderRadius: '8px', color: '#71717a', fontSize: '0.875rem' }}>
                                Your response has been recorded securely. You may safely close this tab window.
                            </div>
                        )}
                    </div>

                    <div style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.75rem', color: '#a1a1aa' }}>
                        Powered securely by <strong>OfferPro Sign</strong>
                    </div>
                </div>
            </div>

            {/* Signature Modal */}
            <AnimatePresence>
                {showSignModal && (
                    <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowSignModal(false)} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} />

                        <motion.div initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }} style={{ position: 'relative', width: '100%', maxWidth: '600px', background: 'var(--surface, #161619)', borderRadius: '16px', border: '1px solid var(--border, rgba(255,255,255,0.1))', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }} className="dark-theme-override">
                            {/* Force dark mode specifically for this modal to match OfferPro aesthetics */}
                            <style>{`
                .dark-theme-override {
                  --surface: #0f0f12;
                  --background: #09090b;
                  --border: rgba(255,255,255,0.08);
                  --text-primary: #fff;
                  --text-secondary: #a1a1aa;
                  --text-muted: #71717a;
                  --gold: #F5C842;
                }
              `}</style>

                            <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface)' }}>
                                <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.25rem', fontWeight: 700 }}>Adopt Your Signature</h3>
                                <button onClick={() => setShowSignModal(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0.25rem' }}><X size={20} /></button>
                            </div>

                            <div style={{ padding: '1.5rem', background: 'var(--background)' }}>
                                <p style={{ margin: '0 0 1.5rem 0', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                                    By signing, you agree that your electronic signature is the legally binding equivalent to your handwritten signature.
                                </p>
                                <SignatureCanvas onSave={signatureRef} />
                            </div>

                            <div style={{ padding: '1.5rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface)' }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                                    <ShieldCheck size={14} /> Legally Binding
                                </div>
                                <div style={{ display: 'flex', gap: '1rem' }}>
                                    <button onClick={() => setShowSignModal(false)} style={{ background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border)', padding: '0.75rem 1.5rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
                                    <button onClick={handleSign} style={{ background: 'var(--gold)', color: '#000', border: 'none', padding: '0.75rem 2rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '1rem', boxShadow: '0 4px 12px rgba(245, 200, 66, 0.2)' }}>Adopt & Sign</button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Decline Modal */}
            <AnimatePresence>
                {showDeclineModal && (
                    <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowDeclineModal(false)} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} />

                        <motion.div initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }} style={{ position: 'relative', width: '100%', maxWidth: '500px', background: '#fff', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}>
                            <div style={{ padding: '2rem' }}>
                                <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.5rem' }}>
                                    <AlertCircle size={24} color="#dc2626" />
                                </div>
                                <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.25rem', fontWeight: 800 }}>Decline to Sign?</h3>
                                <p style={{ margin: '0 0 1.5rem 0', color: '#71717a', fontSize: '0.875rem', lineHeight: 1.6 }}>
                                    If you choose to decline, you will not be able to sign this document later without the issuer sending a new request. Please provide a reason for the issuer (optional).
                                </p>

                                <textarea
                                    placeholder="Reason for declining..."
                                    style={{ width: '100%', padding: '1rem', border: '1px solid rgba(0,0,0,0.1)', borderRadius: '8px', minHeight: '100px', outline: 'none', fontFamily: 'inherit', resize: 'vertical' }}
                                />

                                <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
                                    <button onClick={() => setShowDeclineModal(false)} style={{ flex: 1, background: '#f4f4f5', color: '#18181b', border: 'none', padding: '0.75rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
                                    <button onClick={handleDecline} style={{ flex: 1, background: '#dc2626', color: '#fff', border: 'none', padding: '0.75rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>Yes, Decline</button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
