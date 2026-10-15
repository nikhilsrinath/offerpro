import { createContext, useContext, useEffect, useRef } from 'react';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Minus, Plus, RotateCcw, Check } from 'lucide-react';
import { adjustOf, isAdjusted, moveBy, sizeTo, MIN_SCALE, MAX_SCALE } from '../../utils/imageAdjust';

/* Place-anything editing on a document's live preview, the way a design tool
   does it: tap the logo, a signature, the seal or a line of text and it is
   selected; drag it to move it anywhere on the sheet, drag its corner to make
   it bigger or smaller. The bar above the preview (EditBar) does the same with
   buttons, for anyone who would rather not drag, and the keyboard does too
   (arrows move, + and - resize, Escape lets go).

   Every placement is the item's adjustment, { scale, x, y } (utils/imageAdjust):
   its size as a percentage and how far it has moved, in millimetres. The form
   keeps it on the document's data, so the PDF is drawn from the same numbers.

   The form owns the selection and provides it (EditProvider). A preview drawn
   without one (off screen for a PDF, or from Records) is plain: nothing in it
   can be selected. The outline and corner are marked for html2canvas to skip,
   so a selection never ends up in a PDF.

   Text can be typed straight onto the sheet too (EditText): click a selected
   line again, double-click it, or press Enter on it, and it turns into a box
   to type in. What is typed goes to the form's own field as it is typed. */

const EditContext = createContext(null);

const PX_PER_MM = 96 / 25.4;
const HANDLE = 16; // the corner's size on screen, in px

/**
 * Around the form and its preview. `selected` is { field, label, zoom } or
 * null (zoom: how far the sheet was scaled on screen when it was picked);
 * `onChange(field, adjustment)` stores an item's new placement.
 */
export function EditProvider({ selected, onSelect, onChange, editing = null, onEdit, onText, children }) {
  return (
    <EditContext.Provider value={{ selected, onSelect, onChange, editing, onEdit, onText }}>
      {children}
    </EditContext.Provider>
  );
}

// How far the sheet is scaled on screen (A4Stage fits it to the pane).
function zoomOf(el) {
  const root = el?.closest('[data-edit-root]');
  if (!root || !root.offsetWidth) return 1;
  return root.getBoundingClientRect().width / root.offsetWidth || 1;
}

/**
 * A run of text on the sheet that can be typed on in place. `field` is its key
 * on the form data, `value` what it reads, `placeholder` what stands in while
 * it is empty. `children` can draw the text differently while it is not being
 * typed on (a title broken over two lines). With `optional`, an empty one is
 * left off the PDF and only hinted at in the editor.
 */
export function EditText({ field, value, placeholder = '', multiline = false, optional = false, label, style, children }) {
  const ed = useContext(EditContext);
  const ref = useRef(null);
  const editing = !!ed && ed.editing === field;

  // The box is filled once as it opens; after that the browser owns what is in
  // it, so React re-drawing the sheet never moves the caret.
  useEffect(() => {
    const el = ref.current;
    if (!editing || !el) return;
    el.innerText = value || '';
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = children ?? (value || placeholder);
  if (!ed) return optional && !value ? null : <div style={style}>{shown}</div>;
  if (!editing) {
    if (optional && !value) {
      return <div data-edit-text={field} data-html2canvas-ignore="true" className="edit-text-ghost" style={style}>{placeholder}</div>;
    }
    return <div data-edit-text={field} style={style}>{shown}</div>;
  }

  const read = (el) => {
    const t = el.innerText.replace(/\u00a0/g, ' ');
    return multiline ? t.replace(/\n$/, '') : t.replace(/\s*\n\s*/g, ' ');
  };
  return (
    <div
      ref={ref} contentEditable suppressContentEditableWarning
      role="textbox" aria-multiline={multiline} aria-label={label || placeholder || field}
      data-placeholder={placeholder} className="edit-text"
      style={{ ...style, cursor: 'text', outline: 'none', minWidth: '1ch', WebkitUserSelect: 'text', userSelect: 'text' }}
      onInput={(e) => ed.onText?.(field, read(e.currentTarget))}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && !multiline)) { e.preventDefault(); e.currentTarget.blur(); }
      }}
      onPaste={(e) => {
        // Only the words: a paste from a web page or a document keeps none of its formatting.
        e.preventDefault();
        const t = e.clipboardData.getData('text/plain');
        document.execCommand('insertText', false, multiline ? t : t.replace(/\s*\n\s*/g, ' '));
      }}
      onBlur={() => { if (ed.editing === field) ed.onEdit?.(null); }}
    />
  );
}

/**
 * One item on the sheet that can be selected, moved and resized. `field` is
 * its adjustment's key on the form data ('logoAdjust'), `value` that
 * adjustment, `origin` the corner it grows from. `style` is the wrapper's own
 * layout (display, margins) in the template. `text` is the field of the
 * EditText inside it that Enter (or the bar's Edit Text) opens for typing.
 */
export function Editable({ field, label, value, origin = 'left top', style, text, children }) {
  const ed = useContext(EditContext);
  const ref = useRef(null);
  const drag = useRef(null);
  const a = adjustOf(value);
  const s = a.scale / 100;
  const placed = isAdjusted(value)
    ? { transform: `translate(${a.x}mm, ${a.y}mm) scale(${s})`, transformOrigin: origin }
    : null;

  if (!ed) return <div style={{ ...style, ...placed }}>{children}</div>;

  const selected = ed.selected?.field === field;
  const select = () => ed.onSelect({ field, label, text, zoom: zoomOf(ref.current) });
  const editText = (name) => { if (name && ed.onEdit) ed.onEdit(name); };
  const change = (next) => ed.onChange(field, next);

  const onPointerDown = (e) => {
    if (e.button > 0) return;
    e.stopPropagation();
    // A click inside the text being typed places the caret; it moves nothing.
    if (e.target.closest?.('[contenteditable="true"]')) return;
    const was = selected;
    const textField = e.target.closest?.('[data-edit-text]')?.dataset.editText;
    select();
    // On a touch screen the first tap only selects, so the page still scrolls
    // under a finger that lands on an item; a mouse can select and drag at once.
    if (!was && e.pointerType !== 'mouse') return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { kind: 'move', x: e.clientX, y: e.clientY, a, zoom: zoomOf(ref.current), was, textField, moved: false };
  };

  const onHandleDown = (e) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    // The size follows the pointer's distance from the corner the item grows from.
    const r = ref.current.getBoundingClientRect();
    const [ox, oy] = origin.split(' ');
    const px = ox === 'left' ? r.left : ox === 'right' ? r.right : r.left + r.width / 2;
    const py = oy === 'top' ? r.top : oy === 'bottom' ? r.bottom : r.top + r.height / 2;
    const d0 = Math.hypot(e.clientX - px, e.clientY - py) || 1;
    drag.current = { kind: 'size', px, py, d0, a };
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'move') {
      // A pointer that wobbles a pixel or two is still a click, not a move.
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
      d.moved = true;
      const k = d.zoom * PX_PER_MM;
      change(moveBy(d.a, (e.clientX - d.x) / k, (e.clientY - d.y) / k));
    } else {
      const dist = Math.hypot(e.clientX - d.px, e.clientY - d.py);
      change(sizeTo(d.a, d.a.scale * (dist / d.d0)));
    }
  };

  const endDrag = () => { drag.current = null; };
  // A second click on a selected line of text, without moving it, opens it for typing.
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === 'move' && d.was && !d.moved) editText(d.textField);
  };
  const onDoubleClick = (e) => editText(e.target.closest?.('[data-edit-text]')?.dataset.editText);

  const onKeyDown = (e) => {
    if (e.target.isContentEditable) return;
    if (e.key === 'Enter' && selected && text) { e.preventDefault(); editText(text); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); return; }
    if (!selected) return;
    const step = e.shiftKey ? 5 : 1;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) { e.preventDefault(); change(moveBy(a, ...moves[e.key])); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); change(sizeTo(a, a.scale + 10)); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); change(sizeTo(a, a.scale - 10)); }
    else if (e.key === 'Escape') { e.preventDefault(); ed.onSelect(null); }
  };

  // The outline and corner sit inside the scaled item, so their size is
  // divided back out to stay the same on screen whatever the item's size.
  const k = s * (selected ? ed.selected.zoom || 1 : 1);
  return (
    <div
      ref={ref} role="button" tabIndex={0} aria-pressed={selected}
      aria-label={`${label}. ${selected ? `Selected: drag to move, drag the corner to resize, or use the arrow and plus or minus keys.${text ? ' Press Enter to type.' : ''}` : 'Select to move or resize.'}`}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={endDrag}
      onDoubleClick={onDoubleClick} onKeyDown={onKeyDown}
      className="edit-item"
      style={{
        ...style, ...placed, position: style?.position || 'relative', outline: 'none',
        cursor: selected ? 'move' : 'pointer', touchAction: selected ? 'none' : 'auto',
      }}
    >
      {children}
      <span
        data-html2canvas-ignore="true" aria-hidden="true"
        className={selected ? 'edit-frame on' : 'edit-frame'}
        style={{ borderWidth: `${(selected ? 2 : 1) / k}px`, inset: `${-3 / k}px` }}
      />
      {selected && (
        <span
          data-html2canvas-ignore="true" aria-hidden="true" className="edit-handle"
          onPointerDown={onHandleDown}
          style={{ width: HANDLE / k, height: HANDLE / k, right: -HANDLE / 2 / k, bottom: -HANDLE / 2 / k, borderWidth: 2 / k }}
        />
      )}
    </div>
  );
}

/**
 * Over the live preview: what is selected and buttons to move and resize it,
 * or, with nothing selected, how to start.
 */
export function EditBar({ selected, value, onChange, onDone, hint = 'Tap the logo, a signature or any text on the page to move or resize it', children }) {
  if (!selected) return <span className="edit-bar-hint">{hint}</span>;
  const a = adjustOf(value);
  const btn = (labelText, icon, onClick, disabled) => (
    <button type="button" className="edit-bar-btn" aria-label={labelText} title={labelText} onClick={onClick} disabled={disabled}>{icon}</button>
  );
  return (
    <div className="edit-bar" role="group" aria-label={`Place ${selected.label}`}>
      <span className="edit-bar-name">{selected.label}</span>
      {btn('Move left', <ArrowLeft size={14} />, () => onChange(moveBy(a, -2, 0)))}
      {btn('Move up', <ArrowUp size={14} />, () => onChange(moveBy(a, 0, -2)))}
      {btn('Move down', <ArrowDown size={14} />, () => onChange(moveBy(a, 0, 2)))}
      {btn('Move right', <ArrowRight size={14} />, () => onChange(moveBy(a, 2, 0)))}
      <span className="edit-bar-sep" aria-hidden="true" />
      {btn('Smaller', <Minus size={14} />, () => onChange(sizeTo(a, a.scale - 10)), a.scale <= MIN_SCALE)}
      <output className="edit-bar-size" aria-live="polite">{a.scale}%</output>
      {btn('Bigger', <Plus size={14} />, () => onChange(sizeTo(a, a.scale + 10)), a.scale >= MAX_SCALE)}
      {children && <><span className="edit-bar-sep" aria-hidden="true" />{children}</>}
      <span className="edit-bar-sep" aria-hidden="true" />
      <button type="button" className="edit-bar-text" onClick={() => onChange(null)} disabled={!isAdjusted(value)}>
        <RotateCcw size={12} aria-hidden="true" /> Reset
      </button>
      <button type="button" className="edit-bar-text primary" onClick={onDone}>
        <Check size={13} aria-hidden="true" /> Done
      </button>
    </div>
  );
}
