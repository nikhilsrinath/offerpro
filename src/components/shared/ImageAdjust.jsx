import { useId, useState } from 'react';
import { SlidersHorizontal, RotateCcw } from 'lucide-react';
import { adjustOf, isAdjusted } from '../../utils/imageAdjust';

/* Readjust a logo, signature or seal on a document: its size and where it
   sits. Folded away under the upload it belongs to; the live preview moves
   as the sliders do. `value` is { scale, x, y } (utils/imageAdjust), or
   nothing for the template's own placement. `maxScale` is how far Size goes:
   a logo can be blown up well past the template's box. */
export default function ImageAdjust({ label, value, onChange, maxScale = 250 }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const a = adjustOf(value);
  const changed = isAdjusted(value);
  const set = (k) => (e) => onChange({ ...a, [k]: Number(e.target.value) });

  const slider = (name, k, min, max, step, unit) => (
    <label className="img-adjust-row">
      <span>{name}</span>
      <input type="range" min={min} max={max} step={step} value={a[k]} onChange={set(k)}
        aria-label={`${label}: ${name.toLowerCase()}`} aria-valuetext={`${a[k]}${unit}`} />
      <output>{a[k]}{unit}</output>
    </label>
  );

  return (
    <div className="img-adjust">
      <button type="button" className="img-adjust-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        <SlidersHorizontal size={13} aria-hidden="true" /> Adjust {label}{changed ? ' · Adjusted' : ''}
      </button>
      {open && (
        <div id={id} className="img-adjust-body">
          {slider('Size', 'scale', 40, maxScale, maxScale > 250 ? 10 : 5, '%')}
          {slider('Left / Right', 'x', -60, 60, 1, ' mm')}
          {slider('Up / Down', 'y', -30, 30, 1, ' mm')}
          <button type="button" className="img-adjust-reset" disabled={!changed} onClick={() => onChange(null)}>
            <RotateCcw size={12} aria-hidden="true" /> Reset
          </button>
        </div>
      )}
    </div>
  );
}
