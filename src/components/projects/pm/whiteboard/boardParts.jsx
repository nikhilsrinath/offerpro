import { useEffect, useLayoutEffect, useRef } from 'react';
import {
    Minus, Plus, Scan, Map as MapIcon, Trash2, Copy, BringToFront, SendToBack, Bold,
} from 'lucide-react';
import { useT } from '../../../ui/edgeUtils';
import {
    STICKY_COLORS, INK_COLORS, FILL_COLORS, SHAPES, TEXT_SIZES,
    stickyFill, arrowEnds, penPath, stickyFontSize, boundsOf,
} from './boardModel';
import { TOOLS } from './boardTools';

/* The pieces of the whiteboard (WhiteboardPage.jsx): how each item is drawn,
   and the floating tool bar, selection bar, zoom bar and minimap. */

export const BOARD_FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const NOTE_INK = '#1F2937';
// The board is paper in both themes: it reads (and exports) the same either way.
export const CANVAS_BG = '#F7F8FA';
export const CANVAS_DOT = '#C5CCD6';
const SELECT = '#259E95';

// ── Text on an item ──────────────────────────────────────────────────────────

/**
 * Text being typed into an item: a plain-text contentEditable, so a sticky's
 * text stays centred while it is written, exactly as it is shown. Uncontrolled:
 * the text is set once, and each keystroke is reported up.
 */
function EditableText({ text, style, onChange, onDone, onHeight }) {
    const ref = useRef(null);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.innerText = text || '';
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        if (onHeight) onHeight(el.offsetHeight);
        // Only on opening: the text is the element's own after that.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
        <div ref={ref} contentEditable="plaintext-only" suppressContentEditableWarning role="textbox" aria-multiline="true"
            aria-label="Text" spellCheck
            onInput={(e) => { onChange(e.currentTarget.innerText.replace(/\n$/, '')); if (onHeight) onHeight(e.currentTarget.offsetHeight); }}
            onPaste={(e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); }}
            onBlur={onDone}
            onKeyDown={(e) => {
                if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); e.currentTarget.blur(); }
                e.stopPropagation();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            style={{ ...style, outline: 'none', cursor: 'text', minWidth: '1ch' }} />
    );
}

/** The text inside a sticky, a shape or a text item, shown or being edited. */
function ItemText({ it, editing, box, style, onText, onDone, onHeight, center = true }) {
    const shown = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word', ...style };
    return (
        <foreignObject x={box.x} y={box.y} width={box.w} height={box.h} style={{ overflow: 'visible' }}>
            <div xmlns="http://www.w3.org/1999/xhtml" style={{
                width: '100%', height: '100%', display: 'flex', boxSizing: 'border-box',
                alignItems: center ? 'center' : 'flex-start', justifyContent: center ? 'center' : 'flex-start',
                textAlign: center ? 'center' : 'left', fontFamily: BOARD_FONT, pointerEvents: editing ? 'auto' : 'none',
            }}>
                {editing
                    ? <EditableText text={it.text} style={{ ...shown, width: center ? undefined : '100%', maxWidth: '100%' }} onChange={onText} onDone={onDone} onHeight={onHeight} />
                    : <div style={{ ...shown, width: center ? undefined : '100%', maxWidth: '100%' }}>{it.text}</div>}
            </div>
        </foreignObject>
    );
}

// ── Items ────────────────────────────────────────────────────────────────────

/** One item, drawn in board units. `map` is every item by id, for arrows. */
export function ItemView({ it, map, editing, onText, onDone, onHeight }) {
    if (it.type === 'sticky') {
        const fs = stickyFontSize(it.text, it.w);
        return (
            <g data-id={it.id} style={{ cursor: 'move' }}>
                <rect x={it.x} y={it.y + 3} width={it.w} height={it.h} rx={3} fill="rgba(20,41,62,.10)" />
                <rect x={it.x} y={it.y} width={it.w} height={it.h} rx={3} fill={stickyFill(it.color)} />
                <ItemText it={it} editing={editing} onText={onText} onDone={onDone}
                    box={{ x: it.x + 14, y: it.y + 14, w: it.w - 28, h: it.h - 28 }}
                    style={{ fontSize: fs, lineHeight: 1.3, color: NOTE_INK }} />
            </g>
        );
    }
    if (it.type === 'text') {
        return (
            <g data-id={it.id} style={{ cursor: 'move' }}>
                <rect x={it.x} y={it.y} width={it.w} height={it.h} fill="transparent" />
                <ItemText it={it} editing={editing} onText={onText} onDone={onDone} onHeight={onHeight} center={false}
                    box={{ x: it.x, y: it.y, w: it.w, h: it.h }}
                    style={{ fontSize: it.fontSize || 18, lineHeight: 1.35, color: it.color, fontWeight: it.bold ? 700 : 400, padding: '4px 2px' }} />
                {!it.text && !editing && (
                    <text x={it.x + 2} y={it.y + (it.fontSize || 18) + 4} fontSize={it.fontSize || 18} fill="#9AA3AF" fontFamily={BOARD_FONT}>Text</text>
                )}
            </g>
        );
    }
    if (it.type === 'shape') {
        const common = { fill: it.fill === 'transparent' ? 'rgba(0,0,0,0)' : it.fill, stroke: it.stroke, strokeWidth: 2, vectorEffect: 'non-scaling-stroke' };
        const { x, y, w, h } = it;
        const body = it.shape === 'ellipse' ? <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...common} />
            : it.shape === 'diamond' ? <polygon points={`${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`} {...common} />
                : <rect x={x} y={y} width={w} height={h} rx={it.shape === 'round' ? Math.min(18, w / 4, h / 4) : 2} {...common} />;
        const inset = it.shape === 'diamond' ? 0.2 : it.shape === 'ellipse' ? 0.15 : 0.06;
        const dark = it.fill === '#14293E';
        return (
            <g data-id={it.id} style={{ cursor: 'move' }}>
                {body}
                <ItemText it={it} editing={editing} onText={onText} onDone={onDone}
                    box={{ x: x + w * inset, y: y + h * inset, w: w * (1 - inset * 2), h: h * (1 - inset * 2) }}
                    style={{ fontSize: 16, lineHeight: 1.3, color: dark ? '#FFFFFF' : it.color || NOTE_INK }} />
            </g>
        );
    }
    if (it.type === 'arrow') {
        const e = arrowEnds(it, map);
        return (
            <g data-id={it.id} style={{ cursor: 'move' }}>
                <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="transparent" strokeWidth={16} vectorEffect="non-scaling-stroke" />
                <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke={it.color} strokeWidth={it.width || 2}
                    strokeLinecap="round" markerEnd={it.head === false ? undefined : `url(#wb-head-${it.color.replace('#', '')})`} />
            </g>
        );
    }
    if (it.type === 'pen') {
        const d = penPath(it.points);
        return (
            <g data-id={it.id} transform={`translate(${it.x} ${it.y})`} style={{ cursor: 'move' }}>
                <path d={d} fill="none" stroke="transparent" strokeWidth={(it.width || 3) + 14} strokeLinecap="round" strokeLinejoin="round" />
                <path d={d} fill="none" stroke={it.color} strokeWidth={it.width || 3} strokeLinecap="round" strokeLinejoin="round" />
            </g>
        );
    }
    return null;
}

/** Arrow heads, one per ink colour (an SVG marker cannot take its line's colour). */
export function ArrowHeads() {
    return (
        <defs>
            {INK_COLORS.map((c) => (
                <marker key={c} id={`wb-head-${c.replace('#', '')}`} viewBox="0 0 10 10" refX="8.5" refY="5"
                    markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="strokeWidth">
                    <path d="M0 0 L10 5 L0 10 z" fill={c} />
                </marker>
            ))}
        </defs>
    );
}

/** The selection: a frame round each item, and handles when one item is chosen. */
export function SelectionOverlay({ items, map, zoom, single }) {
    const hs = 9 / zoom;
    const sw = 1.5 / zoom;
    return (
        <g data-overlay pointerEvents="none">
            {items.map((it) => {
                if (it.type === 'arrow') {
                    const e = arrowEnds(it, map);
                    return <line key={it.id} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke={SELECT} strokeWidth={(it.width || 2) + 4 / zoom} strokeOpacity={0.35} strokeLinecap="round" />;
                }
                return <rect key={it.id} x={it.x - 3 / zoom} y={it.y - 3 / zoom} width={it.w + 6 / zoom} height={it.h + 6 / zoom} fill="none" stroke={SELECT} strokeWidth={sw} rx={2 / zoom} />;
            })}
            {single && single.type === 'arrow' && (() => {
                const e = arrowEnds(single, map);
                return ['from', 'to'].map((end) => (
                    <circle key={end} data-handle={`arrow-${end}`} pointerEvents="all" style={{ cursor: 'crosshair' }}
                        cx={end === 'from' ? e.x1 : e.x2} cy={end === 'from' ? e.y1 : e.y2} r={hs / 1.6}
                        fill="#FFFFFF" stroke={SELECT} strokeWidth={sw} />
                ));
            })()}
            {single && single.type !== 'arrow' && ['nw', 'ne', 'sw', 'se'].map((h) => (
                <rect key={h} data-handle={h} pointerEvents="all"
                    style={{ cursor: h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize' }}
                    x={(h.includes('w') ? single.x - 3 / zoom : single.x + single.w + 3 / zoom) - hs / 2}
                    y={(h.includes('n') ? single.y - 3 / zoom : single.y + single.h + 3 / zoom) - hs / 2}
                    width={hs} height={hs} rx={2 / zoom} fill="#FFFFFF" stroke={SELECT} strokeWidth={sw} />
            ))}
        </g>
    );
}

// ── Floating chrome ──────────────────────────────────────────────────────────

/** A floating panel on the board. */
export function Float({ style, children, label, role = 'toolbar' }) {
    const t = useT();
    return (
        <div role={role} aria-label={label} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} style={{
            position: 'absolute', zIndex: 5, display: 'flex', alignItems: 'center', gap: 2, padding: 4,
            background: t.card, border: '1px solid ' + t.line, borderRadius: 10,
            boxShadow: '0 1px 2px rgba(20,41,62,.06), 0 6px 18px rgba(20,41,62,.08)', ...style,
        }}>
            {children}
        </div>
    );
}

export function ToolBtn({ active, label, keyHint, onClick, children, disabled, size = 34 }) {
    const t = useT();
    return (
        <button type="button" aria-label={label} aria-pressed={active == null ? undefined : !!active}
            title={keyHint ? `${label} (${keyHint})` : label} disabled={disabled} onClick={onClick}
            className="wb-tool"
            style={{
                width: size, height: size, display: 'grid', placeItems: 'center', borderRadius: 7, border: 0, padding: 0,
                background: active ? t.accentSoft : 'transparent', color: active ? t.accent : t.dim,
                cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1, flexShrink: 0,
            }}>
            {children}
        </button>
    );
}

export const Divider = ({ vertical = false }) => {
    const t = useT();
    return <span aria-hidden="true" style={vertical ? { width: 22, height: 1, background: t.line, margin: '3px auto' } : { width: 1, height: 22, background: t.line, margin: '0 3px' }} />;
};

function Swatch({ color, active, onClick, label, round = true }) {
    const t = useT();
    const none = color === 'transparent';
    return (
        <button type="button" aria-label={label} aria-pressed={active} title={label} onClick={onClick} className="wb-tool"
            style={{
                width: 26, height: 26, borderRadius: 7, border: 0, padding: 0, display: 'grid', placeItems: 'center',
                background: active ? t.accentSoft : 'transparent', cursor: 'pointer',
            }}>
            <span style={{
                width: 16, height: 16, borderRadius: round ? '50%' : 4,
                background: none ? 'linear-gradient(135deg, #fff 45%, #C62828 46%, #C62828 54%, #fff 55%)' : color,
                boxShadow: 'inset 0 0 0 1px rgba(20,41,62,.22)',
            }} />
        </button>
    );
}



/** The tools, down the left side, with each tool's options beside it. */
export function ToolRail({ tool, setTool, opts, setOpts, readOnly }) {
    const t = useT();
    const list = readOnly ? TOOLS.slice(0, 2) : TOOLS;
    return (
        <>
            <Float label="Tools" style={{ left: 12, top: '50%', transform: 'translateY(-50%)', flexDirection: 'column' }}>
                {list.map(({ id, label, key, Icon }, n) => (
                    <span key={id} style={{ display: 'contents' }}>
                        {n === 2 && <Divider vertical />}
                        <ToolBtn active={tool === id} label={label} keyHint={key} onClick={() => setTool(id)}>
                            <Icon size={17} strokeWidth={1.9} aria-hidden="true" />
                        </ToolBtn>
                    </span>
                ))}
            </Float>
            {!readOnly && tool === 'sticky' && (
                <Float label="Sticky note colour" style={{ left: 60, top: '50%', transform: 'translateY(-50%)', flexDirection: 'column' }}>
                    {STICKY_COLORS.map((c) => (
                        <Swatch key={c.id} color={c.fill} round={false} label={c.label} active={opts.sticky === c.id}
                            onClick={() => setOpts({ ...opts, sticky: c.id })} />
                    ))}
                </Float>
            )}
            {!readOnly && tool === 'shape' && (
                <Float label="Shape" style={{ left: 60, top: '50%', transform: 'translateY(-50%)', flexDirection: 'column' }}>
                    {SHAPES.map((s) => (
                        <ToolBtn key={s.id} size={30} label={s.label} active={opts.shape === s.id} onClick={() => setOpts({ ...opts, shape: s.id })}>
                            <ShapeGlyph shape={s.id} color={t.dim} />
                        </ToolBtn>
                    ))}
                </Float>
            )}
            {!readOnly && (tool === 'pen' || tool === 'arrow') && (
                <Float label={tool === 'pen' ? 'Pen colour' : 'Arrow colour'} style={{ left: 60, top: '50%', transform: 'translateY(-50%)', flexDirection: 'column' }}>
                    {INK_COLORS.map((c) => (
                        <Swatch key={c} color={c} label={`Colour ${c}`} active={opts.ink === c} onClick={() => setOpts({ ...opts, ink: c })} />
                    ))}
                    {tool === 'pen' && <Divider vertical />}
                    {tool === 'pen' && [2, 4, 8].map((w) => (
                        <ToolBtn key={w} size={28} label={`${w === 2 ? 'Thin' : w === 4 ? 'Medium' : 'Thick'} line`} active={opts.width === w}
                            onClick={() => setOpts({ ...opts, width: w })}>
                            <span style={{ width: 16, height: w, borderRadius: w, background: t.dim }} />
                        </ToolBtn>
                    ))}
                </Float>
            )}
        </>
    );
}

export function ShapeGlyph({ shape, color, size = 16 }) {
    const s = size;
    const p = { fill: 'none', stroke: color, strokeWidth: 1.7 };
    return (
        <svg width={s} height={s} viewBox="0 0 16 16" aria-hidden="true">
            {shape === 'ellipse' ? <ellipse cx="8" cy="8" rx="6.5" ry="5" {...p} />
                : shape === 'diamond' ? <polygon points="8,1.5 14.5,8 8,14.5 1.5,8" {...p} />
                    : <rect x="1.5" y="3" width="13" height="10" rx={shape === 'round' ? 3.5 : 0.8} {...p} />}
        </svg>
    );
}

/**
 * What can be done to the selection, floating above it: colours for the kind
 * of item chosen, text size, shape, then order, copy and delete.
 */
export function ContextBar({ chosen, pos, onPatch, onFront, onBack, onDuplicate, onDelete }) {
    const types = new Set(chosen.map((i) => i.type));
    const only = types.size === 1 ? [...types][0] : null;
    const first = chosen[0];
    return (
        <Float label="Selection" style={{ left: pos.x, top: pos.y, transform: 'translate(-50%, -100%)' }}>
            {only === 'sticky' && STICKY_COLORS.map((c) => (
                <Swatch key={c.id} color={c.fill} round={false} label={c.label} active={chosen.every((i) => i.color === c.id)} onClick={() => onPatch({ color: c.id })} />
            ))}
            {only === 'shape' && (
                <>
                    {SHAPES.map((s) => (
                        <ToolBtn key={s.id} size={28} label={s.label} active={chosen.every((i) => i.shape === s.id)} onClick={() => onPatch({ shape: s.id })}>
                            <ShapeGlyph shape={s.id} color="currentColor" size={15} />
                        </ToolBtn>
                    ))}
                    <Divider />
                    {FILL_COLORS.map((c) => (
                        <Swatch key={c} color={c} round={false} label={c === 'transparent' ? 'No fill' : `Fill ${c}`} active={chosen.every((i) => i.fill === c)} onClick={() => onPatch({ fill: c })} />
                    ))}
                    <Divider />
                    {INK_COLORS.slice(0, 5).map((c) => (
                        <Swatch key={c} color={c} label={`Outline ${c}`} active={chosen.every((i) => i.stroke === c)} onClick={() => onPatch({ stroke: c, color: c })} />
                    ))}
                </>
            )}
            {only === 'text' && (
                <>
                    {TEXT_SIZES.map((s) => (
                        <ToolBtn key={s.id} size={28} label={`Text size ${s.label}`} active={chosen.every((i) => (i.fontSize || 18) === s.id)} onClick={() => onPatch({ fontSize: s.id })}>
                            <span style={{ fontSize: 11.5, fontWeight: 600 }}>{s.label}</span>
                        </ToolBtn>
                    ))}
                    <ToolBtn size={28} label="Bold" active={chosen.every((i) => i.bold)} onClick={() => onPatch({ bold: !first.bold })}>
                        <Bold size={15} aria-hidden="true" />
                    </ToolBtn>
                    <Divider />
                    {INK_COLORS.map((c) => (
                        <Swatch key={c} color={c} label={`Colour ${c}`} active={chosen.every((i) => i.color === c)} onClick={() => onPatch({ color: c })} />
                    ))}
                </>
            )}
            {(only === 'arrow' || only === 'pen') && (
                <>
                    {INK_COLORS.map((c) => (
                        <Swatch key={c} color={c} label={`Colour ${c}`} active={chosen.every((i) => i.color === c)} onClick={() => onPatch({ color: c })} />
                    ))}
                    <Divider />
                    {(only === 'pen' ? [2, 4, 8] : [2, 3, 5]).map((w) => (
                        <ToolBtn key={w} size={28} label={`Line ${w}`} active={chosen.every((i) => (i.width || 2) === w)} onClick={() => onPatch({ width: w })}>
                            <span style={{ width: 15, height: Math.min(w, 6), borderRadius: 4, background: 'currentColor' }} />
                        </ToolBtn>
                    ))}
                </>
            )}
            {only && <Divider />}
            <ToolBtn size={28} label="Bring to front" onClick={onFront}><BringToFront size={15} aria-hidden="true" /></ToolBtn>
            <ToolBtn size={28} label="Send to back" onClick={onBack}><SendToBack size={15} aria-hidden="true" /></ToolBtn>
            <ToolBtn size={28} label="Duplicate" keyHint="Ctrl+D" onClick={onDuplicate}><Copy size={15} aria-hidden="true" /></ToolBtn>
            <ToolBtn size={28} label="Delete" keyHint="Delete" onClick={onDelete}><Trash2 size={15} aria-hidden="true" /></ToolBtn>
        </Float>
    );
}

/** Zoom out, the zoom level (click for 100%), zoom in, fit everything, and the minimap switch. */
export function ZoomBar({ zoom, onZoom, onReset, onFit, mapOn, onMap }) {
    const t = useT();
    return (
        <Float label="Zoom" style={{ right: 12, bottom: 12 }}>
            <ToolBtn size={30} label={mapOn ? 'Hide the minimap' : 'Show the minimap'} active={mapOn} onClick={onMap}><MapIcon size={15} aria-hidden="true" /></ToolBtn>
            <Divider />
            <ToolBtn size={30} label="Zoom out" keyHint="-" onClick={() => onZoom(1 / 1.2)}><Minus size={15} aria-hidden="true" /></ToolBtn>
            <button type="button" onClick={onReset} title="Zoom to 100% (Ctrl+0)" className="wb-tool" style={{
                minWidth: 52, height: 30, border: 0, borderRadius: 7, background: 'transparent', color: t.text,
                fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums', cursor: 'pointer',
            }}>{Math.round(zoom * 100)}%</button>
            <ToolBtn size={30} label="Zoom in" keyHint="+" onClick={() => onZoom(1.2)}><Plus size={15} aria-hidden="true" /></ToolBtn>
            <ToolBtn size={30} label="Fit everything on screen" keyHint="Shift+1" onClick={onFit}><Scan size={15} aria-hidden="true" /></ToolBtn>
        </Float>
    );
}

/** The whole board in miniature, with the part on screen framed; click or drag to go there. */
export function Minimap({ items, map, view, screen, onGo }) {
    const t = useT();
    const W = 188;
    const H = 120;
    const vp = { x: -view.x / view.zoom, y: -view.y / view.zoom, w: screen.w / view.zoom, h: screen.h / view.zoom };
    const content = boundsOf(items, map);
    const all = content
        ? { x: Math.min(content.x, vp.x), y: Math.min(content.y, vp.y), w: 0, h: 0 }
        : { ...vp };
    if (content) {
        all.w = Math.max(content.x + content.w, vp.x + vp.w) - all.x;
        all.h = Math.max(content.y + content.h, vp.y + vp.h) - all.y;
    }
    const pad = 8;
    const k = Math.min((W - pad * 2) / Math.max(1, all.w), (H - pad * 2) / Math.max(1, all.h));
    const ox = pad + ((W - pad * 2) - all.w * k) / 2;
    const oy = pad + ((H - pad * 2) - all.h * k) / 2;
    const sx = (x) => ox + (x - all.x) * k;
    const sy = (y) => oy + (y - all.y) * k;
    const go = (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onGo((e.clientX - r.left - ox) / k + all.x, (e.clientY - r.top - oy) / k + all.y);
    };
    const drag = useRef(false);
    useEffect(() => {
        const up = () => { drag.current = false; };
        window.addEventListener('pointerup', up);
        return () => window.removeEventListener('pointerup', up);
    }, []);
    return (
        <div onPointerDown={(e) => { e.stopPropagation(); drag.current = true; go(e); }}
            onPointerMove={(e) => { if (drag.current) go(e); }}
            role="img" aria-label="Minimap of the board"
            style={{
                position: 'absolute', right: 12, bottom: 56, zIndex: 5, width: W, height: H, cursor: 'pointer',
                background: t.card, border: '1px solid ' + t.line, borderRadius: 10, overflow: 'hidden',
                boxShadow: '0 1px 2px rgba(20,41,62,.06), 0 6px 18px rgba(20,41,62,.08)',
            }}>
            <svg width={W} height={H} style={{ display: 'block', background: CANVAS_BG }}>
                {items.map((it) => {
                    if (it.type === 'arrow') {
                        const e = arrowEnds(it, map);
                        return <line key={it.id} x1={sx(e.x1)} y1={sy(e.y1)} x2={sx(e.x2)} y2={sy(e.y2)} stroke={it.color} strokeWidth={1} />;
                    }
                    const fill = it.type === 'sticky' ? stickyFill(it.color)
                        : it.type === 'shape' ? (it.fill === 'transparent' ? '#FFFFFF' : it.fill)
                            : it.type === 'pen' ? 'transparent' : '#AEB6C1';
                    return <rect key={it.id} x={sx(it.x)} y={sy(it.y)} width={Math.max(1.5, it.w * k)} height={Math.max(1.5, it.h * k)}
                        fill={fill} stroke={it.type === 'pen' ? it.color : it.type === 'shape' ? it.stroke : 'none'} strokeWidth={0.6} rx={0.8} />;
                })}
                <rect x={sx(vp.x)} y={sy(vp.y)} width={vp.w * k} height={vp.h * k} fill="rgba(37,158,149,.10)" stroke={SELECT} strokeWidth={1.4} rx={2} />
            </svg>
        </div>
    );
}
