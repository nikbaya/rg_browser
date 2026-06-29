import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { colorForRg, colorForCategory } from '../lib/color.js';

const LABEL_CELL_PX = 13;   // show axis labels once cells are at least this big
const MARGIN = 150;         // px reserved for labels when zoomed in
const RIBBON = 10;          // px category color strip along each axis
const MIN_ZOOM_CELLS = 3;   // a drag smaller than this counts as a click
const MAX_CELL = 48;        // cap cell size so small subsets aren't over-zoomed
const MIN_LABEL_FONT = 6;   // smallest label font when fitting a dense category

// Clustered correlation heatmap on a canvas. Drag a box to zoom into a submatrix,
// double-click (or Reset) to zoom back out. Phenotype labels appear once zoomed in.
// Clicking a category in the legend subsets the matrix to that category.
export function Heatmap({ data, onSelect }) {
  const { n, rg, phenotypes } = data;
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const wrapRef = useRef(null);
  const tipRef = useRef(null);
  const selRef = useRef(null);
  const geom = useRef({ cell: 1, m: 0, o: RIBBON }); // last-drawn geometry for hit-testing
  const drag = useRef(null);

  // Optional category subset (multi-select). `order` is the list of phenotype
  // positions in scope (clustered order); null means the full matrix. `at` maps
  // an active position to its matrix index; `L` is the active count.
  const [cats, setCats] = useState([]); // selected category names ([] = all)
  const catsKey = cats.join('|');
  const order = useMemo(() => {
    if (cats.length === 0) return null;
    const set = new Set(cats);
    const idx = [];
    for (let k = 0; k < n; k++) if (set.has(phenotypes[k].cat)) idx.push(k);
    return idx;
  }, [catsKey, n, phenotypes]);
  const L = order ? order.length : n;
  const at = (k) => (order ? order[k] : k);
  const toggleCat = (name) =>
    setCats((prev) => (prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name]));

  const [view, setView] = useState({ i0: 0, i1: n, j0: 0, j1: n });

  // Reset to the full active range whenever the category subset changes.
  useEffect(() => {
    setView({ i0: 0, i1: L, j0: 0, j1: L });
  }, [catsKey, L]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let raf = 0;

    function draw() {
      const { i0, i1, j0, j1 } = view;
      const rows = i1 - i0;
      const cols = j1 - j0;
      const cssW = wrapRef.current.clientWidth - 2;
      const inCategory = order != null;
      let cell;
      let showLabels;
      let font = 11;
      if (inCategory) {
        // Category subset: fit the whole block within the view (both axes,
        // reserving the label gutter), capped so small categories aren't huge.
        // Always label — scaling the font down for dense categories so the
        // labels still fit at small cell sizes.
        const availH = Math.max(160, Math.floor(window.innerHeight * 0.78) - 16);
        showLabels = true;
        cell = Math.max(3, Math.min(
          Math.floor((cssW - MARGIN - RIBBON) / cols),
          Math.floor((availH - MARGIN - RIBBON) / rows),
          MAX_CELL,
        ));
        font = Math.min(11, Math.max(MIN_LABEL_FONT, cell - 1));
      } else {
        // Full matrix / drag-zoom: size cells to the width; labels once big enough.
        cell = Math.max(1, Math.floor(cssW / cols));
        showLabels = cell >= LABEL_CELL_PX;
      }
      const m = showLabels ? MARGIN : 0;   // label text area: [0, m)
      const o = m + RIBBON;                // matrix origin; ribbon occupies [m, o)
      geom.current = { cell, m, o };

      const dpr = window.devicePixelRatio || 1;
      const cssWidth = o + cols * cell;
      const cssHeight = o + rows * cell;
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssWidth, cssHeight);

      // Heatmap pixels via an offscreen 1px-per-cell image, scaled up nearest-neighbour.
      const img = ctx.createImageData(cols, rows);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const v = rg[at(i0 + r) * n + at(j0 + c)];
          const [cr, cg, cb] = hexToRgb(colorForRg(v));
          const oo = (r * cols + c) * 4;
          img.data[oo] = cr;
          img.data[oo + 1] = cg;
          img.data[oo + 2] = cb;
          img.data[oo + 3] = 255;
        }
      }
      const tmp = document.createElement('canvas');
      tmp.width = cols;
      tmp.height = rows;
      tmp.getContext('2d').putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tmp, 0, 0, cols, rows, o, o, cols * cell, rows * cell);

      // Category color ribbons along the top (columns) and left (rows). Drawn at
      // every zoom level so category structure is visible even when zoomed out.
      for (let c = 0; c < cols; c++) {
        ctx.fillStyle = colorForCategory(phenotypes[at(j0 + c)].cat);
        ctx.fillRect(o + c * cell, m, cell, RIBBON);
      }
      for (let r = 0; r < rows; r++) {
        ctx.fillStyle = colorForCategory(phenotypes[at(i0 + r)].cat);
        ctx.fillRect(m, o + r * cell, RIBBON, cell);
      }

      if (showLabels) {
        ctx.fillStyle = '#3e3e40';
        ctx.font = `${font}px "Open Sans", sans-serif`;
        const maxChars = Math.max(4, Math.floor(MARGIN / (font * 0.6)));
        // Column labels along the top (rotated), ending just above the ribbon.
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        for (let c = 0; c < cols; c++) {
          ctx.save();
          ctx.translate(o + c * cell + cell / 2, m - 4);
          ctx.rotate(-Math.PI / 2);
          ctx.fillText(trunc(phenotypes[at(j0 + c)].description, maxChars), 0, 0);
          ctx.restore();
        }
        // Row labels down the left, ending just left of the ribbon.
        ctx.textAlign = 'right';
        for (let r = 0; r < rows; r++) {
          ctx.fillText(trunc(phenotypes[at(i0 + r)].description, maxChars), m - 4, o + r * cell + cell / 2);
        }
      }
    }

    function schedule() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    }

    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(wrapRef.current);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [data, view, order]);

  // Map a pointer event to a cell within the current view.
  function cellAt(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const { cell, o } = geom.current;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const c = Math.floor((x - o) / cell);
    const r = Math.floor((y - o) / cell);
    const cols = view.j1 - view.j0;
    const rows = view.i1 - view.i0;
    if (c < 0 || r < 0 || c >= cols || r >= rows) return null;
    return { r, c, x, y, i: at(view.i0 + r), j: at(view.j0 + c) };
  }

  // Detect a hover over a category ribbon; returns the phenotype index, or null.
  function ribbonAt(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const { cell, m, o } = geom.current;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const cols = view.j1 - view.j0;
    const rows = view.i1 - view.i0;
    if (y >= m && y < o && x >= o) {
      const c = Math.floor((x - o) / cell);
      if (c >= 0 && c < cols) return at(view.j0 + c);
    }
    if (x >= m && x < o && y >= o) {
      const r = Math.floor((y - o) / cell);
      if (r >= 0 && r < rows) return at(view.i0 + r);
    }
    return null;
  }

  function onMove(e) {
    const tip = tipRef.current;
    const hit = cellAt(e);

    if (drag.current && selRef.current) {
      // Update the selection rectangle.
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const x0 = Math.min(drag.current.x, x);
      const y0 = Math.min(drag.current.y, y);
      const sel = selRef.current;
      sel.style.display = 'block';
      sel.style.left = `${x0}px`;
      sel.style.top = `${y0}px`;
      sel.style.width = `${Math.abs(x - drag.current.x)}px`;
      sel.style.height = `${Math.abs(y - drag.current.y)}px`;
    }

    if (!hit) {
      // Maybe the pointer is over a category ribbon — show the category name.
      const ri = drag.current ? null : ribbonAt(e);
      if (ri != null) {
        const p = phenotypes[ri];
        tip.classList.add('show');
        tip.style.left = `${e.clientX + 14}px`;
        tip.style.top = `${e.clientY + 14}px`;
        tip.innerHTML =
          `<strong>${p.description}</strong><br><span class="mono">${p.cat}</span>`;
        return;
      }
      tip.classList.remove('show');
      return;
    }
    const v = rg[hit.i * n + hit.j];
    tip.classList.add('show');
    tip.style.left = `${e.clientX + 14}px`;
    tip.style.top = `${e.clientY + 14}px`;
    tip.innerHTML =
      `<strong>${phenotypes[hit.i].description}</strong><br>` +
      `<strong>${phenotypes[hit.j].description}</strong><br>` +
      `<span class="mono">rg = ${Number.isNaN(v) ? '—' : v.toPrecision(3)}</span>`;
  }

  function onDown(e) {
    const hit = cellAt(e);
    const rect = canvasRef.current.getBoundingClientRect();
    drag.current = hit
      ? { x: e.clientX - rect.left, y: e.clientY - rect.top, startCell: hit }
      : null;
  }

  function onUp(e) {
    const sel = selRef.current;
    if (sel) sel.style.display = 'none';
    const start = drag.current;
    drag.current = null;
    if (!start) return;

    const hit = cellAt(e);
    const endCell = hit || start.startCell;
    const r0 = Math.min(start.startCell.r, endCell.r);
    const r1 = Math.max(start.startCell.r, endCell.r) + 1;
    const c0 = Math.min(start.startCell.c, endCell.c);
    const c1 = Math.max(start.startCell.c, endCell.c) + 1;

    if (r1 - r0 >= MIN_ZOOM_CELLS && c1 - c0 >= MIN_ZOOM_CELLS) {
      setView((v) => ({
        i0: v.i0 + r0,
        i1: v.i0 + r1,
        j0: v.j0 + c0,
        j1: v.j0 + c1,
      }));
    } else if (onSelect) {
      onSelect(start.startCell.i); // treat a non-drag as a click
    }
  }

  const isZoomed = view.i0 !== 0 || view.i1 !== L || view.j0 !== 0 || view.j1 !== L;
  const canReset = isZoomed || cats.length > 0;
  // Reset clears both the zoom and any category subset.
  const reset = () => {
    if (cats.length > 0) setCats([]); // view resets via the category effect
    else setView({ i0: 0, i1: n, j0: 0, j1: n });
  };
  const catLabel = cats.length === 1 ? cats[0] : `${cats.length} categories`;

  return (
    <div>
      <p class="view-intro">
        The full <strong>{n} × {n}</strong> matrix of genetic correlations, clustered so related
        traits sit together. <strong style="color: var(--rg-pos)">Red</strong> blocks
        along the diagonal are groups of mutually correlated phenotypes.{' '}
        <strong>Drag a box to zoom in</strong>; labels appear once cells are large enough.{' '}
        <strong>Click one or more categories</strong> below to focus the matrix on just those
        categories (click a selected one to remove it, or Reset to show all).
      </p>

      <div class="cat-legend">
        <span class="cat-legend-title">Filter by category:</span>
        {data.categories.map((name) => {
          const on = cats.includes(name);
          return (
            <button
              type="button"
              class={`cat-legend-item${on ? ' active' : ''}`}
              key={name}
              aria-pressed={on}
              title={on ? `Remove ${name}` : `Add ${name}`}
              onClick={() => toggleCat(name)}
            >
              <span class="cat-swatch" style={`background:${colorForCategory(name)}`} />
              {name}
            </button>
          );
        })}
      </div>

      <div class="hm-bar">
        <span class="hm-crumb mono">
          {cats.length > 0 ? `${catLabel}: ${L} × ${L}` : `full ${n} × ${n} matrix`}
          {isZoomed && ` · rows ${view.i0 + 1}–${view.i1} × cols ${view.j0 + 1}–${view.j1}`}
        </span>
        <button class="btn-reset" disabled={!canReset} onClick={reset}>
          ⟲ {cats.length > 0 ? 'Reset' : 'Reset zoom'}
        </button>
      </div>

      <div ref={wrapRef} class="viz-wrap card" style="padding: 0; overflow-x: auto; overflow-y: scroll; max-height: 78vh;">
        <div ref={stageRef} class="hm-stage" style="position: relative; width: fit-content;">
          <canvas
            ref={canvasRef}
            style="display:block; image-rendering: pixelated; cursor: crosshair;"
            onMouseMove={onMove}
            onMouseDown={onDown}
            onMouseUp={onUp}
            onMouseLeave={() => {
              tipRef.current.classList.remove('show');
              if (selRef.current) selRef.current.style.display = 'none';
              drag.current = null;
            }}
          />
          <div ref={selRef} class="hm-sel" />
        </div>
      </div>
      <div class="legend">
        <span>−1</span>
        <span class="bar" />
        <span>+1</span>
        <span style="margin-left:0.5rem">genetic correlation (rg)</span>
      </div>
      <div ref={tipRef} class="viz-tooltip" />
    </div>
  );
}

function trunc(s, max) {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function hexToRgb(hex) {
  if (hex[0] === '#') {
    const v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  const m = hex.match(/\d+/g);
  return m ? [+m[0], +m[1], +m[2]] : [228, 228, 234];
}
