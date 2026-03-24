import { useState, useRef, useEffect, useCallback } from 'react';
import {
  RotateCcw, RotateCw, FlipHorizontal, FlipVertical,
  Crop, X, Check, RotateCcw as ResetIcon, Save
} from 'lucide-react';

const PRESETS = [
  { key: 'none', label: 'None', filter: '' },
  { key: 'grayscale', label: 'Grayscale', filter: 'grayscale(100%)' },
  { key: 'sepia', label: 'Sepia', filter: 'sepia(100%)' },
  { key: 'invert', label: 'Invert', filter: 'invert(100%)' },
];

const INITIAL_STATE = {
  rotation: 0,
  flipH: false,
  flipV: false,
  brightness: 100,
  contrast: 100,
  preset: 'none',
  cropActive: false,
  cropRect: null,    // { x, y, w, h } in image-space coords
  cropApplied: false,
};

export default function ImageEditor({ imageSrc, onSave, onCancel }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const imgRef = useRef(null);
  const [state, setState] = useState(INITIAL_STATE);
  const [imgLoaded, setImgLoaded] = useState(false);
  // Original image before any crop — kept for Reset All
  const [originalSrc, setOriginalSrc] = useState(imageSrc);
  // Current working source (updated after crop apply)
  const [workingSrc, setWorkingSrc] = useState(imageSrc);

  // Crop drag state (not part of render state)
  const dragRef = useRef(null);

  // Load image whenever workingSrc changes
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setImgLoaded(true);
    };
    img.src = workingSrc;
  }, [workingSrc]);

  // ─── Render pipeline ────────────────────────────────────
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;

    const { rotation, flipH, flipV, brightness, contrast, preset } = state;
    const isRotated = rotation === 90 || rotation === 270;
    const drawW = isRotated ? img.height : img.width;
    const drawH = isRotated ? img.width : img.height;

    // Fit canvas into wrapper
    const wrap = wrapRef.current;
    if (!wrap) return;
    const maxW = wrap.clientWidth - 16;
    const maxH = wrap.clientHeight - 16;
    const scale = Math.min(1, maxW / drawW, maxH / drawH);
    const cw = Math.round(drawW * scale);
    const ch = Math.round(drawH * scale);

    canvas.width = cw;
    canvas.height = ch;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);
    ctx.save();

    // Build filter string
    let filterStr = `brightness(${brightness}%) contrast(${contrast}%)`;
    const presetObj = PRESETS.find(p => p.key === preset);
    if (presetObj && presetObj.filter) filterStr += ` ${presetObj.filter}`;
    ctx.filter = filterStr;

    // Move origin to center for rotation/flip
    ctx.translate(cw / 2, ch / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);

    // Draw image centered at origin (pre-rotation dimensions)
    const sw = img.width * scale;
    const sh = img.height * scale;
    ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
    ctx.restore();

    // Draw crop overlay if active
    if (state.cropActive && state.cropRect) {
      const { x, y, w, h } = state.cropRect;
      // Darken outside crop
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      // Top
      ctx.fillRect(0, 0, cw, y);
      // Bottom
      ctx.fillRect(0, y + h, cw, ch - y - h);
      // Left
      ctx.fillRect(0, y, x, h);
      // Right
      ctx.fillRect(x + w, y, cw - x - w, h);

      // Crop border
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);

      // Corner handles
      const hs = 8;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      const corners = [
        [x - hs / 2, y - hs / 2],
        [x + w - hs / 2, y - hs / 2],
        [x - hs / 2, y + h - hs / 2],
        [x + w - hs / 2, y + h - hs / 2],
      ];
      corners.forEach(([cx, cy]) => {
        ctx.fillRect(cx, cy, hs, hs);
        ctx.strokeRect(cx, cy, hs, hs);
      });
    }
  }, [state, imgLoaded]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  // Re-render on window resize
  useEffect(() => {
    const onResize = () => renderCanvas();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [renderCanvas]);

  // ─── Actions ────────────────────────────────────────────
  const rotateLeft = () => setState(s => ({ ...s, rotation: (s.rotation + 270) % 360 }));
  const rotateRight = () => setState(s => ({ ...s, rotation: (s.rotation + 90) % 360 }));
  const flipH = () => setState(s => ({ ...s, flipH: !s.flipH }));
  const flipV = () => setState(s => ({ ...s, flipV: !s.flipV }));

  const toggleCrop = () => {
    setState(s => {
      if (s.cropActive) {
        return { ...s, cropActive: false, cropRect: null };
      }
      const canvas = canvasRef.current;
      if (!canvas) return s;
      // Default crop rect: centered 80% of canvas
      const margin = 0.1;
      return {
        ...s,
        cropActive: true,
        cropRect: {
          x: Math.round(canvas.width * margin),
          y: Math.round(canvas.height * margin),
          w: Math.round(canvas.width * (1 - 2 * margin)),
          h: Math.round(canvas.height * (1 - 2 * margin)),
        },
      };
    });
  };

  const applyCrop = () => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !state.cropRect) return;

    const { cropRect, rotation, flipH: fH, flipV: fV, brightness, contrast, preset } = state;

    // Compute display scale (same as renderCanvas) to map crop rect to full-res
    const isRotated = rotation === 90 || rotation === 270;
    const drawW = isRotated ? img.height : img.width;
    const drawH = isRotated ? img.width : img.height;
    const wrap = wrapRef.current;
    const maxW = wrap.clientWidth - 16;
    const maxH = wrap.clientHeight - 16;
    const displayScale = Math.min(1, maxW / drawW, maxH / drawH);

    // Render at full resolution with all transforms baked in
    const fullW = Math.round(drawW);
    const fullH = Math.round(drawH);
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = fullW;
    tempCanvas.height = fullH;
    const tctx = tempCanvas.getContext('2d');

    let filterStr = `brightness(${brightness}%) contrast(${contrast}%)`;
    const presetObj = PRESETS.find(p => p.key === preset);
    if (presetObj && presetObj.filter) filterStr += ` ${presetObj.filter}`;
    tctx.filter = filterStr;

    tctx.translate(fullW / 2, fullH / 2);
    tctx.rotate((rotation * Math.PI) / 180);
    tctx.scale(fH ? -1 : 1, fV ? -1 : 1);
    tctx.drawImage(img, -img.width / 2, -img.height / 2);

    // Map the display-space crop rect to full-res coordinates
    const ratio = 1 / displayScale;
    const sx = Math.round(cropRect.x * ratio);
    const sy = Math.round(cropRect.y * ratio);
    const sw = Math.round(cropRect.w * ratio);
    const sh = Math.round(cropRect.h * ratio);

    // Extract crop region at full resolution
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = sw;
    cropCanvas.height = sh;
    cropCanvas.getContext('2d').drawImage(tempCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

    const croppedDataUrl = cropCanvas.toDataURL('image/png');
    // All transforms are baked in — fully reset state
    setWorkingSrc(croppedDataUrl);
    setState(INITIAL_STATE);
    setImgLoaded(false);
  };

  const resetAll = () => {
    setState(INITIAL_STATE);
    setWorkingSrc(originalSrc);
    setImgLoaded(false);
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;

    // Final render at full image resolution (no crop overlay)
    const { rotation, flipH: fH, flipV: fV, brightness, contrast, preset } = state;
    const isRotated = rotation === 90 || rotation === 270;
    const outW = isRotated ? img.height : img.width;
    const outH = isRotated ? img.width : img.height;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outW;
    outCanvas.height = outH;
    const ctx = outCanvas.getContext('2d');

    let filterStr = `brightness(${brightness}%) contrast(${contrast}%)`;
    const presetObj = PRESETS.find(p => p.key === preset);
    if (presetObj && presetObj.filter) filterStr += ` ${presetObj.filter}`;
    ctx.filter = filterStr;

    ctx.translate(outW / 2, outH / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(fH ? -1 : 1, fV ? -1 : 1);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);

    onSave(outCanvas.toDataURL('image/png'));
  };

  // ─── Crop mouse/touch interaction ──────────────────────
  const getCanvasPos = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const hitTest = (pos) => {
    if (!state.cropRect) return null;
    const { x, y, w, h } = state.cropRect;
    const threshold = 14;

    // Check corners first
    const corners = [
      { name: 'tl', cx: x, cy: y },
      { name: 'tr', cx: x + w, cy: y },
      { name: 'bl', cx: x, cy: y + h },
      { name: 'br', cx: x + w, cy: y + h },
    ];
    for (const c of corners) {
      if (Math.abs(pos.x - c.cx) < threshold && Math.abs(pos.y - c.cy) < threshold) {
        return c.name;
      }
    }
    // Check inside rect
    if (pos.x >= x && pos.x <= x + w && pos.y >= y && pos.y <= y + h) {
      return 'move';
    }
    return null;
  };

  const onPointerDown = (e) => {
    if (!state.cropActive || !state.cropRect) return;
    const pos = getCanvasPos(e);
    const hit = hitTest(pos);
    if (!hit) return;
    e.preventDefault();
    dragRef.current = {
      type: hit,
      startPos: pos,
      startRect: { ...state.cropRect },
    };
  };

  const onPointerMove = (e) => {
    if (!dragRef.current || !canvasRef.current) return;
    e.preventDefault();
    const pos = getCanvasPos(e);
    const { type, startPos, startRect } = dragRef.current;
    const dx = pos.x - startPos.x;
    const dy = pos.y - startPos.y;
    const cw = canvasRef.current.width;
    const ch = canvasRef.current.height;

    let newRect = { ...startRect };
    const MIN_SIZE = 20;

    if (type === 'move') {
      newRect.x = Math.max(0, Math.min(cw - newRect.w, startRect.x + dx));
      newRect.y = Math.max(0, Math.min(ch - newRect.h, startRect.y + dy));
    } else {
      // Corner resize
      if (type === 'tl' || type === 'bl') {
        const newX = Math.max(0, Math.min(startRect.x + startRect.w - MIN_SIZE, startRect.x + dx));
        newRect.w = startRect.w + (startRect.x - newX);
        newRect.x = newX;
      }
      if (type === 'tr' || type === 'br') {
        newRect.w = Math.max(MIN_SIZE, Math.min(cw - startRect.x, startRect.w + dx));
      }
      if (type === 'tl' || type === 'tr') {
        const newY = Math.max(0, Math.min(startRect.y + startRect.h - MIN_SIZE, startRect.y + dy));
        newRect.h = startRect.h + (startRect.y - newY);
        newRect.y = newY;
      }
      if (type === 'bl' || type === 'br') {
        newRect.h = Math.max(MIN_SIZE, Math.min(ch - startRect.y, startRect.h + dy));
      }
    }

    setState(s => ({ ...s, cropRect: newRect }));
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  useEffect(() => {
    if (!state.cropActive) return;
    const handleMove = (e) => onPointerMove(e);
    const handleUp = () => onPointerUp();
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleUp);
    };
  }, [state.cropActive]);

  return (
    <div className="img-editor-overlay" onClick={onCancel}>
      <div className="img-editor-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="img-editor-header">
          <h3>Edit image</h3>
          <button type="button" onClick={onCancel} style={{
            background: 'none', border: 'none', color: 'var(--text-tertiary)',
            cursor: 'pointer', padding: '0.25rem', display: 'flex'
          }}>
            <X size={18} />
          </button>
        </div>

        {/* Canvas */}
        <div className="img-editor-canvas-wrap" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            onMouseDown={onPointerDown}
            onTouchStart={onPointerDown}
            style={{ cursor: state.cropActive ? 'crosshair' : 'default' }}
          />
        </div>

        {/* Toolbar */}
        <div className="img-editor-toolbar">
          <button type="button" onClick={toggleCrop} className={state.cropActive ? 'active' : ''}>
            <Crop size={14} /> Crop
          </button>
          {state.cropActive && (
            <>
              <button type="button" onClick={applyCrop} className="active">
                <Check size={14} /> Apply Crop
              </button>
              <button type="button" onClick={toggleCrop}>
                <X size={14} /> Cancel Crop
              </button>
            </>
          )}
          {!state.cropActive && (
            <>
              <div className="toolbar-divider" />
              <button type="button" onClick={rotateLeft}><RotateCcw size={14} /> Left</button>
              <button type="button" onClick={rotateRight}><RotateCw size={14} /> Right</button>
              <div className="toolbar-divider" />
              <button type="button" onClick={flipH}><FlipHorizontal size={14} /> Flip H</button>
              <button type="button" onClick={flipV}><FlipVertical size={14} /> Flip V</button>
            </>
          )}
        </div>

        {/* Sliders */}
        {!state.cropActive && (
          <div className="img-editor-sliders">
            <div className="img-editor-slider-group">
              <label>Bright</label>
              <input
                type="range" min="0" max="200" value={state.brightness}
                onChange={e => setState(s => ({ ...s, brightness: +e.target.value }))}
              />
              <span className="slider-value">{state.brightness}</span>
            </div>
            <div className="img-editor-slider-group">
              <label>Contrast</label>
              <input
                type="range" min="0" max="200" value={state.contrast}
                onChange={e => setState(s => ({ ...s, contrast: +e.target.value }))}
              />
              <span className="slider-value">{state.contrast}</span>
            </div>
          </div>
        )}

        {/* Presets */}
        {!state.cropActive && (
          <div className="img-editor-presets">
            {PRESETS.map(p => (
              <button
                type="button"
                key={p.key}
                className={state.preset === p.key ? 'active' : ''}
                onClick={() => setState(s => ({ ...s, preset: p.key }))}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="img-editor-actions">
          <button type="button" className="btn-reset" onClick={resetAll}>
            <RotateCcw size={14} /> Reset
          </button>
          <button type="button" className="btn-cancel" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn-save" onClick={handleSave}>
            <Save size={14} /> Save
          </button>
        </div>
      </div>
    </div>
  );
}
