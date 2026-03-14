import { CERTIFICATE_TEMPLATES } from '../services/certificateTemplates';

export default function CertificatePreview({ formData }) {
  const templateId = formData.template || 'classic';
  const Tpl = templates[templateId] || templates.classic;
  return <Tpl d={formData} />;
}

function fmtDate(d) {
  if (!d) return '___________';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function Img({ src, h, style }) {
  if (!src) return null;
  return <img src={src} alt="" style={{ height: h, objectFit: 'contain', display: 'block', margin: '0 auto', ...style }} />;
}

// Content area: centered column between border and footer
const contentArea = (top, sides, bottomReserve) => ({
  position: 'absolute',
  top, left: sides, right: sides, bottom: bottomReserve,
  display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center',
  textAlign: 'center', gap: 4,
});

// Footer area pinned to bottom
const footerArea = (bottom, sides) => ({
  position: 'absolute',
  bottom, left: sides, right: sides,
});

// Shared footer grid
function FooterGrid({ d, c, l, lc, font }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', textAlign: 'center', fontFamily: font || 'inherit' }}>
      <div>
        <div style={{ fontSize: '10pt', fontWeight: 700, color: c }}>{d.issuingOrganization || '___________'}</div>
        <div style={{ fontSize: '7.5pt', color: l, marginTop: 1 }}>Organization</div>
      </div>
      <div>
        <div style={{ fontSize: '10pt', fontWeight: 700, color: c }}>{fmtDate(d.issueDate)}</div>
        <div style={{ fontSize: '7.5pt', color: l, marginTop: 1 }}>Date of Issue</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Img src={d.signature} h={26} />
        <div style={{ width: 90, borderBottom: `1.5px solid ${lc}`, margin: '1px 0' }} />
        <div style={{ fontSize: '10pt', fontWeight: 700, color: c }}>{d.authorizedSignatory || '___________'}</div>
        <div style={{ fontSize: '7.5pt', color: l, marginTop: 1 }}>{d.signatoryDesignation || ''}</div>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
// 1. CLASSIC
// ═══════════════════════════════════════════════════════════════════

function ClassicTemplate({ d }) {
  return (
    <div className="a4-sheet-landscape" style={{ fontFamily: "'Inter', sans-serif", overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, borderTop: '14px solid #0f172a', borderBottom: '14px solid #0f172a' }} />
      <div style={{ position: 'absolute', top: 14, left: 0, right: 0, height: 3, background: '#2563eb' }} />
      <div style={{ position: 'absolute', bottom: 14, left: 0, right: 0, height: 3, background: '#2563eb' }} />
      <div style={{ position: 'absolute', inset: '24px 20px', border: '2px solid #1e293b' }} />
      <div style={{ position: 'absolute', inset: '30px 26px', border: '0.5px solid #cbd5e1' }} />
      <ClassicCorners />

      <div style={contentArea(38, 60, 110)}>
        <Img src={d.logo} h={48} />
        <div style={{ fontFamily: "'Times New Roman',serif", fontSize: '40pt', fontWeight: 700, color: '#0f172a', marginTop: 4 }}>CERTIFICATE</div>
        <div style={{ fontSize: '12pt', color: '#334155', letterSpacing: '0.3em' }}>OF ACHIEVEMENT</div>
        <div style={{ width: 100, height: 1, background: '#cbd5e1', margin: '4px 0' }} />
        <div style={{ fontSize: '11pt', color: '#64748b' }}>This is proudly presented to</div>
        <div style={{ fontSize: '28pt', fontWeight: 700, color: '#2563eb', marginTop: 2 }}>{(d.recipientName || '___________').toUpperCase()}</div>
        <div style={{ fontSize: '11pt', color: '#64748b', marginTop: 2 }}>for demonstrating excellence in</div>
        <div style={{ fontSize: '15pt', fontWeight: 700, color: '#0f172a' }}>{d.achievementTitle || '___________'}</div>
        {d.description && <div style={{ fontSize: '9.5pt', fontStyle: 'italic', color: '#94a3b8', maxWidth: 500 }}>{d.description}</div>}
      </div>

      <div style={footerArea(34, 60)}>
        <FooterGrid d={d} c="#0f172a" l="#94a3b8" lc="#0f172a" />
      </div>
    </div>
  );
}

function ClassicCorners() {
  const pos = [{ top: 26, left: 22 }, { top: 26, right: 22 }, { bottom: 26, left: 22 }, { bottom: 26, right: 22 }];
  return pos.map((p, i) => (
    <svg key={i} width="10" height="10" viewBox="0 0 10 10" style={{ position: 'absolute', pointerEvents: 'none', ...p }}>
      <circle cx="5" cy="5" r="4" fill="none" stroke="#2563eb" strokeWidth="1.2" /><circle cx="5" cy="5" r="1.5" fill="#2563eb" />
    </svg>
  ));
}


// ═══════════════════════════════════════════════════════════════════
// 2. MODERN
// ═══════════════════════════════════════════════════════════════════

function ModernTemplate({ d }) {
  return (
    <div className="a4-sheet-landscape" style={{ fontFamily: "'Inter', sans-serif", overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: 'linear-gradient(90deg, #3f3f46, #a1a1aa, #3f3f46)' }} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, background: 'linear-gradient(90deg, #3f3f46, #a1a1aa, #3f3f46)' }} />
      <div style={{ position: 'absolute', inset: '24px 28px', border: '0.5px solid #e4e4e7' }} />
      <ModernCorners />

      <div style={contentArea(32, 60, 105)}>
        <Img src={d.logo} h={40} />
        <div style={{ fontSize: '9.5pt', color: '#a1a1aa', letterSpacing: '0.4em', marginTop: 6 }}>CERTIFICATE OF ACHIEVEMENT</div>
        <div style={{ fontSize: '38pt', fontWeight: 700, color: '#18181b', letterSpacing: '-0.02em' }}>CERTIFICATE</div>
        <div style={{ fontSize: '11pt', color: '#a1a1aa', marginTop: 4 }}>This is to certify that</div>
        <div style={{ fontSize: '28pt', fontWeight: 700, color: '#3f3f46', marginTop: 2 }}>{d.recipientName || '___________'}</div>
        <div style={{ width: 50, height: 2.5, background: '#a1a1aa', borderRadius: 2, margin: '2px 0' }} />
        <div style={{ fontSize: '11pt', color: '#71717a' }}>has demonstrated excellence in</div>
        <div style={{ fontSize: '15pt', fontWeight: 600, color: '#3f3f46' }}>{d.achievementTitle || '___________'}</div>
        {d.description && <div style={{ fontSize: '9.5pt', color: '#a1a1aa', maxWidth: 500 }}>{d.description}</div>}
      </div>

      <div style={footerArea(30, 60)}>
        <FooterGrid d={d} c="#3f3f46" l="#a1a1aa" lc="#d4d4d8" />
      </div>
    </div>
  );
}

function ModernCorners() {
  const positions = [
    { top: 12, left: 14 },
    { top: 12, right: 14, transform: 'scaleX(-1)' },
    { bottom: 12, left: 14, transform: 'scaleY(-1)' },
    { bottom: 12, right: 14, transform: 'scale(-1)' },
  ];
  return positions.map((p, i) => (
    <svg key={i} width="48" height="48" viewBox="0 0 48 48" style={{ position: 'absolute', pointerEvents: 'none', ...p }}>
      <line x1="0" y1="0" x2="0" y2="32" stroke="#71717a" strokeWidth="2.5" />
      <line x1="0" y1="0" x2="32" y2="0" stroke="#71717a" strokeWidth="2.5" />
      <line x1="6" y1="6" x2="6" y2="16" stroke="#d4d4d8" strokeWidth="0.8" />
      <line x1="6" y1="6" x2="16" y2="6" stroke="#d4d4d8" strokeWidth="0.8" />
      <circle cx="1" cy="1" r="3" fill="#71717a" />
    </svg>
  ));
}


// ═══════════════════════════════════════════════════════════════════
// 3. GOLD
// ═══════════════════════════════════════════════════════════════════

function GoldTemplate({ d }) {
  return (
    <div className="a4-sheet-landscape" style={{ background: '#fdf8f0', fontFamily: "'Playfair Display','Georgia',serif", overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 6, border: '3px solid #b7791f' }} />
      <div style={{ position: 'absolute', inset: 13, border: '1px solid #c9a84c' }} />
      <div style={{ position: 'absolute', inset: 19, border: '1px dashed rgba(212,160,23,0.3)' }} />
      <GoldCorners />

      <div style={contentArea(28, 60, 105)}>
        <Img src={d.logo} h={44} />
        <div style={{ fontSize: '10pt', color: '#b7791f', letterSpacing: '0.4em', marginTop: 4 }}>CERTIFICATE OF ACHIEVEMENT</div>
        <div style={{ fontSize: '42pt', fontWeight: 700, color: '#5c3d11', lineHeight: 1 }}>CERTIFICATE</div>
        <svg width="240" height="12" viewBox="0 0 240 12" style={{ flexShrink: 0 }}>
          <line x1="0" y1="6" x2="98" y2="6" stroke="#d4a017" strokeWidth="0.6" />
          <circle cx="105" cy="6" r="1.5" fill="#d4a017" />
          <circle cx="120" cy="6" r="4" fill="none" stroke="#d4a017" strokeWidth="1" />
          <circle cx="120" cy="6" r="1.5" fill="#d4a017" />
          <circle cx="135" cy="6" r="1.5" fill="#d4a017" />
          <line x1="142" y1="6" x2="240" y2="6" stroke="#d4a017" strokeWidth="0.6" />
        </svg>
        <div style={{ fontSize: '11pt', color: '#8b6914', marginTop: 2 }}>This is proudly awarded to</div>
        <div style={{ fontSize: '28pt', fontWeight: 700, color: '#b7791f', marginTop: 2 }}>{(d.recipientName || '___________').toUpperCase()}</div>
        <div style={{ fontSize: '11pt', color: '#8b6914', marginTop: 2 }}>for outstanding excellence in</div>
        <div style={{ fontSize: '15pt', fontWeight: 700, color: '#5c3d11', fontStyle: 'italic' }}>{d.achievementTitle || '___________'}</div>
        {d.description && <div style={{ fontSize: '9.5pt', color: '#92720a', fontStyle: 'italic', maxWidth: 480 }}>{d.description}</div>}
      </div>

      <div style={footerArea(30, 60)}>
        <FooterGrid d={d} c="#5c3d11" l="#a08540" lc="#d4a017" font="'Playfair Display',serif" />
      </div>
    </div>
  );
}

function GoldCorners() {
  const positions = [
    { top: 12, left: 12 },
    { top: 12, right: 12, transform: 'scaleX(-1)' },
    { bottom: 12, left: 12, transform: 'scaleY(-1)' },
    { bottom: 12, right: 12, transform: 'scale(-1)' },
  ];
  return positions.map((p, i) => (
    <svg key={i} width="56" height="56" viewBox="0 0 56 56" style={{ position: 'absolute', pointerEvents: 'none', ...p }}>
      <path d="M4,4 C4,26 10,32 32,32" stroke="#d4a017" strokeWidth="2.2" fill="none" />
      <path d="M4,4 C26,4 32,10 32,32" stroke="#d4a017" strokeWidth="2.2" fill="none" />
      <path d="M10,10 C10,22 14,26 26,26" stroke="#b7791f" strokeWidth="0.8" fill="none" />
      <circle cx="32" cy="32" r="2.5" fill="#d4a017" /><circle cx="4" cy="4" r="2.5" fill="#d4a017" />
      <circle cx="18" cy="4" r="1" fill="#d4a017" /><circle cx="4" cy="18" r="1" fill="#d4a017" />
    </svg>
  ));
}


// ═══════════════════════════════════════════════════════════════════
// 4. CORPORATE
// ═══════════════════════════════════════════════════════════════════

function CorporateTemplate({ d }) {
  return (
    <div className="a4-sheet-landscape" style={{ fontFamily: "'Inter', sans-serif", overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, border: '5px solid #1e3a5f' }} />
      <div style={{ position: 'absolute', top: 5, left: 5, right: 5, height: 2.5, background: '#2563eb' }} />
      <div style={{ position: 'absolute', bottom: 5, left: 5, right: 5, height: 2.5, background: '#2563eb' }} />
      <div style={{ position: 'absolute', inset: '14px 14px', border: '0.5px solid #cbd5e1' }} />
      <svg style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', opacity: 0.04, pointerEvents: 'none' }} width="260" height="260" viewBox="0 0 260 260">
        <polygon points="130,0 260,130 130,260 0,130" fill="none" stroke="#1e3a5f" strokeWidth="3" />
        <polygon points="130,40 220,130 130,220 40,130" fill="none" stroke="#1e3a5f" strokeWidth="2" />
        <polygon points="130,80 180,130 130,180 80,130" fill="none" stroke="#1e3a5f" strokeWidth="1.5" />
      </svg>
      <CorpCorners />

      <div style={contentArea(22, 60, 105)}>
        <Img src={d.logo} h={38} />
        <div style={{ fontSize: '38pt', fontWeight: 800, color: '#1e3a5f', marginTop: 4 }}>CERTIFICATE</div>
        <div style={{ fontSize: '12pt', color: '#2563eb', letterSpacing: '0.3em' }}>OF ACHIEVEMENT</div>
        <div style={{ fontSize: '11pt', color: '#64748b', marginTop: 6 }}>Presented to</div>
        <div style={{ fontSize: '28pt', fontWeight: 700, color: '#2563eb', marginTop: 2 }}>{d.recipientName || '___________'}</div>
        <div style={{ width: 50, height: 2.5, background: '#2563eb', borderRadius: 1, margin: '2px 0' }} />
        <div style={{ fontSize: '11pt', color: '#334155' }}>for excellence in</div>
        <div style={{ fontSize: '15pt', fontWeight: 700, color: '#1e3a5f' }}>{d.achievementTitle || '___________'}</div>
        {d.description && <div style={{ fontSize: '9.5pt', color: '#64748b', maxWidth: 500 }}>{d.description}</div>}
      </div>

      <div style={footerArea(30, 60)}>
        <FooterGrid d={d} c="#1e3a5f" l="#94a3b8" lc="#1e3a5f" />
      </div>
    </div>
  );
}

function CorpCorners() {
  const positions = [
    { top: 7, left: 7 },
    { top: 7, right: 7, transform: 'scaleX(-1)' },
    { bottom: 7, left: 7, transform: 'scaleY(-1)' },
    { bottom: 7, right: 7, transform: 'scale(-1)' },
  ];
  return positions.map((p, i) => (
    <svg key={i} width="24" height="24" viewBox="0 0 24 24" style={{ position: 'absolute', pointerEvents: 'none', ...p }}>
      <polygon points="0,0 16,0 0,16" fill="#1e3a5f" opacity="0.12" />
      <line x1="0" y1="0" x2="22" y2="0" stroke="#1e3a5f" strokeWidth="1.5" />
      <line x1="0" y1="0" x2="0" y2="22" stroke="#1e3a5f" strokeWidth="1.5" />
      <circle cx="0" cy="0" r="2.5" fill="#2563eb" />
    </svg>
  ));
}


// ═══════════════════════════════════════════════════════════════════
// 5. ROYAL
// ═══════════════════════════════════════════════════════════════════

function RoyalTemplate({ d }) {
  return (
    <div className="a4-sheet-landscape" style={{ background: '#4c1d95', fontFamily: "'Playfair Display',serif", overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 8, background: '#faf5ff', borderRadius: 2 }} />
      <div style={{ position: 'absolute', inset: 14, border: '1.5px solid #7c3aed' }} />
      <div style={{ position: 'absolute', inset: 20, border: '0.5px solid #c4b5fd' }} />
      <RoyalCorners />
      <svg style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', pointerEvents: 'none' }} width="56" height="34" viewBox="0 0 56 34">
        <path d="M4,26 L4,10 L14,18 L20,5 L28,16 L36,5 L42,18 L52,10 L52,26 Z" fill="#d4a017" />
        <rect x="4" y="26" width="48" height="5" rx="1" fill="#d4a017" />
        <circle cx="14" cy="8" r="2.5" fill="#d4a017" /><circle cx="28" cy="3" r="2.5" fill="#d4a017" /><circle cx="42" cy="8" r="2.5" fill="#d4a017" />
      </svg>

      <div style={contentArea(48, 60, 105)}>
        <Img src={d.logo} h={42} />
        <div style={{ fontSize: '9.5pt', color: '#7c3aed', letterSpacing: '0.45em', marginTop: 4 }}>THIS CERTIFICATE IS AWARDED TO</div>
        <div style={{ fontSize: '30pt', fontWeight: 700, color: '#d4a017', marginTop: 2 }}>{(d.recipientName || '___________').toUpperCase()}</div>
        <svg width="200" height="12" viewBox="0 0 200 12" style={{ flexShrink: 0 }}>
          <line x1="0" y1="6" x2="80" y2="6" stroke="#d4a017" strokeWidth="0.8" />
          <circle cx="88" cy="6" r="1.2" fill="#d4a017" />
          <circle cx="100" cy="6" r="4" fill="none" stroke="#d4a017" strokeWidth="1" />
          <circle cx="100" cy="6" r="1.5" fill="#d4a017" />
          <circle cx="112" cy="6" r="1.2" fill="#d4a017" />
          <line x1="120" y1="6" x2="200" y2="6" stroke="#d4a017" strokeWidth="0.8" />
        </svg>
        <div style={{ fontSize: '11pt', color: '#4c1d95', marginTop: 2 }}>for outstanding excellence in</div>
        <div style={{ fontSize: '15pt', fontWeight: 700, fontStyle: 'italic', color: '#4c1d95' }}>{d.achievementTitle || '___________'}</div>
        {d.description && <div style={{ fontSize: '9.5pt', color: '#6d28d9', fontStyle: 'italic', maxWidth: 480 }}>{d.description}</div>}
      </div>

      <div style={footerArea(30, 60)}>
        <FooterGrid d={d} c="#4c1d95" l="#7c3aed" lc="#d4a017" font="'Playfair Display',serif" />
      </div>
    </div>
  );
}

function RoyalCorners() {
  const positions = [
    { top: 12, left: 12 },
    { top: 12, right: 12, transform: 'scaleX(-1)' },
    { bottom: 12, left: 12, transform: 'scaleY(-1)' },
    { bottom: 12, right: 12, transform: 'scale(-1)' },
  ];
  return positions.map((p, i) => (
    <svg key={i} width="44" height="44" viewBox="0 0 44 44" style={{ position: 'absolute', pointerEvents: 'none', ...p }}>
      <path d="M4,4 C4,22 10,28 28,28" stroke="#7c3aed" strokeWidth="1.8" fill="none" />
      <path d="M4,4 C22,4 28,10 28,28" stroke="#7c3aed" strokeWidth="1.8" fill="none" />
      <path d="M10,10 C10,18 13,21 21,21" stroke="#c4b5fd" strokeWidth="0.6" fill="none" />
      <circle cx="4" cy="4" r="2.5" fill="#d4a017" />
      <circle cx="28" cy="28" r="1.5" fill="#7c3aed" />
    </svg>
  ));
}


// ═══════════════════════════════════════════════════════════════════

const templates = {
  classic: ClassicTemplate,
  modern: ModernTemplate,
  gold: GoldTemplate,
  corporate: CorporateTemplate,
  royal: RoyalTemplate,
};
