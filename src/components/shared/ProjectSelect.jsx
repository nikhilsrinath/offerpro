import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';

/**
 * A project dropdown that reads as two columns: the name on the left, the
 * code on the right, every code in the same place. A native <select> cannot
 * line them up (its options are one string in a proportional font), so this
 * is the vendor dropdown's list (VendorSelect) with the code as its aside.
 * Codes are drawn with equal-width digits, so PRJ-2026-001 and PRJ-2026-008
 * are the same width.
 *
 * `noneLabel` adds a first option that clears the choice; `onChange(id)`
 * gets '' for it.
 *
 * `floating` draws the list over the page (a portal), so a section that clips
 * its content cannot cut it off, and opens it upward only when there is no
 * room below. `btnStyle` styles the closed control, to match the fields
 * next to it.
 */
export default function ProjectSelect({ id, projects, value, onChange, noneLabel = 'None', placeholder = 'Choose a project…', disabled = false, floating = false, btnStyle, ariaLabel }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [pos, setPos] = useState(null);
    const boxRef = useRef(null);
    const btnRef = useRef(null);
    const panelRef = useRef(null);

    const close = () => { setOpen(false); setQuery(''); };

    useEffect(() => {
        if (!open) return undefined;
        const onDown = (e) => {
            if (boxRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
            close();
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    // Floating: under the control, the control's width (at least 300px), or
    // above it when the window has no room below. Follows the page as it scrolls.
    const place = () => {
        const r = btnRef.current?.getBoundingClientRect();
        if (!r) return;
        const h = panelRef.current?.offsetHeight || 0;
        const below = window.innerHeight - r.bottom;
        const width = Math.min(Math.max(r.width, 300), window.innerWidth - 16);
        setPos({
            left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), width,
            ...(h && below < h + 12 && r.top > below ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
        });
    };
    useLayoutEffect(() => {
        if (!open || !floating) return undefined;
        place();
        const onMove = (e) => { if (!panelRef.current?.contains(e.target)) place(); };
        window.addEventListener('resize', place);
        window.addEventListener('scroll', onMove, true);
        return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', onMove, true); };
    }, [open, floating]);

    // Esc closes the dropdown only, not the panel it sits in.
    const onKeyDown = (e) => {
        if (e.key !== 'Escape' || !open) return;
        e.stopPropagation();
        close();
        btnRef.current?.focus();
    };

    const chosen = projects.find((p) => p.id === value) || null;
    const q = query.trim().toLowerCase();
    const shown = q ? projects.filter((p) => [p.name, p.code].some((f) => String(f || '').toLowerCase().includes(q))) : projects;
    const pick = (v) => { onChange(v); close(); btnRef.current?.focus(); };
    const wrap = (el) => (floating ? createPortal(el, document.body) : el);
    const code = { fontVariantNumeric: 'tabular-nums', fontWeight: 400, color: 'var(--text-muted)', paddingLeft: 12 };

    return (
        <div ref={boxRef} className="vsel" onKeyDown={onKeyDown}>
            <button ref={btnRef} id={id} type="button" className="vsel-btn" aria-haspopup="listbox" aria-expanded={open} disabled={disabled}
                aria-label={ariaLabel} style={btnStyle} onClick={() => (open ? close() : (setPos(null), setOpen(true)))}>
                <span className={chosen ? '' : 'vsel-placeholder'} style={{ display: 'flex', gap: 8, minWidth: 0, flex: 1 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chosen ? chosen.name : noneLabel || placeholder}</span>
                    {chosen?.code && <span style={{ ...code, paddingLeft: 0, marginLeft: 'auto', marginRight: 6 }}>{chosen.code}</span>}
                </span>
                <ChevronDown size={15} aria-hidden="true" />
            </button>

            {open && wrap(
                <div ref={panelRef} className={floating ? 'vsel prodpick-panel vsel-panel' : 'prodpick-panel vsel-panel'}
                    style={floating ? {
                        position: 'fixed', zIndex: 2000, left: pos?.left ?? 0, width: pos?.width, // 'auto', not undefined: the stylesheet's own `top` would otherwise
                        // push a list that opens upward off the bottom of the window.
                        top: pos?.top ?? 'auto', bottom: pos?.bottom ?? 'auto', maxWidth: 'none',
                        visibility: pos ? 'visible' : 'hidden',
                    } : undefined}>
                    <div className="prodpick-search">
                        <Search size={13} aria-hidden="true" />
                        <input autoFocus aria-label="Search projects" value={query} onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search name or code..." className="prodpick-search-inp" />
                    </div>
                    {noneLabel && !q && (
                        <button type="button" role="option" aria-selected={!value} className="prodpick-item vsel-item" onClick={() => pick('')}>
                            <span className="prodpick-item-main"><span className="prodpick-item-name">{noneLabel}</span></span>
                            {!value && <Check size={13} className="prodpick-item-check" aria-hidden="true" />}
                        </button>
                    )}
                    {shown.length === 0 ? (
                        <div className="prodpick-empty">{q ? 'No project matches that search.' : 'No projects yet.'}</div>
                    ) : (
                        <div className="prodpick-list" role="listbox" aria-label="Projects">
                            {shown.map((p) => (
                                <button key={p.id} type="button" role="option" aria-selected={p.id === value}
                                    className="prodpick-item vsel-item" onClick={() => pick(p.id)}>
                                    <span className="prodpick-item-main"><span className="prodpick-item-name">{p.name}</span></span>
                                    {p.code && <span className="prodpick-item-price" style={code}>{p.code}</span>}
                                    {/* The tick's room is kept on every row, so the chosen one's code stays in the column. */}
                                    <span style={{ width: 13, flexShrink: 0, display: 'inline-flex' }} aria-hidden="true">
                                        {p.id === value && <Check size={13} className="prodpick-item-check" />}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
