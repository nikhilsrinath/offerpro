export default function CertificatePreview({ formData }) {
  const d = formData || {};

  return (
    <div
      id="certificate-capture-area"
      className="certificate-preview-root"
      style={{
        width: '1123px', // A4 Landscape at 96 DPI
        height: '794px',
        background: '#ffffff',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start', // Use flex-start with padding for strict layout
        padding: '100px 100px 60px', // More top padding for logo
        fontFamily: "'Montserrat', sans-serif",
        boxSizing: 'border-box'
      }}
    >
      {/* Google Fonts Import in style tag for the preview */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&family=Cormorant+Garamond:wght@400;600&family=Montserrat:wght@400;700;800&display=swap');
      `}</style>

      {/* TOP-LEFT WAVE */}
      <svg
        style={{ position: 'absolute', top: 0, left: 0, width: '260px', height: '380px', pointerEvents: 'none' }}
        viewBox="0 0 220 340"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
      >
        <g opacity="0.85">
          <path d="M-10,20 C30,60 80,40 100,80 C120,120 60,160 80,200 C100,240 160,220 180,260 C200,300 170,340 140,360" stroke="#d4af37" strokeWidth="0.8" fill="none" opacity="0.4" />
          <path d="M-20,10 C20,55 75,35 95,78 C115,118 55,158 78,198 C98,238 158,218 178,258 C198,298 168,338 138,358" stroke="#d4af37" strokeWidth="0.7" fill="none" opacity="0.35" />
          <path d="M5,0 C45,50 90,30 112,75 C134,118 70,162 92,205 C112,248 172,228 190,270" stroke="#d4af37" strokeWidth="0.7" fill="none" opacity="0.3" />
        </g>
      </svg>

      {/* BOTTOM-RIGHT WAVE */}
      <svg
        style={{ position: 'absolute', bottom: 0, right: 0, width: '260px', height: '380px', pointerEvents: 'none', transform: 'rotate(180deg)' }}
        viewBox="0 0 220 340"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
      >
        <g opacity="0.85">
          <path d="M-10,20 C30,60 80,40 100,80 C120,120 60,160 80,200 C100,240 160,220 180,260 C200,300 170,340 140,360" stroke="#d4af37" strokeWidth="0.8" fill="none" opacity="0.4" />
          <path d="M-20,10 C20,55 75,35 95,78 C115,118 55,158 78,198 C98,238 158,218 178,258 C198,298 168,338 138,358" stroke="#d4af37" strokeWidth="0.7" fill="none" opacity="0.35" />
          <path d="M5,0 C45,50 90,30 112,75 C134,118 70,162 92,205 C112,248 172,228 190,270" stroke="#d4af37" strokeWidth="0.7" fill="none" opacity="0.3" />
        </g>
      </svg>

      {/* LOGO - Now in flex flow to prevent overlap */}
      <div style={{ height: '70px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '40px' }}>
        {d.logo ? (
          <img src={d.logo} alt="Logo" style={{ height: '60px', objectFit: 'contain' }} />
        ) : (
          <div style={{ height: '60px' }} />
        )}
      </div>

      {/* HEADER SECTION */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '36px' }}>
        <div style={{ fontWeight: 800, fontSize: '64px', letterSpacing: '12px', color: '#1a1a2e', textTransform: 'uppercase', marginBottom: '4px', lineHeight: 1 }}>
          Certificate
        </div>
        <div style={{ fontWeight: 700, fontSize: '20px', letterSpacing: '14px', color: '#b8960c', textTransform: 'uppercase' }}>
          of Achievement
        </div>
      </div>

      {/* RECIPIENT SECTION */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '32px' }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontWeight: 400, fontSize: '17.5px', letterSpacing: '5px', color: '#666', textTransform: 'uppercase', marginBottom: '16px' }}>
          This is to pridefully present to
        </div>
        <div style={{ fontFamily: "'Dancing Script', cursive", fontWeight: 700, fontSize: '88px', color: '#1a1a2e', lineHeight: 0.9 }}>
          {d.recipientName || 'Recipient Name'}
        </div>
        {/* NAME UNDERLINE */}
        <div style={{ width: '560px', margin: '14px 0 0' }}>
          <svg viewBox="0 0 520 12" xmlns="http://www.w3.org/2000/svg" fill="none" preserveAspectRatio="none" style={{ width: '100%', height: '12px' }}>
            <line x1="15" y1="6" x2="505" y2="6" stroke="#b8960c" strokeWidth="1.2" />
            <rect x="0" y="3" width="6" height="6" fill="#b8960c" transform="rotate(45 3 6)" />
            <rect x="514" y="3" width="6" height="6" fill="#b8960c" transform="rotate(45 3 6)" />
          </svg>
        </div>
      </div>

      {/* ACHIEVEMENT SECTION */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '44px', textAlign: 'center' }}>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '20px', color: '#666', textTransform: 'uppercase', letterSpacing: '4.5px', marginBottom: '12px' }}>
          for demonstrating exceptional competence in
        </div>
        <div style={{ fontWeight: 700, fontSize: '36px', color: '#1a1a2e', textTransform: 'uppercase', letterSpacing: '2.5px', maxWidth: '860px' }}>
          {d.achievementTitle || 'Achievement Title'}
        </div>
      </div>

      {/* DESCRIPTION TEXT */}
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '18px', color: '#444', textAlign: 'center', lineHeight: 1.8, marginBottom: '55px', maxWidth: '840px' }}>
        {d.description || (
          <>
            This certificate recognizes the exceptional dedication and high internal standards
            maintained throughout the program. Awarded by <strong>{d.issuingOrganization || 'the organization'}</strong>
            to signify professional achievement and technical mastery in the field.
          </>
        )}
      </div>

      {/* FINAL FOOTER WITH SINGLE CENTERED SIGNATURE */}
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', position: 'relative' }}>
        {/* Signature Line Area */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 2 }}>
          {d.signature ? (
            <img src={d.signature} alt="Signature" style={{ height: '60px', objectFit: 'contain', marginBottom: '-10px' }} />
          ) : (
            <div style={{ height: '60px' }} />
          )}
          <div style={{ width: '320px', height: '1.5px', background: '#333' }}></div>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '24px', fontWeight: 600, color: '#b8960c', marginTop: '12px', letterSpacing: '1px' }}>
            {d.authorizedSignatory || 'Authorized Signature'}
          </div>
          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '15px', color: '#888', textTransform: 'uppercase', letterSpacing: '2.5px', marginTop: '6px' }}>
            {d.signatoryDesignation || 'Mentor & Program Lead'}
          </div>
        </div>

        {/* Gold Seal positioned with a symmetrical offset */}
        <div style={{ position: 'absolute', bottom: '15px', right: '50%', transform: 'translateX(-280px)', opacity: 0.95 }}>
          <svg style={{ width: '120px', height: '125px' }} viewBox="0 0 100 110" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <radialGradient id="sealGrad" cx="35%" cy="30%" r="65%">
                <stop offset="0%" stopColor="#f5e17a" />
                <stop offset="30%" stopColor="#d4af37" />
                <stop offset="65%" stopColor="#a07820" />
                <stop offset="100%" stopColor="#7a5c10" />
              </radialGradient>
              <radialGradient id="sealInner" cx="35%" cy="30%" r="65%">
                <stop offset="0%" stopColor="#f8eda0" />
                <stop offset="40%" stopColor="#d4af37" />
                <stop offset="100%" stopColor="#8a6510" />
              </radialGradient>
            </defs>
            <polygon points="36,88 44,88 40,110 32,105" fill="#c9a227" />
            <polygon points="56,88 64,88 68,105 60,110" fill="#a07820" />
            <circle cx="50" cy="52" r="36" fill="url(#sealGrad)" />
            <g fill="url(#sealGrad)">
              {[0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5, 180, 202.5, 225, 247.5, 270, 292.5, 315, 337.5].map((angle, idx) => {
                const r = 36;
                const x = 50 + r * Math.cos((angle * Math.PI) / 180);
                const y = 52 + r * Math.sin((angle * Math.PI) / 180);
                return <circle key={idx} cx={x} cy={y} r="4" />;
              })}
            </g>
            <circle cx="50" cy="52" r="28" fill="url(#sealInner)" />
            <ellipse cx="42" cy="38" rx="10" ry="7" fill="rgba(255,255,200,0.18)" transform="rotate(-20 42 38)" />
          </svg>
        </div>
      </div>
    </div>
  );
}
