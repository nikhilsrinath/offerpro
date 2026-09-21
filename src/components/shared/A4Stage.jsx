import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Minus, Plus, MoveHorizontal, Square } from 'lucide-react';

/*
 * A4Stage — the right-hand paper pane of every document editor.
 *
 * The preview roots (.a4-sheet, .certificate-preview-root, .inv-saffron-page)
 * are rendered at their true pixel size so the PDF capture stays sharp; this
 * component scales what is rendered down to the pane instead, so a whole page
 * is on screen at once rather than a page-and-a-bit you have to drag around.
 *
 * Two fits, both recomputed whenever the pane or the document changes size:
 *
 * · Width (the default) fills the pane horizontally, so the document is at a
 *   readable size and scrolls vertically like any other document viewer.
 * · Page frames one whole page at once, for checking the layout and where the
 *   page breaks fall.
 *
 * Zooming by hand pins the scale until a fit is chosen again.
 */

const A4_RATIO = 1.41421356; /* √2 — an A4 page's long side over its short side */
const PAD_X = 18;            /* .a4-stage-scroll padding — keep in sync with the CSS */
const PAD_Y = 16;
const STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2];
const MIN = STEPS[0];
const MAX = STEPS[STEPS.length - 1];

export default function A4Stage({ children, className = '' }) {
  const scrollRef = useRef(null);
  const sheetRef = useRef(null);
  const [paper, setPaper] = useState({ w: 0, h: 0 });
  const [avail, setAvail] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(null);      /* a number pins the scale */
  const [mode, setMode] = useState('width');   /* which fit to follow otherwise */

  /* Measure the pane and the rendered document, and keep measuring. */
  useLayoutEffect(() => {
    const scrollEl = scrollRef.current;
    const sheetEl = sheetRef.current;
    if (!scrollEl || !sheetEl) return undefined;

    const readPane = () => setAvail((prev) => {
      const w = Math.max(0, scrollEl.clientWidth - PAD_X * 2);
      const h = Math.max(0, scrollEl.clientHeight - PAD_Y * 2);
      return prev.w === w && prev.h === h ? prev : { w, h };
    });
    const readPaper = () => setPaper((prev) => {
      const w = Math.round(sheetEl.scrollWidth);
      const h = Math.round(sheetEl.scrollHeight);
      return prev.w === w && prev.h === h ? prev : { w, h };
    });

    const paneObs = new ResizeObserver(readPane);
    const paperObs = new ResizeObserver(readPaper);
    paneObs.observe(scrollEl);
    paperObs.observe(sheetEl);
    readPane();
    readPaper();

    return () => { paneObs.disconnect(); paperObs.disconnect(); };
  }, []);

  /* The height of ONE page: a landscape sheet is already one page, a portrait
     one is as tall as its own width times √2 however long the document runs. */
  const pageH = paper.w && paper.h
    ? (paper.w >= paper.h ? paper.h : Math.min(paper.h, paper.w * A4_RATIO))
    : 0;

  const fitWidth = paper.w && avail.w ? Math.min(avail.w / paper.w, 1) : 1;
  const fitPage = paper.w && pageH && avail.w && avail.h
    ? Math.min(avail.w / paper.w, avail.h / pageH, 1)
    : 1;

  const fit = mode === 'page' ? fitPage : fitWidth;
  const scale = Math.min(MAX, Math.max(MIN, zoom ?? fit));

  const step = useCallback((dir) => {
    setZoom((current) => {
      const from = current ?? fit;
      const next = dir > 0
        ? STEPS.find((s) => s > from + 0.001)
        : [...STEPS].reverse().find((s) => s < from - 0.001);
      return next ?? Math.min(MAX, Math.max(MIN, from));
    });
  }, [fit]);

  /* Ctrl/⌘ + scroll zooms the paper, the way every other document viewer does. */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      step(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [step]);

  const pages = pageH ? Math.max(1, Math.round(paper.h / pageH)) : 1;

  return (
    <div className={`a4-stage ${className}`.trim()}>
      <div className="a4-stage-scroll" ref={scrollRef}>
        <div
          className="a4-stage-frame"
          style={paper.w ? { width: paper.w * scale, height: paper.h * scale } : undefined}
        >
          <div
            className="a4-stage-sheet"
            ref={sheetRef}
            style={{ transform: `scale(${scale})` }}
          >
            {children}
          </div>
        </div>
      </div>

      <div className="a4-stage-zoom" role="group" aria-label="Preview zoom">
        <button type="button" onClick={() => step(-1)} disabled={scale <= MIN + 0.001} aria-label="Zoom out">
          <Minus size={13} />
        </button>
        <span className="a4-stage-zoom-value" aria-live="polite">{Math.round(scale * 100)}%</span>
        <button type="button" onClick={() => step(1)} disabled={scale >= MAX - 0.001} aria-label="Zoom in">
          <Plus size={13} />
        </button>

        <span className="a4-stage-sep" aria-hidden="true" />

        <button
          type="button"
          className={`a4-stage-fit ${zoom === null && mode === 'width' ? 'active' : ''}`}
          onClick={() => { setMode('width'); setZoom(null); }}
          aria-pressed={zoom === null && mode === 'width'}
          title="Fit the page width to the pane"
        >
          <MoveHorizontal size={12} /> Width
        </button>
        <button
          type="button"
          className={`a4-stage-fit ${zoom === null && mode === 'page' ? 'active' : ''}`}
          onClick={() => { setMode('page'); setZoom(null); }}
          aria-pressed={zoom === null && mode === 'page'}
          title="Fit one whole page to the pane"
        >
          <Square size={11} /> Page
        </button>

        {pages > 1 && <span className="a4-stage-pages">{pages} pages</span>}
      </div>
    </div>
  );
}
