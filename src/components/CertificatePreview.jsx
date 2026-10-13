import { adjustCss } from '../utils/imageAdjust';
import { useTrimmedImage } from '../hooks/useTrimmedImage';
import StampPreview from './StampPreview';
import { CERTIFICATE_DEFAULTS, certificateYear, certificateDate, certificateFooter } from '../services/certificateTemplates';

/* The certificate, drawn at A4 size (96 DPI) so the PDF is a capture of exactly
   what is on screen. One template in two orientations: a band of artwork down
   the left of a landscape sheet, or across the top of a portrait one. The
   artwork is the sample drawing below, an image of the person's own, or
   nothing at all, in which case the text takes the whole sheet.

   Everything html2canvas has to draw is kept plain: text is HTML (so the web
   fonts apply), the drawing is flat SVG shapes, the image a CSS background. */

const PAPER = '#fbfcf1';
const INK = '#1c1c1a';
const GREY = '#85857c';
const MONO = "'Roboto Mono', 'SFMono-Regular', Consolas, monospace";
const SANS = "'Roboto', 'Inter', 'Helvetica Neue', Arial, sans-serif";

const SIZES = {
  landscape: { w: 1123, h: 794, band: 236, padX: [58, 66], padY: [64, 60] },
  portrait: { w: 794, h: 1123, band: 240, padX: [54, 54], padY: [56, 60] },
};
const FRAME = 38; // the margin between the sheet's edge and its ruled frame

/* The sample drawing, laid out for the tall band (240 × 720). The wide band
   is the same drawing turned on its diagonal. */
const BLOBS = [
  { cx: 150, cy: 62, rx: 78, ry: 44, rot: -28 },
  { cx: 204, cy: 252, rx: 80, ry: 40, rot: -62 },
  { cx: 58, cy: 356, rx: 34, ry: 74, rot: 24 },
  { cx: 150, cy: 486, rx: 82, ry: 36, rot: -34 },
  { cx: 78, cy: 610, rx: 84, ry: 36, rot: -30 },
  { cx: 196, cy: 688, rx: 58, ry: 30, rot: -18 },
];
const RINGS = [
  { cx: 118, cy: 118, rx: 104, ry: 34, rot: -42 },
  { cx: 44, cy: 196, rx: 30, ry: 86, rot: 12 },
  { cx: 152, cy: 214, rx: 96, ry: 30, rot: -56 },
  { cx: 96, cy: 318, rx: 36, ry: 100, rot: 22 },
  { cx: 168, cy: 392, rx: 92, ry: 30, rot: -50 },
  { cx: 70, cy: 468, rx: 30, ry: 78, rot: 30 },
  { cx: 96, cy: 548, rx: 108, ry: 32, rot: -36 },
  { cx: 150, cy: 640, rx: 96, ry: 28, rot: -24 },
];
const STARS = [
  { cx: 88, cy: 34, r: 9 },
  { cx: 30, cy: 262, r: 15 },
  { cx: 196, cy: 152, r: 5, solid: true },
  { cx: 184, cy: 330, r: 17 },
  { cx: 34, cy: 520, r: 5, solid: true },
  { cx: 200, cy: 574, r: 6, solid: true },
  { cx: 196, cy: 646, r: 18 },
];

// A four-pointed star with pinched sides.
const starPath = (cx, cy, r) => (
  `M${cx} ${cy - r}Q${cx} ${cy} ${cx + r} ${cy}Q${cx} ${cy} ${cx} ${cy + r}Q${cx} ${cy} ${cx - r} ${cy}Q${cx} ${cy} ${cx} ${cy - r}Z`
);

function SampleArt({ wide }) {
  const turn = (s) => (wide ? { ...s, cx: s.cy, cy: s.cx, rot: 90 - (s.rot || 0) } : s);
  return (
    <svg
      viewBox={wide ? '0 0 720 240' : '0 0 240 720'} preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg" aria-hidden="true"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
    >
      {BLOBS.map(turn).map((s, i) => (
        <ellipse key={'b' + i} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} fill={PAPER} transform={`rotate(${s.rot} ${s.cx} ${s.cy})`} />
      ))}
      {RINGS.map(turn).map((s, i) => (
        <ellipse key={'r' + i} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} fill="none" stroke={INK} strokeWidth="0.9" transform={`rotate(${s.rot} ${s.cx} ${s.cy})`} />
      ))}
      {STARS.map(turn).map((s, i) => (
        <path key={'s' + i} d={starPath(s.cx, s.cy, s.r)} fill={s.solid ? INK : PAPER} stroke={INK} strokeWidth="0.9" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

/* The company stamp (Company Profile): the one drawn from the company's name
   and city, or the image uploaded in its place. Tilted, as on every other
   document; the adjustment sits on the wrapper so the tilt is left alone. */
const STAMP = 96;

function Stamp({ d, style }) {
  const uploaded = d.stampType === 'uploaded' && d.stampUrl;
  return (
    <div style={{ width: STAMP, height: STAMP, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', ...style }}>
      <div style={{ transform: 'rotate(-8deg)', lineHeight: 0 }}>
        {uploaded ? (
          <img src={d.stampUrl} alt="" style={{ maxWidth: STAMP, maxHeight: STAMP, objectFit: 'contain', display: 'block' }} />
        ) : (
          <StampPreview companyName={d.stampCompany || d.issuingOrganization} city={d.stampCity} size={STAMP} />
        )}
      </div>
    </div>
  );
}

/* Where the stamp sits on the sheet, as a top-left corner. "Beside the title"
   is not here: there the stamp sits in the title row. */
function stampSpot(position, S, portrait, showArt, hasSecond) {
  const edge = FRAME + 1;
  const left = edge + (showArt && !portrait ? S.band + 1 : 0) + S.padX[0];
  const right = S.w - edge - S.padX[1];
  const bottom = S.h - edge - S.padY[1];
  if (position === 'art' && showArt) {
    return portrait
      ? { left: S.w - edge - 28 - STAMP, top: edge + (S.band - STAMP) / 2 }
      : { left: edge + (S.band - STAMP) / 2, top: S.h - edge - 28 - STAMP };
  }
  // The bottom right belongs to a second signatory: the stamp moves between the two.
  if (position === 'bottom-center' || hasSecond) return { left: (left + right - STAMP) / 2, top: bottom - STAMP };
  return { left: right - STAMP, top: bottom - STAMP };
}

function Signatory({ name, designation, signature, adjust, align }) {
  if (!name && !designation && !signature) return null;
  const first = (name || '').trim().split(/\s+/)[0] || '';
  return (
    <div style={{ minWidth: 150, maxWidth: 300, textAlign: 'left', marginLeft: align === 'right' ? 'auto' : 0 }}>
      <div style={{ height: 50, display: 'flex', alignItems: 'flex-end' }}>
        {signature ? (
          <img src={signature} alt="" style={{ height: 48, maxWidth: 220, objectFit: 'contain', display: 'block', marginBottom: 2, ...adjustCss(adjust, 'left bottom') }} />
        ) : (
          <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 21, color: INK, lineHeight: 1, paddingBottom: 8 }}>{first}</div>
        )}
      </div>
      <div style={{ height: 1, background: INK, width: 118 }} />
      <div style={{ fontFamily: SANS, fontSize: 11.5, color: GREY, marginTop: 9, lineHeight: 1.3 }}>{designation}</div>
      <div style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, color: INK, marginTop: 3, lineHeight: 1.3 }}>{name}</div>
    </div>
  );
}

export default function CertificatePreview({ formData, captureId = 'certificate-capture-area' }) {
  const d = { ...CERTIFICATE_DEFAULTS, ...(formData || {}) };
  const portrait = d.orientation === 'portrait';
  const S = portrait ? SIZES.portrait : SIZES.landscape;
  const accent = d.accentColor || CERTIFICATE_DEFAULTS.accentColor;
  // A signature signed small in a large pad would be drawn as a speck: its
  // empty margins are cut away so the ink fills the space above the line.
  const signature = useTrimmedImage(d.signature);
  const secondSignature = useTrimmedImage(d.secondSignature);

  const showArt = !d.artHidden;
  const year = certificateYear(d);
  const date = certificateDate(d.issueDate);
  // The company name sits under the logo, or at the top where there is none.
  // A logo can stand in for the name, so the placeholder is only for neither.
  const org = (d.issuingOrganization || '').trim() || (d.logo ? '' : 'Your Company Name');
  const name = d.recipientName || 'Recipient Name';
  const nameSize = name.length <= 20 ? 54 : name.length <= 28 ? 46 : name.length <= 38 ? 38 : 31;
  // "Certificate of Participation" is set on two lines, broken before "of".
  const title = (d.certificateTitle || CERTIFICATE_DEFAULTS.certificateTitle).trim();
  const cut = title.toLowerCase().indexOf(' of ');
  const titleLines = cut > 0 ? [title.slice(0, cut), title.slice(cut + 1)] : [title];
  const hasSecond = !!(d.secondSignatory || d.secondDesignation || d.secondSignature);
  const stampBesideTitle = !!d.showStamp && d.stampPosition === 'title';
  const stampOnSheet = !!d.showStamp && !stampBesideTitle;

  return (
    <div
      id={captureId}
      className="certificate-preview-root"
      style={{
        width: S.w, height: S.h, background: PAPER, position: 'relative', overflow: 'hidden',
        padding: FRAME, boxSizing: 'border-box', fontFamily: SANS, color: INK,
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&family=Roboto+Mono:wght@400;500;700&display=swap');
      `}</style>

      <div style={{
        width: '100%', height: '100%', boxSizing: 'border-box', border: '1px solid ' + INK,
        display: 'flex', flexDirection: portrait ? 'column' : 'row',
      }}>
        {/* ARTWORK BAND */}
        {showArt && (
          <div style={{
            position: 'relative', overflow: 'hidden', flexShrink: 0, background: accent,
            ...(portrait
              ? { height: S.band, borderBottom: '1px solid ' + INK }
              : { width: S.band, borderRight: '1px solid ' + INK }),
          }}>
            {d.art ? (
              <div style={{
                position: 'absolute', inset: 0,
                backgroundImage: `url("${d.art}")`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
                ...adjustCss(d.artAdjust, 'center'),
              }} />
            ) : <SampleArt wide={portrait} />}
            {year && (
              <div style={{
                position: 'absolute', top: 14, left: 14, fontFamily: MONO, fontWeight: 700, fontSize: 27,
                lineHeight: 1.08, letterSpacing: '0.12em', color: INK,
                ...(d.art ? { background: PAPER, padding: '6px 6px 6px 10px' } : { padding: '2px 0 0 4px' }),
              }}>
                <div>{year.slice(0, 2)}</div>
                <div>{year.slice(2)}</div>
              </div>
            )}
          </div>
        )}

        {/* TEXT */}
        <div style={{
          flex: 1, minWidth: 0, minHeight: 0, boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
          padding: `${S.padY[0]}px ${S.padX[1]}px ${S.padY[1]}px ${S.padX[0]}px`,
        }}>
          {/* who issues it, and where and when */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, minWidth: 0, minHeight: 30 }}>
              {d.logo && (
                <img src={d.logo} alt="" style={{ height: 30, maxWidth: 120, objectFit: 'contain', objectPosition: 'left center', display: 'block', flexShrink: 0, ...adjustCss(d.logoAdjust, 'left bottom') }} />
              )}
              {org && (
                <span style={{ fontFamily: MONO, fontSize: 13, lineHeight: '18px', color: INK, letterSpacing: '0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{org}</span>
              )}
            </div>
            {(d.location || date) && (
              <div style={{ flexShrink: 0, fontFamily: MONO, fontSize: 12, lineHeight: 1.55, color: INK, whiteSpace: 'nowrap' }}>
                {d.location && <div>{d.location}{date ? ',' : ''}</div>}
                {date && <div>{date}</div>}
              </div>
            )}
          </div>

          {/* title */}
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, marginTop: portrait ? 64 : 40 }}>
            <div style={{ fontFamily: MONO, fontWeight: 500, fontSize: 34, lineHeight: 1.3, letterSpacing: '0.04em', textTransform: 'uppercase', color: INK, minWidth: 0 }}>
              {titleLines.map((line, i) => <div key={i}>{line}</div>)}
            </div>
            {stampBesideTitle && (
              <Stamp d={d} style={{ marginRight: 20, ...adjustCss(d.stampAdjust, 'center') }} />
            )}
          </div>

          <div style={{ flex: 1, minHeight: 20 }} />

          {/* who it is given to */}
          <div style={{ fontFamily: SANS, fontSize: 13, color: GREY }}>{d.introLine || CERTIFICATE_DEFAULTS.introLine}</div>
          <div style={{ height: 1, background: INK, marginTop: 14 }} />
          <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: nameSize, letterSpacing: '-0.01em', lineHeight: 1.15, color: INK, padding: '14px 0 16px', overflowWrap: 'anywhere' }}>
            {name}
          </div>
          <div style={{ height: 1, background: INK }} />

          <div style={{ fontFamily: SANS, fontSize: 13, lineHeight: 1.6, color: GREY, marginTop: 18, whiteSpace: 'pre-line' }}>
            {d.description || 'In recognition of dedication, effort and the standard of work shown throughout the programme.'}
          </div>

          <div style={{
            fontFamily: MONO, fontWeight: 500, fontSize: 12, lineHeight: 1.5, letterSpacing: '0.05em', textTransform: 'uppercase', color: INK,
            marginTop: 18, paddingBottom: 9, borderBottom: '1px solid ' + INK,
          }}>
            {certificateFooter(d)}
          </div>

          <div style={{ flex: 1.15, minHeight: 20 }} />

          {/* who signs it */}
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 40 }}>
            <Signatory
              name={d.authorizedSignatory || 'Authorised Signatory'} designation={d.signatoryDesignation || 'Designation'}
              signature={signature} adjust={d.signatureAdjust}
            />
            {hasSecond && (
              <Signatory
                name={d.secondSignatory} designation={d.secondDesignation}
                signature={secondSignature} adjust={d.secondSignatureAdjust} align="right"
              />
            )}
          </div>
        </div>
      </div>

      {stampOnSheet && (
        <Stamp d={d} style={{ position: 'absolute', ...stampSpot(d.stampPosition, S, portrait, showArt, hasSecond), ...adjustCss(d.stampAdjust, 'center') }} />
      )}
    </div>
  );
}
