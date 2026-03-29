import { useState, useRef, useEffect, useCallback } from 'react';
import { Pen, Upload, Type, X, RotateCcw } from 'lucide-react';

const SIGNATURE_FONTS = [
  { name: 'Dancing Script', style: "'Dancing Script', cursive" },
  { name: 'Great Vibes', style: "'Great Vibes', cursive" },
  { name: 'Pacifico', style: "'Pacifico', cursive" },
  { name: 'Satisfy', style: "'Satisfy', cursive" },
];

export default function SignatureCapture({ onSignatureChange, initialSignature = null }) {
  const [activeTab, setActiveTab] = useState('draw');
  const [typedName, setTypedName] = useState('');
  const [selectedFont, setSelectedFont] = useState(0);
  const [uploadedImage, setUploadedImage] = useState(null);
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const fileInputRef = useRef(null);

  // Load Google Fonts for typed signatures
  useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&family=Great+Vibes&family=Pacifico&family=Satisfy&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);

  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = 160;
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  useEffect(() => {
    if (activeTab === 'draw') {
      setTimeout(initCanvas, 50);
    }
  }, [activeTab, initCanvas]);

  const getPosition = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const startDrawing = (e) => {
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const pos = getPosition(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    setIsDrawing(true);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const pos = getPosition(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setHasDrawn(true);
  };

  const stopDrawing = () => {
    if (isDrawing) {
      setIsDrawing(false);
      emitSignature();
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
    onSignatureChange?.(null, 'draw');
  };

  const emitSignature = () => {
    if (activeTab === 'draw' && canvasRef.current) {
      const dataUrl = canvasRef.current.toDataURL('image/png');
      onSignatureChange?.(dataUrl, 'draw');
    }
  };

  const handleUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setUploadedImage(ev.target.result);
      onSignatureChange?.(ev.target.result, 'upload');
    };
    reader.readAsDataURL(file);
  };

  const generateTypedSignature = useCallback(() => {
    if (!typedName.trim()) {
      onSignatureChange?.(null, 'typed');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'transparent';
    ctx.fillRect(0, 0, 400, 120);
    ctx.fillStyle = '#1a1a2e';
    ctx.font = `48px ${SIGNATURE_FONTS[selectedFont].style}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(typedName, 200, 60);
    onSignatureChange?.(canvas.toDataURL('image/png'), 'typed');
  }, [typedName, selectedFont, onSignatureChange]);

  useEffect(() => {
    if (activeTab === 'type') {
      generateTypedSignature();
    }
  }, [activeTab, typedName, selectedFont, generateTypedSignature]);

  const tabs = [
    { id: 'draw', label: 'Draw', icon: Pen },
    { id: 'upload', label: 'Upload', icon: Upload },
    { id: 'type', label: 'Type', icon: Type },
  ];

  return (
    <div className="sig-capture">
      <label className="sig-capture-label">Sign Here</label>
      <div className="sig-capture-tabs">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            className={`sig-capture-tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'draw' && (
        <div className="sig-capture-draw-area">
          <div className="sig-capture-canvas-wrap">
            <canvas
              ref={canvasRef}
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
              className="sig-capture-canvas"
            />
            {!hasDrawn && (
              <div className="sig-capture-placeholder">Draw your signature</div>
            )}
          </div>
          <button type="button" onClick={clearCanvas} className="sig-capture-clear-btn">
            <RotateCcw size={14} /> Clear
          </button>
        </div>
      )}

      {activeTab === 'upload' && (
        <div className="sig-capture-upload-area">
          <input
            ref={fileInputRef}
            type="file"
            accept=".png,.jpg,.jpeg"
            onChange={handleUpload}
            style={{ display: 'none' }}
          />
          {uploadedImage ? (
            <div className="sig-capture-upload-preview">
              <img src={uploadedImage} alt="Signature" />
              <button type="button" onClick={() => { setUploadedImage(null); onSignatureChange?.(null, 'upload'); }} className="sig-capture-clear-btn">
                <X size={14} /> Remove
              </button>
            </div>
          ) : (
            <div
              className="sig-capture-upload-zone"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={24} />
              <span>Upload .png / .jpg</span>
              <span className="sig-capture-upload-hint">Transparent background recommended</span>
            </div>
          )}
        </div>
      )}

      {activeTab === 'type' && (
        <div className="sig-capture-type-area">
          <input
            type="text"
            placeholder="Type your full name"
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            className="sig-capture-type-input"
          />
          <div className="sig-capture-font-options">
            {SIGNATURE_FONTS.map((font, i) => (
              <button
                key={i}
                type="button"
                className={`sig-capture-font-btn ${selectedFont === i ? 'active' : ''}`}
                onClick={() => setSelectedFont(i)}
                style={{ fontFamily: font.style }}
              >
                {typedName || 'Your Name'}
              </button>
            ))}
          </div>
          {typedName && (
            <div className="sig-capture-type-preview" style={{ fontFamily: SIGNATURE_FONTS[selectedFont].style }}>
              {typedName}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
