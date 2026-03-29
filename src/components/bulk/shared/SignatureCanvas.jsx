import React, { useRef, useState } from 'react';
import SignaturePad from 'react-signature-canvas';
import { RotateCcw, Image as ImageIcon, Type, Upload } from 'lucide-react';

export default function SignatureCanvas({ onSave }) {
    const sigPad = useRef(null);
    const [activeTab, setActiveTab] = useState('draw'); // draw, upload, type
    const [typedName, setTypedName] = useState('');
    const [selectedFont, setSelectedFont] = useState('font-signature-1'); // e.g., 'font-signature-1'
    const [previewImage, setPreviewImage] = useState(null);

    const handleClear = () => {
        if (sigPad.current) {
            sigPad.current.clear();
        }
    };

    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                setPreviewImage(event.target.result);
            };
            reader.readAsDataURL(file);
        }
    };

    // Capture the current signature based on active tab
    // E.g., if drawing, return base64
    // For typed, typically we render it to canvas or return formatted text
    // Here we just use a placeholder text or base64
    const getSignatureData = () => {
        if (activeTab === 'draw' && sigPad.current && !sigPad.current.isEmpty()) {
            return { type: 'draw', data: sigPad.current.getTrimmedCanvas().toDataURL('image/png') };
        }
        if (activeTab === 'upload' && previewImage) {
            return { type: 'upload', data: previewImage };
        }
        if (activeTab === 'type' && typedName.trim() !== '') {
            return { type: 'type', data: typedName, font: selectedFont };
        }
        return null;
    };

    // Effect to trigger onSave when relevant signature is obtained 
    // Normally would happen on a "Save" button click, but we expose an imperative handle if needed
    React.useImperativeHandle(onSave, () => ({
        getSignatureData
    }));

    return (
        <div className="signature-container" style={{ border: '1px solid var(--border)', borderRadius: '12px', background: 'var(--surface)', overflow: 'hidden' }}>
            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
                {[
                    { id: 'draw', label: 'Draw', icon: RotateCcw },
                    { id: 'upload', label: 'Upload', icon: Upload },
                    { id: 'type', label: 'Type', icon: Type }
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        style={{
                            flex: 1,
                            padding: '1rem',
                            background: activeTab === tab.id ? 'var(--blue-muted)' : 'transparent',
                            border: 'none',
                            borderBottom: activeTab === tab.id ? '2px solid var(--blue)' : '2px solid transparent',
                            color: activeTab === tab.id ? 'var(--blue)' : 'var(--text-muted)',
                            fontSize: '0.875rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.5rem',
                            transition: 'all 0.2s'
                        }}
                    >
                        <tab.icon size={16} />
                        {tab.label}
                    </button>
                ))}
            </div>

            <div style={{ padding: '1.5rem', minHeight: '200px', display: 'flex', flexDirection: 'column' }}>
                {activeTab === 'draw' && (
                    <div style={{ position: 'relative', width: '100%', height: '200px', border: '1px dashed var(--border)', borderRadius: '8px', background: 'var(--background)' }}>
                        <SignaturePad
                            ref={sigPad}
                            canvasProps={{
                                style: { width: '100%', height: '100%', cursor: 'crosshair', borderRadius: '8px' }
                            }}
                            penColor="var(--text-primary)"
                        />
                        <button
                            onClick={handleClear}
                            style={{ position: 'absolute', bottom: '10px', right: '10px', background: 'var(--surface)', border: '1px solid var(--border)', padding: '0.4rem 0.8rem', borderRadius: '6px', fontSize: '0.75rem', cursor: 'pointer', color: 'var(--text-secondary)' }}
                        >
                            Clear
                        </button>
                    </div>
                )}

                {activeTab === 'upload' && (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', border: '1px dashed var(--border)', borderRadius: '8px', padding: '2rem' }}>
                        {previewImage ? (
                            <div style={{ position: 'relative' }}>
                                <img src={previewImage} alt="Signature Preview" style={{ maxHeight: '100px', maxWidth: '100%', objectFit: 'contain' }} />
                                <button
                                    onClick={() => setPreviewImage(null)}
                                    style={{ position: 'absolute', top: -10, right: -10, background: 'var(--error)', color: 'white', border: 'none', borderRadius: '50%', width: 24, height: 24, cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
                                >
                                    &times;
                                </button>
                            </div>
                        ) : (
                            <>
                                <div style={{ background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '50%' }}>
                                    <ImageIcon size={32} color="var(--text-muted)" />
                                </div>
                                <div style={{ textAlign: 'center' }}>
                                    <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-primary)', fontWeight: 600 }}>Upload signature image</p>
                                    <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>PNG or JPG (transparent bg recommended)</p>
                                </div>
                                <label style={{ display: 'inline-block', background: 'var(--surface)', border: '1px solid var(--border)', padding: '0.5rem 1rem', borderRadius: '6px', fontSize: '0.875rem', cursor: 'pointer', fontWeight: 600 }}>
                                    Browse Files
                                    <input type="file" accept="image/png, image/jpeg" style={{ display: 'none' }} onChange={handleFileUpload} />
                                </label>
                            </>
                        )}
                    </div>
                )}

                {activeTab === 'type' && (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        <input
                            type="text"
                            placeholder="Type your full name"
                            value={typedName}
                            onChange={(e) => setTypedName(e.target.value)}
                            style={{ width: '100%', padding: '0.75rem 1rem', background: 'var(--background)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '1rem', outline: 'none' }}
                        />

                        <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
                            {['Caveat', 'Dancing Script', 'Pacifico', 'Great Vibes'].map((font, idx) => (
                                <label key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                    <input
                                        type="radio"
                                        name="signature-font"
                                        checked={selectedFont === `font-${idx}`}
                                        onChange={() => setSelectedFont(`font-${idx}`)}
                                        style={{ accentColor: 'var(--blue)' }}
                                    />
                                    <div style={{
                                        padding: '1rem 1.5rem',
                                        background: selectedFont === `font-${idx}` ? 'var(--blue-muted)' : 'var(--background)',
                                        border: `1px solid ${selectedFont === `font-${idx}` ? 'var(--blue)' : 'var(--border)'}`,
                                        borderRadius: '8px',
                                        fontFamily: `"${font}", cursive`,
                                        fontSize: '1.5rem',
                                        color: 'var(--text-primary)',
                                        whiteSpace: 'nowrap'
                                    }}>
                                        {typedName || 'Signature'}
                                    </div>
                                </label>
                            ))}
                        </div>

                        <style>{`
              @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@600&family=Dancing+Script:wght@600&family=Great+Vibes&family=Pacifico&display=swap');
            `}</style>
                    </div>
                )}
            </div>
        </div>
    );
}
