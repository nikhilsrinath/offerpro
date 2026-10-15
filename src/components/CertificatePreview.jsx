import { Editable, EditText } from './shared/Editable';
import { useTrimmedImage } from '../hooks/useTrimmedImage';
import StampPreview from './StampPreview';
import { CERTIFICATE_DEFAULTS, certificateYear, certificateDate, certificateFooter, certificateInk } from '../services/certificateTemplates';

/* The certificate, drawn at A4 size (96 DPI) so the PDF is a capture of exactly
   what is on screen. One template in two orientations: a band of artwork down
   the left of a landscape sheet, or across the top of a portrait one. The
   artwork is the sample drawing below, an image of the person's own, or
   nothing at all, in which case the text takes the whole sheet, centred.

   The sheet is the paper colour picked on the form; on a dark one the ink
   turns light (certificateInk).

   Everything html2canvas has to draw is kept plain: text is HTML (so the web
   fonts apply), the drawing is flat SVG shapes, the image a CSS background. */

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

// The sample drawing's own ink: it sits on the accent colour, not the sheet.
const INK = '#1c1c1a';

function SampleArt({ wide, paper }) {
  const turn = (s) => (wide ? { ...s, cx: s.cy, cy: s.cx, rot: 90 - (s.rot || 0) } : s);
  return (
    <svg
      viewBox={wide ? '0 0 720 240' : '0 0 240 720'} preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg" aria-hidden="true"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
    >
      {BLOBS.map(turn).map((s, i) => (
        <ellipse key={'b' + i} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} fill={paper} transform={`rotate(${s.rot} ${s.cx} ${s.cy})`} />
      ))}
      {RINGS.map(turn).map((s, i) => (
        <ellipse key={'r' + i} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} fill="none" stroke={INK} strokeWidth="0.9" transform={`rotate(${s.rot} ${s.cx} ${s.cy})`} />
      ))}
      {STARS.map(turn).map((s, i) => (
        <path key={'s' + i} d={starPath(s.cx, s.cy, s.r)} fill={s.solid ? INK : paper} stroke={INK} strokeWidth="0.9" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

/* The company stamp (Company Profile): the one drawn from the company's name
   and city, or the image uploaded in its place. Tilted, as on every other
   document; it is placed by its Editable wrapper, so the tilt is left alone. */
const STAMP = 96;

function Stamp({ d }) {
  const uploaded = d.stampType === 'uploaded' && d.stampUrl;
  return (
    <div style={{ width: STAMP, height: STAMP, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
  // Without artwork a lone signatory signs in the centre, so the stamp keeps the right.
  if (hasSecond || (position === 'bottom-center' && showArt)) return { left: (left + right - STAMP) / 2, top: bottom - STAMP };
  return { left: right - STAMP, top: bottom - STAMP };
}

/* One signatory: the signature (or the first name standing in for one), the
   rule, the designation and the name. The signature and the block under it
   are each placed on their own. `which` is '' or 'second', for the fields. */
function Signatory({ d, which, name, designation, signature, align, ink, grey }) {
  const nameField = which ? 'secondSignatory' : 'authorizedSignatory';
  const roleField = which ? 'secondDesignation' : 'signatoryDesignation';
  // Only a typed name stands in for a missing signature, never the placeholder.
  const first = (d[nameField] || '').trim().split(/\s+/)[0] || '';
  const centre = align === 'center';
  const key = which ? 'secondSignature' : 'signature';
  const who = which ? 'Second Signatory' : 'Signatory';
  return (
    <div style={{
      minWidth: 150, maxWidth: 300, textAlign: centre ? 'center' : 'left',
      marginLeft: align === 'right' || centre ? 'auto' : 0, marginRight: centre ? 'auto' : 0,
    }}>
      <div style={{ height: 50, display: 'flex', alignItems: 'flex-end', justifyContent: centre ? 'center' : 'flex-start' }}>
        <Editable field={key + 'Adjust'} label={which ? 'Second Signature' : 'Signature'} value={d[key + 'Adjust']}
          origin={centre ? 'center bottom' : 'left bottom'} style={{ marginBottom: signature ? 2 : 0 }}>
          {signature ? (
            <img src={signature} alt="" style={{ height: 48, maxWidth: 220, objectFit: 'contain', display: 'block' }} />
          ) : (
            <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 21, color: ink, lineHeight: 1, paddingBottom: 8 }}>{first}</div>
          )}
        </Editable>
      </div>
      <Editable field={(which ? 'secondSignatory' : 'signatory') + 'Adjust'} label={`${who} Name`} text={nameField}
        value={d[(which ? 'secondSignatory' : 'signatory') + 'Adjust']} origin={centre ? 'center top' : 'left top'}>
        <div style={{ height: 1, background: ink, width: 118, margin: centre ? '0 auto' : 0 }} />
        <EditText field={roleField} value={d[roleField]} placeholder="Designation" label={`${who} Designation`}
          style={{ fontFamily: SANS, fontSize: 11.5, color: grey, paddingTop: 9, lineHeight: 1.3 }}>{designation}</EditText>
        <EditText field={nameField} value={d[nameField]} placeholder={which ? 'Second Signatory' : 'Authorised Signatory'} label={`${who} Name`}
          style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, color: ink, marginTop: 3, lineHeight: 1.3 }}>{name}</EditText>
      </Editable>
    </div>
  );
}

export default function CertificatePreview({ formData, captureId = 'certificate-capture-area' }) {
  const d = { ...CERTIFICATE_DEFAULTS, ...(formData || {}) };
  const portrait = d.orientation === 'portrait';
  const S = portrait ? SIZES.portrait : SIZES.landscape;
  const accent = d.accentColor || CERTIFICATE_DEFAULTS.accentColor;
  const paper = d.paperColor || CERTIFICATE_DEFAULTS.paperColor;
  const { ink, grey, dark } = certificateInk(paper);
  // What sits light on the artwork: the sheet, unless the sheet is dark.
  const artPaper = dark ? CERTIFICATE_DEFAULTS.paperColor : paper;
  // A signature signed small in a large pad would be drawn as a speck: its
  // empty margins are cut away so the ink fills the space above the line.
  const signature = useTrimmedImage(d.signature);
  const secondSignature = useTrimmedImage(d.secondSignature);

  const showArt = !d.artHidden;
  // With the artwork off, the writing is set down the middle of the sheet.
  const centred = !showArt;
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
  const hasSecond = !!(d.secondShown || d.secondSignatory || d.secondDesignation || d.secondSignature);
  const stampBesideTitle = !!d.showStamp && d.stampPosition === 'title';
  const stampOnSheet = !!d.showStamp && !stampBesideTitle;
  const top = centred ? 'center top' : 'left top';

  const logo = d.logo && (
    <Editable field="logoAdjust" label="Logo" value={d.logoAdjust} origin={top} style={{ flexShrink: 0, maxWidth: '100%' }}>
      <img src={d.logo} alt="" style={{
        height: 30, maxWidth: 120, objectFit: 'contain', objectPosition: centred ? 'center' : 'left center', display: 'block',
      }} />
    </Editable>
  );
  const orgName = org && (
    <Editable field="orgAdjust" label="Company Name" value={d.orgAdjust} origin={top} text="issuingOrganization" style={{ maxWidth: '100%', minWidth: 0 }}>
      <EditText field="issuingOrganization" value={d.issuingOrganization} placeholder="Your Company Name" label="Company Name"
        style={{ fontFamily: MONO, fontSize: 13, lineHeight: '18px', color: ink, letterSpacing: '0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{org}</EditText>
    </Editable>
  );
  const stamp = (style) => (
    <Editable field="stampAdjust" label="Round Seal" value={d.stampAdjust} origin="center" style={{ flexShrink: 0, ...style }}>
      <Stamp d={d} />
    </Editable>
  );

  return (
    <div
      id={captureId}
      data-edit-root
      className="certificate-preview-root"
      style={{
        width: S.w, height: S.h, background: paper, position: 'relative', overflow: 'hidden',
        padding: FRAME, boxSizing: 'border-box', fontFamily: SANS, color: ink,
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&family=Roboto+Mono:wght@400;500;700&display=swap');
      `}</style>

      <div style={{
        width: '100%', height: '100%', boxSizing: 'border-box', border: '1px solid ' + ink,
        display: 'flex', flexDirection: portrait ? 'column' : 'row',
      }}>
        {/* ARTWORK BAND */}
        {showArt && (
          <div style={{
            position: 'relative', overflow: 'hidden', flexShrink: 0, background: accent,
            ...(portrait
              ? { height: S.band, borderBottom: '1px solid ' + ink }
              : { width: S.band, borderRight: '1px solid ' + ink }),
          }}>
            <Editable field="artAdjust" label="Artwork" value={d.artAdjust} origin="center" style={{ position: 'absolute', inset: 0 }}>
              {d.art ? (
                <div style={{
                  position: 'absolute', inset: 0,
                  backgroundImage: `url("${d.art}")`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
                }} />
              ) : <SampleArt wide={portrait} paper={artPaper} />}
            </Editable>
            {year && (
              <Editable field="yearAdjust" label="Year" value={d.yearAdjust} origin="left top" text="yearLabel"
                style={{ position: 'absolute', top: 14, left: 14 }}>
                <EditText field="yearLabel" value={d.yearLabel || year} label="Year" style={{
                  fontFamily: MONO, fontWeight: 700, fontSize: 27, lineHeight: 1.08, letterSpacing: '0.12em', color: INK,
                  ...(d.art ? { background: artPaper, padding: '6px 6px 6px 10px' } : { padding: '2px 0 0 4px' }),
                  maxWidth: '2.6em', overflowWrap: 'anywhere',
                }}>
                  <div>{year.slice(0, 2)}</div>
                  <div>{year.slice(2)}</div>
                </EditText>
              </Editable>
            )}
          </div>
        )}

        {/* TEXT */}
        <div style={{
          flex: 1, minWidth: 0, minHeight: 0, boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
          padding: `${S.padY[0]}px ${S.padX[1]}px ${S.padY[1]}px ${S.padX[0]}px`, textAlign: centred ? 'center' : 'left',
        }}>
          {/* who issues it, and where and when */}
          {centred ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, minHeight: 30 }}>
              {logo}
              {orgName}
              {(d.location || date) && (
                <Editable field="placeAdjust" label="Place And Date" value={d.placeAdjust} origin="center top" text="location">
                  <div style={{ fontFamily: MONO, fontSize: 12, lineHeight: 1.55, color: ink, whiteSpace: 'nowrap', display: 'flex', justifyContent: 'center' }}>
                    <EditText field="location" value={d.location} placeholder="Location" label="Location" optional>
                      {d.location}{date ? ',' : ''}
                    </EditText>
                    {date && <div>&nbsp;{date}</div>}
                  </div>
                </Editable>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, minWidth: 0, minHeight: 30 }}>
                {logo}
                {orgName}
              </div>
              {(d.location || date) && (
                <Editable field="placeAdjust" label="Place And Date" value={d.placeAdjust} origin="right top" text="location" style={{ flexShrink: 0 }}>
                  <div style={{ fontFamily: MONO, fontSize: 12, lineHeight: 1.55, color: ink, whiteSpace: 'nowrap' }}>
                    <EditText field="location" value={d.location} placeholder="Location" label="Location" optional>
                      {d.location}{date ? ',' : ''}
                    </EditText>
                    {date && <div>{date}</div>}
                  </div>
                </Editable>
              )}
            </div>
          )}

          {/* title */}
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: centred ? 'center' : 'space-between', gap: 24, marginTop: portrait ? 64 : 40 }}>
            <Editable field="titleAdjust" label="Title" value={d.titleAdjust} origin={top} text="certificateTitle" style={{ minWidth: 0 }}>
              <EditText field="certificateTitle" value={d.certificateTitle} placeholder={CERTIFICATE_DEFAULTS.certificateTitle} label="Title"
                style={{ fontFamily: MONO, fontWeight: 500, fontSize: 34, lineHeight: 1.3, letterSpacing: '0.04em', textTransform: 'uppercase', color: ink }}>
                {titleLines.map((line, i) => <div key={i}>{line}</div>)}
              </EditText>
            </Editable>
            {stampBesideTitle && stamp({ marginRight: centred ? 0 : 20 })}
          </div>

          <div style={{ flex: 1, minHeight: 20 }} />

          {/* who it is given to */}
          <Editable field="introAdjust" label="Line Above The Name" value={d.introAdjust} origin={top} text="introLine">
            <EditText field="introLine" value={d.introLine} placeholder={CERTIFICATE_DEFAULTS.introLine} label="Line Above The Name"
              style={{ fontFamily: SANS, fontSize: 13, color: grey }} />
          </Editable>
          <div style={{ height: 1, background: ink, marginTop: 14 }} />
          <Editable field="nameAdjust" label="Recipient Name" value={d.nameAdjust} origin={top} text="recipientName">
            <EditText field="recipientName" value={d.recipientName} placeholder="Recipient Name" label="Recipient Name"
              style={{ fontFamily: SANS, fontWeight: 700, fontSize: nameSize, letterSpacing: '-0.01em', lineHeight: 1.15, color: ink, padding: '14px 0 16px', overflowWrap: 'anywhere' }} />
          </Editable>
          <div style={{ height: 1, background: ink }} />

          <Editable field="descriptionAdjust" label="Description" value={d.descriptionAdjust} origin={top} text="description" style={{ marginTop: 18 }}>
            <EditText field="description" value={d.description} multiline label="Description"
              placeholder="In recognition of dedication, effort and the standard of work shown throughout the programme."
              style={{ fontFamily: SANS, fontSize: 13, lineHeight: 1.6, color: grey, whiteSpace: 'pre-line' }} />
          </Editable>

          <Editable field="footerAdjust" label="Line Under The Description" value={d.footerAdjust} origin={top} text="footerLine" style={{ marginTop: 18 }}>
            <EditText field="footerLine" value={certificateFooter(d)} label="Line Under The Description" style={{
              fontFamily: MONO, fontWeight: 500, fontSize: 12, lineHeight: 1.5, letterSpacing: '0.05em', textTransform: 'uppercase', color: ink,
              paddingBottom: 9, borderBottom: '1px solid ' + ink,
            }} />
          </Editable>

          <div style={{ flex: 1.15, minHeight: 20 }} />

          {/* who signs it */}
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 40 }}>
            <Signatory
              d={d} which="" ink={ink} grey={grey} signature={signature}
              name={d.authorizedSignatory || 'Authorised Signatory'} designation={d.signatoryDesignation || 'Designation'}
              align={centred && !hasSecond ? 'center' : 'left'}
            />
            {hasSecond && (
              <Signatory
                d={d} which="second" ink={ink} grey={grey} signature={secondSignature}
                name={d.secondSignatory || 'Second Signatory'} designation={d.secondDesignation || 'Designation'} align="right"
              />
            )}
          </div>
        </div>
      </div>

      {stampOnSheet && stamp({ position: 'absolute', ...stampSpot(d.stampPosition, S, portrait, showArt, hasSecond) })}
    </div>
  );
}
