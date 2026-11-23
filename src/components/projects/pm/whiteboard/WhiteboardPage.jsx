import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Undo2, Redo2, Download, Maximize2, Minimize2, Keyboard, CloudCheck, CloudOff, LoaderCircle, Lock } from 'lucide-react';
import { Panel, Empty, Loading, Btn } from '../../../ui/edge';
import { useT } from '../../../ui/edgeUtils';
import { useToast } from '../../../shared/Toast';
import { orgStore } from '../../../../services/orgStore';
import { whiteboardService, BoardConflict, boardTableMissing } from '../../../../services/whiteboardService';
import { useProjectPeople } from '../../team/teamData';
import {
    normalizeBoard, makeSticky, makeText, makeShape, makeArrow, makePen,
    moveItems, resizeItem, boxFromHandle, deleteItems, cloneItems, restack, patchItems,
    boundsOf, boxOf, intersects, itemAt, zoomAt, fitView, clamp, center,
    emptyHistory, remember, undo as undoStep, redo as redoStep, boardSvg, MIN_ZOOM, MAX_ZOOM,
} from './boardModel';
import {
    ItemView, ArrowHeads, SelectionOverlay, ToolRail, ContextBar, ZoomBar, Minimap, Float, ToolBtn, Divider,
    CANVAS_BG, CANVAS_DOT, BOARD_FONT,
} from './boardParts';
import { TOOLS } from './boardTools';
import { prefSet } from '../../../../services/userPrefs';

/* ══════════════════════════════════════════════════════════════════════════
   Planning › Whiteboard: a Miro-style board for the project.

   Sticky notes, text, shapes, arrows that stay stuck to what they join, and
   a pen; pan, zoom, a minimap, undo and redo, copy and paste. The board saves
   itself a moment after each change (whiteboardService, 0111); the project's
   current members and anyone who may edit tasks can draw on it.

   Where you are looking (pan and zoom) is yours, kept in this browser, not
   saved with the board: one person zooming in does not move anyone else.
   ══════════════════════════════════════════════════════════════════════════ */

const SAVE_DELAY = 1200;
const POLL_EVERY = 15000;
const viewKey = (id) => `eo-wb-view-${id}`;
const isTyping = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

const ago = (iso) => {
    if (!iso) return '';
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

export default function WhiteboardPage({ project }) {
    const t = useT();
    const toast = useToast();
    const team = useProjectPeople(project);
    const orgId = orgStore.getOrgId();

    const isMember = !!team.me && team.current.some((p) => p.id === team.me);
    const readOnly = team.locked || !(isMember || orgStore.can('tasks', 'edit') || orgStore.can('tasks', 'create'));

    // ── The board ────────────────────────────────────────────────────────────
    const [status, setStatus] = useState('loading');     // loading | ready | missing | error
    const [loadError, setLoadError] = useState('');
    const [items, setItemsState] = useState([]);
    const [history, setHistory] = useState(emptyHistory);
    const [meta, setMeta] = useState({ version: null, updatedAt: null, updatedBy: null });
    const [save, setSave] = useState('saved');            // saved | dirty | saving | error | conflict
    const [conflict, setConflict] = useState(null);

    const itemsRef = useRef(items);
    const metaRef = useRef(meta);
    const dirtyRef = useRef(false);
    const savingRef = useRef(false);
    useEffect(() => { itemsRef.current = items; }, [items]);
    useEffect(() => { metaRef.current = meta; }, [meta]);

    /** A change made by the user: remembered for Undo and saved shortly. */
    const commit = useCallback((next, before = itemsRef.current) => {
        if (readOnly) return;
        setHistory((h) => remember(h, before));
        itemsRef.current = next;
        setItemsState(next);
        dirtyRef.current = true;
        setSave('dirty');
    }, [readOnly]);
    /** A change in progress (a drag): shown, not yet remembered. */
    const preview = useCallback((next) => { itemsRef.current = next; setItemsState(next); }, []);

    // ── The view ─────────────────────────────────────────────────────────────
    const wrapRef = useRef(null);
    const svgRef = useRef(null);
    const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
    const viewRef = useRef(view);
    useEffect(() => { viewRef.current = view; }, [view]);
    const [screen, setScreen] = useState({ w: 1000, h: 600 });
    const [mapOn, setMapOn] = useState(true);
    const [full, setFull] = useState(false);

    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return undefined;
        const ro = new ResizeObserver(([e]) => setScreen({ w: e.contentRect.width, h: e.contentRect.height }));
        ro.observe(el);
        return () => ro.disconnect();
    }, [status]);
    useEffect(() => {
        if (status !== 'ready') return;
        prefSet(viewKey(project.id), JSON.stringify(view));
    }, [view, project.id, status]);

    const fit = useCallback((list = itemsRef.current) => {
        const el = wrapRef.current;
        if (!el) return;
        setView(fitView(boundsOf(list, list), el.clientWidth, el.clientHeight));
    }, []);

    // ── Loading and saving ───────────────────────────────────────────────────
    const applyRow = useCallback((row, { keepView = true } = {}) => {
        const board = normalizeBoard(row?.data);
        itemsRef.current = board.items;
        setItemsState(board.items);
        setMeta({ version: row?.version ?? null, updatedAt: row?.updated_at || null, updatedBy: row?.updated_by || null });
        dirtyRef.current = false;
        setSave('saved');
        if (!keepView) {
            let saved = null;
            try { saved = JSON.parse(localStorage.getItem(viewKey(project.id)) || 'null'); } catch { /* none */ }
            if (saved && Number.isFinite(saved.zoom)) setView({ x: saved.x, y: saved.y, zoom: clamp(saved.zoom, MIN_ZOOM, MAX_ZOOM) });
            else {
                // The canvas mounts with the 'ready' render; fit once it is there.
                const tryFit = (n = 0) => { if (wrapRef.current) fit(board.items); else if (n < 20) requestAnimationFrame(() => tryFit(n + 1)); };
                requestAnimationFrame(() => tryFit());
            }
        }
    }, [project.id, fit]);

    const load = useCallback(async () => {
        try {
            const row = await whiteboardService.load(project.id);
            applyRow(row, { keepView: false });
            setHistory(emptyHistory());
            setStatus('ready');
        } catch (e) {
            if (boardTableMissing(e)) { setStatus('missing'); return; }
            setLoadError(e.message || 'The board could not be loaded.');
            setStatus('error');
        }
    }, [project.id, applyRow]);
    useEffect(() => { setStatus('loading'); load(); }, [load]);

    const saveNow = useCallback(async ({ force = false } = {}) => {
        if (readOnly || savingRef.current || (!dirtyRef.current && !force)) return;
        savingRef.current = true;
        dirtyRef.current = false;
        setSave('saving');
        const sent = itemsRef.current;
        try {
            const row = await whiteboardService.save(orgId, project.id, { items: sent }, metaRef.current.version, { force });
            setMeta({ version: row.version, updatedAt: row.updated_at, updatedBy: row.updated_by });
            metaRef.current = { version: row.version, updatedAt: row.updated_at, updatedBy: row.updated_by };
            setConflict(null);
            setSave(dirtyRef.current ? 'dirty' : 'saved');
        } catch (e) {
            dirtyRef.current = true;
            if (e instanceof BoardConflict) { setConflict(e.latest); setSave('conflict'); } else { setSave('error'); toast(e.message || 'The board could not be saved.', 'error'); }
        } finally {
            savingRef.current = false;
        }
    }, [orgId, project.id, readOnly, toast]);

    // A moment after the last change, and again if more came in while saving.
    useEffect(() => {
        if (save !== 'dirty') return undefined;
        const id = setTimeout(() => saveNow(), SAVE_DELAY);
        return () => clearTimeout(id);
    }, [save, items, saveNow]);

    // Someone else's changes: picked up while this board has nothing unsaved.
    useEffect(() => {
        if (status !== 'ready') return undefined;
        const id = setInterval(async () => {
            if (document.hidden || dirtyRef.current || savingRef.current || dragRef.current) return;
            try {
                const head = await whiteboardService.head(project.id);
                if (head && head.version !== metaRef.current.version) {
                    const row = await whiteboardService.load(project.id);
                    if (!dirtyRef.current && !dragRef.current) applyRow(row);
                }
            } catch { /* try again next time */ }
        }, POLL_EVERY);
        return () => clearInterval(id);
    }, [status, project.id, applyRow]);

    // Leaving with changes not yet saved: save them, and ask first on a reload.
    useEffect(() => {
        const before = (e) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = ''; } };
        window.addEventListener('beforeunload', before);
        return () => { window.removeEventListener('beforeunload', before); if (dirtyRef.current) saveNow(); };
    }, [saveNow]);

    // ── Selection, tools, editing ────────────────────────────────────────────
    const [selected, setSelected] = useState(() => new Set());
    const [editingId, setEditingId] = useState(null);
    const [tool, setToolState] = useState('select');
    const [opts, setOpts] = useState({ sticky: 'yellow', shape: 'rect', ink: '#14293E', width: 3 });
    const [space, setSpace] = useState(false);
    const [draft, setDraft] = useState(null);             // a shape, arrow, pen stroke or marquee being drawn
    const [help, setHelp] = useState(false);
    const dragRef = useRef(null);
    // True while something is being dragged, so the selection bar steps aside (and comes back after).
    const [dragging, setDragging] = useState(false);
    const clipboard = useRef([]);
    const editBefore = useRef(null);

    const map = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
    const chosen = useMemo(() => items.filter((i) => selected.has(i.id)), [items, selected]);
    const setTool = (id) => { setToolState(id); setEditingId(null); if (id !== 'select') setSelected(new Set()); };

    const toWorld = (e) => {
        const r = svgRef.current.getBoundingClientRect();
        const v = viewRef.current;
        return { x: (e.clientX - r.left - v.x) / v.zoom, y: (e.clientY - r.top - v.y) / v.zoom };
    };

    const startEdit = (id) => {
        if (readOnly) return;
        editBefore.current = itemsRef.current;
        setSelected(new Set([id]));
        setEditingId(id);
    };
    // Typing changes the item in place; Undo takes the whole edit back at once.
    const typeText = (id, text) => preview(patchItems(itemsRef.current, [id], { text }));
    const typeHeight = (id, h) => {
        const it = itemsRef.current.find((x) => x.id === id);
        if (it && it.type === 'text' && Math.abs(it.h - h) > 0.5) preview(patchItems(itemsRef.current, [id], { h: Math.max(28, h) }));
    };
    const endEdit = () => {
        const id = editingId;
        setEditingId(null);
        const before = editBefore.current;
        editBefore.current = null;
        if (!id || !before) return;
        let now = itemsRef.current;
        const it = now.find((x) => x.id === id);
        // An empty text box is not kept. One just added and left empty goes
        // without a trace: its "add" is taken off the Undo list too.
        if (it && it.type === 'text' && !String(it.text || '').trim()) {
            now = deleteItems(now, [id]);
            if (!before.some((x) => x.id === id && String(x.text || '').trim())) {
                setHistory((h) => ({ ...h, past: h.past.slice(0, -1) }));
                preview(now);
                setSelected(new Set());
                return;
            }
        }
        if (JSON.stringify(before) !== JSON.stringify(now)) commit(now, before);
        else preview(now);
    };

    const add = (item, edit = false) => {
        commit([...itemsRef.current, item]);
        setSelected(new Set([item.id]));
        setToolState('select');
        if (edit) { editBefore.current = itemsRef.current; setEditingId(item.id); }
    };

    // ── Pointer ──────────────────────────────────────────────────────────────
    const onPointerDown = (e) => {
        if (status !== 'ready' || isTyping(e.target)) return;
        wrapRef.current?.focus({ preventScroll: true });
        if (editingId) endEdit();
        const p = toWorld(e);
        const v = viewRef.current;
        const panning = e.button === 1 || tool === 'hand' || space;
        if (panning) {
            dragRef.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, view: v };
        } else if (e.button !== 0) {
            return;
        } else {
            const handle = e.target.closest?.('[data-handle]')?.dataset.handle;
            const id = e.target.closest?.('[data-id]')?.dataset.id;
            const before = itemsRef.current;
            if (handle && chosen.length === 1 && !readOnly) {
                const it = chosen[0];
                dragRef.current = handle.startsWith('arrow-')
                    ? { mode: 'arrow-end', end: handle.slice(6), id: it.id, before }
                    : { mode: 'resize', handle, id: it.id, start: { x: it.x, y: it.y, w: it.w, h: it.h }, p, before };
            } else if (tool === 'select') {
                if (id) {
                    let next = selected;
                    if (e.shiftKey) {
                        next = new Set(selected);
                        if (next.has(id)) next.delete(id); else next.add(id);
                    } else if (!selected.has(id)) next = new Set([id]);
                    setSelected(next);
                    if (!readOnly && next.has(id)) dragRef.current = { mode: 'move', ids: next, p, before, moved: false };
                } else {
                    if (!e.shiftKey) setSelected(new Set());
                    dragRef.current = { mode: 'marquee', p, keep: e.shiftKey ? new Set(selected) : new Set() };
                    setDraft({ kind: 'marquee', x: p.x, y: p.y, w: 0, h: 0 });
                }
            } else if (readOnly) {
                return;
            } else if (tool === 'sticky' || tool === 'text') {
                // No default action: the browser would move focus off the new note's text.
                e.preventDefault();
                add(tool === 'sticky' ? makeSticky(p.x, p.y, opts.sticky) : makeText(p.x, p.y), true);
            } else if (tool === 'shape') {
                dragRef.current = { mode: 'shape', p };
                setDraft({ kind: 'shape', x: p.x, y: p.y, w: 0, h: 0 });
            } else if (tool === 'arrow') {
                const at = itemAt(itemsRef.current, p.x, p.y);
                dragRef.current = { mode: 'arrow', from: at ? { id: at.id } : { x: p.x, y: p.y }, p };
                setDraft({ kind: 'arrow', from: at ? { id: at.id } : { x: p.x, y: p.y }, to: { x: p.x, y: p.y } });
            } else if (tool === 'pen') {
                dragRef.current = { mode: 'pen', points: [[p.x, p.y]] };
                setDraft({ kind: 'pen', points: [[p.x, p.y]] });
            }
        }
        if (dragRef.current) {
            if (dragRef.current.mode !== 'move') setDragging(true);
            e.currentTarget.setPointerCapture?.(e.pointerId);
            e.preventDefault();
        }
    };

    const onPointerMove = (e) => {
        const d = dragRef.current;
        if (!d) return;
        if (d.mode === 'pan') {
            setView({ ...d.view, x: d.view.x + e.clientX - d.sx, y: d.view.y + e.clientY - d.sy });
            return;
        }
        const p = toWorld(e);
        if (d.mode === 'move') {
            const dx = p.x - d.p.x;
            const dy = p.y - d.p.y;
            if (!d.moved && Math.hypot(dx, dy) * viewRef.current.zoom < 3) return;
            if (!d.moved) setDragging(true);
            d.moved = true;
            preview(moveItems(d.before, d.ids, dx, dy));
        } else if (d.mode === 'resize') {
            const it = d.before.find((x) => x.id === d.id);
            const box = boxFromHandle(d.start, d.handle, p.x - d.p.x, p.y - d.p.y, { square: it.type === 'sticky', keep: e.shiftKey });
            preview(d.before.map((x) => (x.id === d.id ? resizeItem(x, box) : x)));
        } else if (d.mode === 'arrow-end') {
            const target = itemAt(d.before, p.x, p.y);
            const it = d.before.find((x) => x.id === d.id);
            const other = d.end === 'from' ? it.to : it.from;
            const end = target && target.id !== other?.id ? { id: target.id } : { x: p.x, y: p.y };
            preview(d.before.map((x) => (x.id === d.id ? { ...x, [d.end]: end } : x)));
        } else if (d.mode === 'marquee' || d.mode === 'shape') {
            const box = { x: Math.min(d.p.x, p.x), y: Math.min(d.p.y, p.y), w: Math.abs(p.x - d.p.x), h: Math.abs(p.y - d.p.y) };
            if (d.mode === 'shape' && e.shiftKey) { const s = Math.max(box.w, box.h); box.w = s; box.h = s; if (p.x < d.p.x) box.x = d.p.x - s; if (p.y < d.p.y) box.y = d.p.y - s; }
            setDraft({ kind: d.mode, ...box });
            if (d.mode === 'marquee') {
                const hit = itemsRef.current.filter((it) => intersects(box, boxOf(it, itemsRef.current))).map((it) => it.id);
                setSelected(new Set([...d.keep, ...hit]));
            }
        } else if (d.mode === 'arrow') {
            const target = itemAt(itemsRef.current, p.x, p.y);
            d.to = target && target.id !== d.from.id ? { id: target.id } : { x: p.x, y: p.y };
            setDraft({ kind: 'arrow', from: d.from, to: d.to, over: target?.id || null });
        } else if (d.mode === 'pen') {
            const last = d.points[d.points.length - 1];
            if (Math.hypot(p.x - last[0], p.y - last[1]) * viewRef.current.zoom < 2) return;
            d.points.push([p.x, p.y]);
            setDraft({ kind: 'pen', points: [...d.points] });
        }
    };

    const onPointerUp = (e) => {
        const d = dragRef.current;
        dragRef.current = null;
        setDraft(null);
        setDragging(false);
        if (!d) return;
        if (d.mode === 'move' || d.mode === 'resize' || d.mode === 'arrow-end') {
            if (itemsRef.current !== d.before && (d.mode !== 'move' || d.moved)) commit(itemsRef.current, d.before);
        } else if (d.mode === 'shape') {
            const p = toWorld(e);
            let box = { x: Math.min(d.p.x, p.x), y: Math.min(d.p.y, p.y), w: Math.abs(p.x - d.p.x), h: Math.abs(p.y - d.p.y) };
            // A click, not a drag: a shape of the usual size, centred there.
            if (box.w * viewRef.current.zoom < 8 && box.h * viewRef.current.zoom < 8) box = { x: d.p.x - 90, y: d.p.y - 55, w: 180, h: 110 };
            add(makeShape(box.x, box.y, box.w, box.h, opts.shape));
        } else if (d.mode === 'arrow') {
            const to = d.to || d.from;
            const map2 = new Map(itemsRef.current.map((i) => [i.id, i]));
            const pt = (end) => (end.id ? center(map2.get(end.id)) : end);
            const a = pt(d.from);
            const b = pt(to);
            if (Math.hypot(b.x - a.x, b.y - a.y) * viewRef.current.zoom < 10) return;
            add({ ...makeArrow(d.from, to), color: opts.ink });
        } else if (d.mode === 'pen') {
            if (d.points.length < 2) return;
            commit([...itemsRef.current, makePen(d.points, opts.ink, opts.width)]);
        }
    };

    const onDoubleClick = (e) => {
        if (readOnly || isTyping(e.target)) return;
        // With the pointer captured, the double-click lands on the canvas itself:
        // what is under the pointer is looked up from the point.
        const under = document.elementFromPoint(e.clientX, e.clientY);
        const id = under?.closest?.('[data-id]')?.dataset.id;
        const it = id ? itemsRef.current.find((x) => x.id === id) : null;
        if (it && ['sticky', 'text', 'shape'].includes(it.type)) { startEdit(it.id); return; }
        if (!it && tool === 'select') {
            const p = toWorld(e);
            add(makeSticky(p.x, p.y, opts.sticky), true);
        }
    };

    // Wheel: scroll pans, Ctrl or a pinch zooms at the pointer.
    useEffect(() => {
        const el = svgRef.current;
        if (!el) return undefined;
        const wheel = (e) => {
            e.preventDefault();
            const r = el.getBoundingClientRect();
            const v = viewRef.current;
            if (e.ctrlKey || e.metaKey) {
                setView(zoomAt(v, v.zoom * Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top));
            } else {
                setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
            }
        };
        el.addEventListener('wheel', wheel, { passive: false });
        return () => el.removeEventListener('wheel', wheel);
    }, [status]);

    const zoomBy = (k) => setView((v) => zoomAt(v, v.zoom * k, screen.w / 2, screen.h / 2));

    // ── Commands ─────────────────────────────────────────────────────────────
    const doUndo = () => { const r = undoStep(history, itemsRef.current); if (!r) return; setHistory(r.history); preview(r.items); dirtyRef.current = true; setSave('dirty'); setSelected(new Set()); };
    const doRedo = () => { const r = redoStep(history, itemsRef.current); if (!r) return; setHistory(r.history); preview(r.items); dirtyRef.current = true; setSave('dirty'); setSelected(new Set()); };
    const doDelete = () => { if (!selected.size) return; commit(deleteItems(itemsRef.current, selected)); setSelected(new Set()); };
    const doDuplicate = () => {
        if (!chosen.length) return;
        const copies = cloneItems(chosen, itemsRef.current);
        commit([...itemsRef.current, ...copies]);
        setSelected(new Set(copies.map((c) => c.id)));
    };
    const doPaste = () => {
        if (!clipboard.current.length) return;
        const copies = cloneItems(clipboard.current, [...itemsRef.current, ...clipboard.current], 32, 32);
        clipboard.current = copies;
        commit([...itemsRef.current, ...copies]);
        setSelected(new Set(copies.map((c) => c.id)));
    };
    const doPatch = (patch) => commit(patchItems(itemsRef.current, selected, patch));
    const doStack = (front) => commit(restack(itemsRef.current, selected, front));

    const onKeyDown = (e) => {
        if (isTyping(e.target) || editingId) return;
        const mod = e.ctrlKey || e.metaKey;
        const k = e.key.toLowerCase();
        if (k === ' ') { e.preventDefault(); setSpace(true); return; }
        if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
        if (mod && k === 'y') { e.preventDefault(); doRedo(); return; }
        if (mod && k === 'a') { e.preventDefault(); setSelected(new Set(itemsRef.current.map((i) => i.id))); return; }
        if (mod && k === '0') { e.preventDefault(); setView((v) => zoomAt(v, 1, screen.w / 2, screen.h / 2)); return; }
        if (e.shiftKey && (k === '!' || e.code === 'Digit1')) { e.preventDefault(); fit(); return; }
        if (k === '+' || k === '=') { zoomBy(1.2); return; }
        if (k === '-') { zoomBy(1 / 1.2); return; }
        if (k === 'escape') { setSelected(new Set()); setToolState('select'); setHelp(false); return; }
        if (k === '?') { setHelp((x) => !x); return; }
        if (readOnly) { if (k === 'v' || k === 'h') setTool(k === 'v' ? 'select' : 'hand'); return; }
        if (mod && k === 'd') { e.preventDefault(); doDuplicate(); return; }
        if (mod && k === 'c') { clipboard.current = chosen; return; }
        if (mod && k === 'x') { clipboard.current = chosen; doDelete(); return; }
        if (mod && k === 'v') { e.preventDefault(); doPaste(); return; }
        if (k === 'delete' || k === 'backspace') { e.preventDefault(); doDelete(); return; }
        if (k === 'enter' && chosen.length === 1 && ['sticky', 'text', 'shape'].includes(chosen[0].type)) { e.preventDefault(); startEdit(chosen[0].id); return; }
        if (k.startsWith('arrow') && selected.size) {
            e.preventDefault();
            const step = e.shiftKey ? 10 : 1;
            const dx = k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0;
            const dy = k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0;
            commit(moveItems(itemsRef.current, selected, dx, dy));
            return;
        }
        if (!mod) {
            const hit = TOOLS.find((x) => x.key.toLowerCase() === k);
            if (hit) setTool(hit.id);
        }
    };
    const onKeyUp = (e) => { if (e.key === ' ') setSpace(false); };

    // ── Export and full screen ───────────────────────────────────────────────
    const exportSvg = () => {
        const world = svgRef.current?.querySelector('[data-world]');
        if (!world || !itemsRef.current.length) { toast('Nothing on the board to export yet.', 'info'); return; }
        const clone = world.cloneNode(true);
        clone.removeAttribute('transform');
        clone.querySelectorAll('[data-overlay]').forEach((n) => n.remove());
        const defs = svgRef.current.querySelector('defs')?.outerHTML || '';
        const body = `<style>*{font-family:${BOARD_FONT}}</style><rect x="-100000" y="-100000" width="200000" height="200000" fill="${CANVAS_BG}"/>${defs}${clone.innerHTML}`;
        const file = boardSvg(itemsRef.current, body);
        const url = URL.createObjectURL(new Blob([file], { type: 'image/svg+xml' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(project.code || project.name || 'project').replace(/[^\w-]+/g, '-')}-whiteboard.svg`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    useEffect(() => {
        const on = () => setFull(document.fullscreenElement === wrapRef.current);
        document.addEventListener('fullscreenchange', on);
        return () => document.removeEventListener('fullscreenchange', on);
    }, []);
    const toggleFull = () => {
        if (document.fullscreenElement) document.exitFullscreen?.();
        else wrapRef.current?.requestFullscreen?.().catch(() => toast('Full screen is not available here.', 'info'));
    };

    // ── Rendering ────────────────────────────────────────────────────────────
    if (status === 'loading') return <Panel><Loading>Loading the whiteboard…</Loading></Panel>;
    if (status === 'missing') return <Panel><Empty>The whiteboard is not set up on this workspace yet. It needs database migration 0111.</Empty></Panel>;
    if (status === 'error') return <Panel><Empty action={<Btn onClick={() => { setStatus('loading'); load(); }}>Try Again</Btn>}>{loadError}</Empty></Panel>;

    const nameOf = (userId) => team.employees.find((x) => x.user_id && x.user_id === userId)?.name || '';
    const sel = boundsOf(chosen, map);
    const single = chosen.length === 1 && !editingId ? chosen[0] : null;
    const barPos = sel && !draft && !editingId && !dragging && !readOnly
        ? { x: clamp(view.x + (sel.x + sel.w / 2) * view.zoom, Math.min(340, screen.w / 2), Math.max(screen.w / 2, screen.w - 340)), y: Math.max(64, view.y + sel.y * view.zoom - 14) }
        : null;
    const gridGap = view.zoom < 0.35 ? 96 : view.zoom < 0.7 ? 48 : 24;
    const cursor = space || tool === 'hand' ? (dragging ? 'grabbing' : 'grab')
        : tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair';

    const saveLabel = readOnly ? 'View only'
        : save === 'saving' ? 'Saving…'
            : save === 'dirty' ? 'Unsaved changes'
                : save === 'error' ? 'Not saved. Retrying on your next change'
                    : save === 'conflict' ? 'Not saved'
                        : meta.updatedAt ? `Saved ${ago(meta.updatedAt)}${nameOf(meta.updatedBy) ? ` by ${nameOf(meta.updatedBy)}` : ''}` : 'Nothing saved yet';
    const SaveIcon = readOnly ? Lock : save === 'saving' ? LoaderCircle : save === 'error' || save === 'conflict' ? CloudOff : CloudCheck;

    return (
        <div ref={wrapRef} tabIndex={0} onKeyDown={onKeyDown} onKeyUp={onKeyUp} aria-label={`Whiteboard for ${project.name}`}
            className="wb-wrap"
            style={{
                position: 'relative', height: full ? '100vh' : 'calc(100vh - 210px)', minHeight: 540, overflow: 'hidden',
                border: full ? 0 : '1px solid ' + t.line, borderRadius: full ? 0 : 12, background: CANVAS_BG, outline: 'none',
                userSelect: editingId ? 'auto' : 'none', touchAction: 'none',
            }}>
            <svg ref={svgRef} width="100%" height="100%" style={{ display: 'block', cursor }}
                onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
                onDoubleClick={onDoubleClick}>
                <ArrowHeads />
                <defs>
                    <pattern id="wb-grid" width={gridGap} height={gridGap} patternUnits="userSpaceOnUse"
                        patternTransform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
                        <circle cx={gridGap / 2} cy={gridGap / 2} r={(1.15 / view.zoom) * (gridGap / 24) ** 0.5} fill={CANVAS_DOT} />
                    </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#wb-grid)" />
                <g data-world transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
                    {items.map((it) => (
                        <ItemView key={it.id} it={it} map={map} editing={editingId === it.id}
                            onText={(text) => typeText(it.id, text)} onHeight={(h) => typeHeight(it.id, h)} onDone={endEdit} />
                    ))}
                    {draft?.kind === 'shape' && (
                        <rect x={draft.x} y={draft.y} width={draft.w} height={draft.h} rx={opts.shape === 'round' ? 14 : opts.shape === 'ellipse' ? Math.min(draft.w, draft.h) / 2 : 2}
                            fill="rgba(37,158,149,.08)" stroke="#259E95" strokeWidth={1.5 / view.zoom} strokeDasharray={`${5 / view.zoom} ${4 / view.zoom}`} data-overlay />
                    )}
                    {draft?.kind === 'arrow' && (
                        <g data-overlay>
                            {draft.over && map.get(draft.over) && (() => { const o = map.get(draft.over); return <rect x={o.x - 4} y={o.y - 4} width={o.w + 8} height={o.h + 8} rx={4} fill="none" stroke="#259E95" strokeWidth={2 / view.zoom} />; })()}
                            <ItemView it={{ ...makeArrow(draft.from, draft.to), id: 'draft', color: opts.ink }} map={map} />
                        </g>
                    )}
                    {draft?.kind === 'pen' && (
                        <polyline data-overlay points={draft.points.map((p) => p.join(',')).join(' ')} fill="none" stroke={opts.ink}
                            strokeWidth={opts.width} strokeLinecap="round" strokeLinejoin="round" />
                    )}
                    {draft?.kind === 'marquee' && (
                        <rect data-overlay x={draft.x} y={draft.y} width={draft.w} height={draft.h} fill="rgba(37,158,149,.08)"
                            stroke="#259E95" strokeWidth={1 / view.zoom} />
                    )}
                    {chosen.length > 0 && <SelectionOverlay items={chosen} map={map} zoom={view.zoom} single={readOnly ? null : single} />}
                </g>
            </svg>

            {/* What is on the board, and where it saves. */}
            <Float label="Board" role="status" style={{ left: 12, top: 12, padding: '4px 10px 4px 8px', gap: 8 }}>
                <SaveIcon size={15} aria-hidden="true" color={save === 'error' || save === 'conflict' ? t.down : t.faint}
                    className={save === 'saving' ? 'wb-spin' : undefined} />
                <span style={{ fontSize: 12.5, color: save === 'error' || save === 'conflict' ? t.down : t.dim, whiteSpace: 'nowrap' }}>{saveLabel}</span>
                {items.length > 0 && <span style={{ fontSize: 12, color: t.faint, whiteSpace: 'nowrap' }}>· {items.length} item{items.length === 1 ? '' : 's'}</span>}
            </Float>

            <Float label="Board actions" style={{ right: 12, top: 12 }}>
                {!readOnly && <ToolBtn size={32} label="Undo" keyHint="Ctrl+Z" disabled={!history.past.length} onClick={doUndo}><Undo2 size={16} aria-hidden="true" /></ToolBtn>}
                {!readOnly && <ToolBtn size={32} label="Redo" keyHint="Ctrl+Shift+Z" disabled={!history.future.length} onClick={doRedo}><Redo2 size={16} aria-hidden="true" /></ToolBtn>}
                {!readOnly && <Divider />}
                <ToolBtn size={32} label="Export as SVG" onClick={exportSvg}><Download size={16} aria-hidden="true" /></ToolBtn>
                <ToolBtn size={32} label={full ? 'Leave full screen' : 'Full screen'} onClick={toggleFull}>
                    {full ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
                </ToolBtn>
                <ToolBtn size={32} label="Keyboard shortcuts" keyHint="?" active={help} onClick={() => setHelp((x) => !x)}><Keyboard size={16} aria-hidden="true" /></ToolBtn>
            </Float>

            {conflict && (
                <Float label="Save conflict" role="alert" style={{ left: '50%', top: 12, transform: 'translateX(-50%)', padding: '6px 6px 6px 12px', gap: 10 }}>
                    <span style={{ fontSize: 12.5, color: t.text }}>
                        {nameOf(conflict.updated_by) || 'Someone else'} saved this board while you were drawing.
                    </span>
                    <Btn size="sm" onClick={() => { applyRow(conflict); setConflict(null); setHistory(emptyHistory()); }}>Load Theirs</Btn>
                    <Btn size="sm" primary onClick={() => { setMeta((m) => ({ ...m, version: conflict.version })); metaRef.current = { ...metaRef.current, version: conflict.version }; saveNow({ force: true }); }}>Keep Mine</Btn>
                </Float>
            )}

            <ToolRail tool={tool} setTool={setTool} opts={opts} setOpts={setOpts} readOnly={readOnly} />

            {barPos && chosen.length > 0 && (
                <ContextBar chosen={chosen} pos={barPos} onPatch={doPatch} onFront={() => doStack(true)} onBack={() => doStack(false)}
                    onDuplicate={doDuplicate} onDelete={doDelete} />
            )}

            {mapOn && <Minimap items={items} map={map} view={view} screen={screen}
                onGo={(x, y) => setView((v) => ({ ...v, x: screen.w / 2 - x * v.zoom, y: screen.h / 2 - y * v.zoom }))} />}
            <ZoomBar zoom={view.zoom} onZoom={zoomBy} onReset={() => setView((v) => zoomAt(v, 1, screen.w / 2, screen.h / 2))}
                onFit={() => fit()} mapOn={mapOn} onMap={() => setMapOn((x) => !x)} />

            {items.length === 0 && !draft && (
                <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
                    <div style={{ textAlign: 'center', maxWidth: 360, color: '#5B6675' }}>
                        <div style={{ fontSize: 15, fontWeight: 600, color: '#14293E', marginBottom: 6 }}>
                            {readOnly ? 'Nothing on this board yet' : 'Start the board'}
                        </div>
                        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                            {readOnly
                                ? 'The project’s people can draw here. You can look around, but not change it.'
                                : 'Double-click anywhere for a sticky note, or pick a tool on the left: text, shapes, arrows and a pen. Scroll to move around, Ctrl + scroll to zoom.'}
                        </div>
                    </div>
                </div>
            )}

            {help && <ShortcutHelp onClose={() => setHelp(false)} />}
        </div>
    );
}

const SHORTCUTS = [
    ['V', 'Select'], ['H or hold Space', 'Move the board'], ['N', 'Sticky note'], ['T', 'Text'], ['S', 'Shape'],
    ['L', 'Arrow'], ['P', 'Pen'], ['Double-click', 'Add a sticky / edit text'], ['Enter', 'Edit the chosen item'],
    ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / Redo'], ['Ctrl+C / X / V', 'Copy / Cut / Paste'], ['Ctrl+D', 'Duplicate'],
    ['Ctrl+A', 'Select everything'], ['Delete', 'Delete'], ['Arrow keys', 'Nudge (Shift: 10)'],
    ['Ctrl+scroll, + / -', 'Zoom'], ['Ctrl+0', 'Zoom to 100%'], ['Shift+1', 'Fit everything'], ['Shift while sizing', 'Keep proportions'],
];

function ShortcutHelp({ onClose }) {
    const t = useT();
    return (
        <Float label="Keyboard shortcuts" role="dialog" style={{
            right: 12, top: 56, width: 300, maxHeight: 'calc(100% - 140px)', overflowY: 'auto',
            flexDirection: 'column', alignItems: 'stretch', padding: '10px 12px',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
                <strong style={{ flex: 1, fontSize: 13, fontWeight: 600, color: t.text }}>Keyboard Shortcuts</strong>
                <Btn size="sm" onClick={onClose}>Close</Btn>
            </div>
            {SHORTCUTS.map(([k, what]) => (
                <div key={k} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '4px 0', borderTop: '1px solid ' + t.lineSoft, fontSize: 12.5 }}>
                    <span style={{ flex: 1, color: t.dim }}>{what}</span>
                    <kbd style={{ fontFamily: 'inherit', fontSize: 11.5, color: t.text, background: t.panelAlt, border: '1px solid ' + t.line, borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap' }}>{k}</kbd>
                </div>
            ))}
        </Float>
    );
}
