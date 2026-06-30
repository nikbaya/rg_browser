import { useEffect, useRef, useState } from 'preact/hooks';
import { hierarchy, cluster } from 'd3-hierarchy';
import { select, pointer } from 'd3-selection';
import 'd3-transition'; // augments selection.transition() (used for the label spread + zoom buttons)
import { zoom, zoomIdentity } from 'd3-zoom';
import { colorForRg, textOnRg } from '../lib/color.js';

const SIZE = 1000;             // viewBox units (square)
const RADIUS = SIZE / 2 - 130; // leave room for labels
const BASE_FONT = 5.5;         // label font at base zoom
const LABEL_PAD = 1.25;        // multiplier on font height for collision spacing
// How much labels grow with zoom: 0 = constant on-screen size (look tiny when zoomed
// in), 1 = grow fully with the graph (no extra labels revealed). In between, labels
// grow sub-linearly and more of them fit as you zoom in.
const LABEL_GROWTH = 0.6;
// Hover/click only activate in this radial band (fractions of RADIUS) around the rim,
// where the trait dots and labels are — not over the arcs in the interior.
const HOVER_INNER = 0.85;
const HOVER_OUTER = 1.6;
// |z| beyond which the source p-value underflowed to 0 (nlogp stored as NaN). Those
// are the *most* significant pairs, so treat them as passing any significance cut.
const Z_UNDERFLOW = 37;
// Max of the −log₁₀(p) significance slider (p ≤ 1e−120 already keeps very few edges).
const MAX_NLOGP = 120;

// Label colors (hex — CSS custom properties don't resolve inside SVG attributes).
const C_MUTED = '#63666a';
const C_TEXT = '#09395f';
const C_DIM = '#d3d3da';
const C_ACCENT = '#006db6';

// Radial arc diagram of the strongest genetic correlations. Traits are placed around
// the rim in the leaf order of an average-linkage clustering of the rg matrix (so
// similar traits sit together), and each correlation is drawn as a quadratic arc that
// bows toward the center in proportion to the angular gap between its two traits. Only
// traits with a surviving correlation are placed, and they re-space to fill the circle
// as the filters tighten. Scroll/pinch to zoom, drag to pan, click a trait to pin.
export function RadialBundle({ data, onSelect }) {
  const svgRef = useRef(null);
  const tipRef = useRef(null);
  const zoomApi = useRef(null);
  const rebuildRef = useRef(null);   // re-filter + re-layout when a slider changes
  const thresholdRef = useRef(0.5);  // min |rg|
  const nlogpRef = useRef(0);        // min −log₁₀(p)
  const [pinned, setPinned] = useState(null); // {name, dataIndex, count, top}
  const [rgThreshold, setRgThreshold] = useState(0.5);
  const [pThreshold, setPThreshold] = useState(0); // min −log₁₀(p); 0 = no p filter

  useEffect(() => {
    const svg = select(svgRef.current);
    svg.selectAll('*').remove();

    const root = hierarchy(data.hierarchy.tree);
    cluster().size([2 * Math.PI, RADIUS])(root);

    const n = data.n;
    const leaves = root.leaves(); // clustered order, preserved when we re-space
    const leafByIndex = new Map();
    leaves.forEach((leaf, i) => {
      leaf.dataIndex = data.idToIndex.get(leaf.data.id);
      leaf.incident = [];
      leaf.order = i;     // clustered position, used to re-space the connected subset
      leaf._a = leaf.x;   // display angle; nudged off leaf.x when labels are spread
      leafByIndex.set(leaf.dataIndex, leaf);
    });

    // Edge significance as −log₁₀(p); underflowed (p≈0) pairs return Infinity so they
    // pass any cut. A pair with no usable p returns −Infinity (excluded once filtering).
    function edgeNlogp(a, b) {
      const idx = a * n + b;
      const nl = data.nlogp[idx];
      if (!Number.isNaN(nl)) return nl;
      const s = data.se[idx];
      const z = s ? data.rg[idx] / s : NaN;
      return Number.isFinite(z) && Math.abs(z) >= Z_UNDERFLOW ? Infinity : -Infinity;
    }

    // Each edge is a single quadratic arc bowing toward the center; the dip grows with
    // the angular gap so neighbors hug the rim and distant pairs sweep inward. A
    // quadratic can't self-intersect, so there are no bundling loops.
    const DIP = 0.72;
    const pointAt = (angle, radius) => [radius * Math.sin(angle), -radius * Math.cos(angle)];
    function arcPath(d) {
      const a0 = d.source.x;
      const a1 = d.target.x;
      let dA = a1 - a0; // shortest signed angular gap, in (−π, π]
      while (dA > Math.PI) dA -= 2 * Math.PI;
      while (dA < -Math.PI) dA += 2 * Math.PI;
      const innerR = RADIUS * (1 - DIP * (Math.abs(dA) / Math.PI));
      const [x0, y0] = pointAt(a0, RADIUS);
      const [x1, y1] = pointAt(a1, RADIUS);
      const [cx, cy] = pointAt(a0 + dA / 2, innerR);
      return `M${x0},${y0}Q${cx},${cy} ${x1},${y1}`;
    }

    // svg > zoomLayer (gets zoom transform) > centered group
    const zoomLayer = svg.append('g');
    const g = zoomLayer.append('g').attr('transform', `translate(${SIZE / 2},${SIZE / 2})`);

    const linkLayer = g.append('g').attr('class', 'rb-links').attr('fill', 'none');
    let linkSel = linkLayer.selectAll('path'); // (re)populated by rebuild()

    const labelSel = g
      .append('g')
      .selectAll('text')
      .data(leaves)
      .join('text')
      .attr('dy', '0.31em')
      .attr('font-size', BASE_FONT)
      .attr('fill', C_MUTED)
      // White halo (drawn behind the glyphs) keeps active labels legible where they
      // crowd; off at rest, turned on per-label in applyHighlight.
      .attr('paint-order', 'stroke')
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 0)
      .attr('stroke-linejoin', 'round')
      .style('cursor', 'pointer')
      .style('pointer-events', 'none') // hover/click are picked by angle on the svg
      .text((d) => d.data.name);

    const tip = select(tipRef.current);
    let pinnedLeaf = null;
    let renderedLeaf = undefined; // last leaf whose highlight is on screen
    let rafId = 0;
    let pending = null;
    let curK = 1;                 // current zoom scale
    let placed = [];              // connected leaves currently on the circle
    let visible = new Set();      // leaves whose labels are shown at base state
    let hlActive = null;          // leaves emphasized during a highlight (focus + neighbors)
    let spreadSet = new Set();    // leaves currently nudged off their true angle

    // Labels live inside the zoom transform, so they scale with k. Partially
    // counter-scale by k^(1−growth): on-screen size still grows with zoom (so they
    // don't look tiny) but sub-linearly, leaving room for more labels and keeping the
    // collision math (which divides minGap by the same factor) honest.
    const labelScale = () => Math.pow(curK, 1 - LABEL_GROWTH);
    const fpx = (screenPx) => screenPx / labelScale();
    const minGapFor = (fontPx) => (fontPx * LABEL_PAD) / (RADIUS * labelScale());

    // A trait's strongest correlations: each incident edge's far end + its rg, sorted
    // by |rg| descending, top n. Shared by the hover/pin lists.
    function topNeighbors(leaf, count) {
      return leaf.incident
        .map((l) => ({ leaf: l.source === leaf ? l.target : l.source, rg: l.rg }))
        .sort((a, b) => Math.abs(b.rg) - Math.abs(a.rg))
        .slice(0, count);
    }

    // Reveal as many non-overlapping labels as fit at the current zoom (over the placed
    // subset only); more-connected traits win ties. Only updates the set — callers paint.
    function updateLabelVisibility() {
      const minGap = minGapFor(BASE_FONT);
      const order = placed.slice().sort((a, b) => b.incident.length - a.incident.length);
      const accepted = [];
      visible = new Set();
      for (const leaf of order) {
        const a = leaf.x;
        if (accepted.every((x) => Math.abs(x - a) >= minGap)) {
          accepted.push(a);
          visible.add(leaf);
        }
      }
    }

    const resetAngles = () => leaves.forEach((d) => (d._a = d.x));

    // Light one-pass relaxation: nudge a cluster of active labels apart along the rim
    // until each clears its neighbor by minGap. Settles in a few iterations and only
    // touches the handful of highlighted labels — no running simulation. The `pinned`
    // leaf (under the cursor) is held fixed so the label you point at never slides away.
    function spreadActive(activeArr, pinned) {
      const gap = minGapFor(6.5);
      const arr = activeArr.slice().sort((a, b) => a.x - b.x);
      for (let iter = 0; iter < 60; iter++) {
        let moved = false;
        for (let i = 0; i < arr.length - 1; i++) {
          const lo = arr[i];
          const hi = arr[i + 1];
          const overlap = gap - (hi._a - lo._a);
          if (overlap > 1e-6) {
            if (lo === pinned) hi._a += overlap;
            else if (hi === pinned) lo._a -= overlap;
            else {
              lo._a -= overlap / 2;
              hi._a += overlap / 2;
            }
            moved = true;
          }
        }
        if (!moved) break;
      }
    }

    function labelTransform(d) {
      const angle = (d._a * 180) / Math.PI - 90;
      // Flip/anchor stay on the true angle so orientation never flips mid-spread.
      const flip = d.x >= Math.PI;
      return `rotate(${angle}) translate(${RADIUS + 6},0)${flip ? ' rotate(180)' : ''}`;
    }

    // Paint every label's color/weight/size/halo/visibility from the current state and
    // move highlighted labels to their spread positions. `animate` transitions the
    // spread so it reads as a soft explode-and-settle.
    function paintLabels(animate) {
      if (!hlActive) {
        const movers = labelSel.filter((d) => spreadSet.has(d));
        resetAngles();
        spreadSet = new Set();
        labelSel
          .attr('fill', C_MUTED)
          .attr('font-weight', 400)
          .attr('font-size', fpx(BASE_FONT))
          .attr('stroke-width', 0)
          .attr('display', (d) => (visible.has(d) ? null : 'none'));
        (animate ? movers.transition().duration(200) : movers).attr('transform', labelTransform);
        labelSel.order(); // restore data order after any raise()
        return;
      }

      const leaf = renderedLeaf;
      resetAngles();
      const activeArr = [...hlActive];
      spreadActive(activeArr, leaf);
      const movers = new Set([...spreadSet, ...activeArr]); // old + new displaced labels
      spreadSet = new Set(activeArr.filter((d) => d._a !== d.x));

      // Show all active labels (spread apart) plus resting labels clear of the cluster.
      const gap = minGapFor(BASE_FONT);
      const shown = new Set(hlActive);
      for (const d of visible) {
        if (hlActive.has(d)) continue;
        if (activeArr.every((a) => Math.abs(a._a - d.x) >= gap)) shown.add(d);
      }

      labelSel
        .attr('fill', (d) => (d === leaf ? C_ACCENT : hlActive.has(d) ? C_TEXT : C_DIM))
        .attr('font-weight', (d) => (hlActive.has(d) ? 700 : 400))
        .attr('font-size', (d) => fpx(d === leaf ? 8.5 : hlActive.has(d) ? 6.5 : BASE_FONT))
        // Halo only on active labels; width tracks font size for a clean outline.
        .attr('stroke-width', (d) => (hlActive.has(d) ? fpx(d === leaf ? 2.4 : 1.8) : 0))
        .attr('display', (d) => (shown.has(d) ? null : 'none'));

      const mv = labelSel.filter((d) => movers.has(d));
      (animate ? mv.transition().duration(200) : mv).attr('transform', labelTransform);
      // Paint active labels last so their halos sit above neighboring text.
      labelSel.filter((d) => hlActive.has(d)).raise();
    }

    // The placed leaf whose angle is closest to a pointer angle — picking by angle
    // means you never have to land on the thin label glyphs, just point near the rim.
    function nearestLeaf(ang) {
      let best = null;
      let bestD = Infinity;
      for (const l of placed) {
        let d = Math.abs(l.x - ang);
        if (d > Math.PI) d = 2 * Math.PI - d;
        if (d < bestD) {
          bestD = d;
          best = l;
        }
      }
      return best;
    }

    // Map a pointer event to the leaf it points at. Only the rim band (where the trait
    // dots + labels live) is active — pointing at the interior (over the arcs) or far
    // outside returns null, so hovering inside the circle doesn't trip the tooltip.
    function leafAtPointer(event) {
      const [px, py] = pointer(event, g.node());
      const r = Math.hypot(px, py);
      if (r < RADIUS * HOVER_INNER || r > RADIUS * HOVER_OUTER) return null;
      const ang = (Math.atan2(px, -py) + 2 * Math.PI) % (2 * Math.PI);
      return nearestLeaf(ang);
    }

    function pinPayload(leaf) {
      return {
        name: leaf.data.name,
        dataIndex: leaf.dataIndex,
        count: leaf.incident.length,
        top: topNeighbors(leaf, 8).map((t) => ({ name: t.leaf.data.name, rg: t.rg })),
      };
    }

    // Coalesce the mousemove storm: only repaint once per frame, and skip if the
    // pointed-at leaf hasn't actually changed.
    function scheduleHighlight(leaf, showTip) {
      pending = { leaf, showTip };
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        applyHighlight(pending.leaf, pending.showTip);
      });
    }

    function applyHighlight(leaf, showTip) {
      if (leaf === renderedLeaf) {
        tip.classed('show', !!(leaf && showTip));
        return;
      }
      renderedLeaf = leaf;

      if (!leaf) {
        linkSel.attr('stroke-opacity', 0.38).attr('stroke-width', 1);
        hlActive = null;
        paintLabels(true);
        tip.classed('show', false);
        return;
      }

      const active = new Set(leaf.incident);
      const neighbors = topNeighbors(leaf, leaf.incident.length); // all, strongest first
      hlActive = new Set([leaf, ...neighbors.map((nb) => nb.leaf)]);

      linkSel
        .attr('stroke-opacity', (d) => (active.has(d) ? 0.95 : 0.03))
        .attr('stroke-width', (d) => (active.has(d) ? 2 : 1));

      paintLabels(true);

      if (showTip) {
        const top3 = topNeighbors(leaf, 3)
          .map((t) => `${t.leaf.data.name} (${t.rg >= 0 ? '+' : '−'}${Math.abs(t.rg).toFixed(2)})`)
          .join('<br>');
        tip
          .classed('show', true)
          .html(
            `<strong>${leaf.data.name}</strong><br>` +
              `<span class="mono">${leaf.incident.length} strong correlation${
                leaf.incident.length === 1 ? '' : 's'
              }</span>` +
              (top3 ? `<div class="tip-corrs mono">${top3}</div>` : '')
          );
      } else {
        tip.classed('show', false);
      }
    }

    // (Re)build links from the current filters, then re-space the still-connected
    // traits around the circle so they fill it (more room → more readable as you
    // tighten). Keeps the zoom/pan transform.
    function rebuild() {
      const th = thresholdRef.current;
      const minNl = nlogpRef.current;
      leaves.forEach((l) => (l.incident = []));
      const links = [];
      for (const [a, b, rg] of data.hierarchy.edges) {
        if (Math.abs(rg) < th) continue;
        if (minNl > 0 && edgeNlogp(a, b) < minNl) continue;
        const sa = leafByIndex.get(a);
        const sb = leafByIndex.get(b);
        if (!sa || !sb) continue;
        const link = { source: sa, target: sb, rg };
        links.push(link);
        sa.incident.push(link);
        sb.incident.push(link);
      }

      // Re-space the connected subset (in clustered order) evenly around the circle.
      placed = leaves.filter((l) => l.incident.length > 0).sort((a, b) => a.order - b.order);
      const K = placed.length;
      placed.forEach((l, k) => {
        l.x = K ? (2 * Math.PI * k) / K : 0;
        l._a = l.x;
      });

      linkSel = linkLayer
        .selectAll('path')
        .data(links)
        .join('path')
        .attr('class', 'rb-link')
        .attr('d', arcPath)
        .attr('stroke', (d) => colorForRg(d.rg))
        .attr('stroke-width', 1)
        .attr('stroke-opacity', 0.38);

      // Reposition labels for the new layout (anchor/flip depend on the new angle).
      labelSel
        .attr('transform', labelTransform)
        .attr('text-anchor', (d) => (d.x >= Math.PI ? 'end' : 'start'));

      renderedLeaf = undefined; // force highlight + visibility to repaint
      updateLabelVisibility();
      // Drop the pin if its trait filtered out; otherwise refresh its (possibly
      // smaller) correlation list.
      if (pinnedLeaf && pinnedLeaf.incident.length === 0) {
        pinnedLeaf = null;
        setPinned(null);
      } else if (pinnedLeaf) {
        setPinned(pinPayload(pinnedLeaf));
      }
      applyHighlight(pinnedLeaf, false);
    }
    rebuildRef.current = rebuild;
    rebuild();

    // Hover/click are picked by angle (nearest trait to where you point near the rim),
    // so you never have to hit the thin label text. Click toggles a pin on that trait;
    // clicking the empty center clears it.
    svg.on('mousemove', (event) => {
      const leaf = leafAtPointer(event);
      scheduleHighlight(leaf || pinnedLeaf, !!leaf);
      tip.style('left', `${event.clientX + 14}px`).style('top', `${event.clientY + 14}px`);
    });

    svg.on('mouseleave', () => scheduleHighlight(pinnedLeaf, false));

    svg.on('click', (event) => {
      const leaf = leafAtPointer(event);
      pinnedLeaf = leaf && pinnedLeaf !== leaf ? leaf : null;
      applyHighlight(pinnedLeaf, false);
      setPinned(pinnedLeaf ? pinPayload(pinnedLeaf) : null);
    });

    // Zoom + pan (wheel, drag, touch pinch). More labels reveal as we zoom in.
    const zoomBehavior = zoom()
      .scaleExtent([0.6, 12])
      .on('zoom', (e) => {
        zoomLayer.attr('transform', e.transform);
        if (Math.abs(e.transform.k - curK) > 1e-3) {
          curK = e.transform.k;
          updateLabelVisibility(); // more labels fit as you zoom in
          paintLabels(false);      // hold a (sub-linearly growing) on-screen font size
        }
      });
    svg.call(zoomBehavior).on('dblclick.zoom', null);
    zoomApi.current = {
      in: () => svg.transition().duration(250).call(zoomBehavior.scaleBy, 1.5),
      out: () => svg.transition().duration(250).call(zoomBehavior.scaleBy, 1 / 1.5),
      reset: () => svg.transition().duration(350).call(zoomBehavior.transform, zoomIdentity),
    };

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      rebuildRef.current = null;
    };
  }, [data]);

  // Re-filter + re-layout when either slider moves (keeps zoom/pan).
  useEffect(() => {
    thresholdRef.current = rgThreshold;
    nlogpRef.current = pThreshold;
    if (rebuildRef.current) rebuildRef.current();
  }, [rgThreshold, pThreshold]);

  return (
    <div>
      <p class="view-intro">
        Each arc links two phenotypes with a strong genetic correlation
        (<strong>|rg| ≥ {rgThreshold.toFixed(2)}</strong>
        {pThreshold > 0 && <strong> · p ≤ 1e−{pThreshold}</strong>}); traits are arranged around the
        rim by clustering the full matrix, and only those with a surviving correlation are shown —
        tighten the filters and the rest re-space to fill the circle.{' '}
        <strong style="color: var(--rg-pos)">Red</strong> = positive,{' '}
        <strong style="color: var(--rg-neg)">blue</strong> = negative. Hover near a trait to trace
        its connections; click to pin and explore.
      </p>
      <div class="viz-wrap card" style="padding: 0.5rem;">
        <div class="viz-controls">
          <button title="Zoom in" onClick={() => zoomApi.current?.in()}>＋</button>
          <button title="Zoom out" onClick={() => zoomApi.current?.out()}>－</button>
          <button title="Reset view" onClick={() => zoomApi.current?.reset()}>⟲</button>
        </div>
        <div class="rb-threshold">
          <div class="rb-row">
            <label for="rb-rg">min <span class="lc">|rg|</span></label>
            <input
              id="rb-rg"
              type="range"
              min="0.5"
              max="1"
              step="0.01"
              value={rgThreshold}
              onInput={(e) => setRgThreshold(parseFloat(e.currentTarget.value))}
            />
            <span class="mono rb-threshold-val">{rgThreshold.toFixed(2)}</span>
          </div>
          <div class="rb-row">
            <label for="rb-p">max <span class="lc">p</span></label>
            <input
              id="rb-p"
              type="range"
              min="0"
              max={MAX_NLOGP}
              step="1"
              value={pThreshold}
              onInput={(e) => setPThreshold(parseInt(e.currentTarget.value, 10))}
            />
            <span class="mono rb-threshold-val">{pThreshold === 0 ? 'any' : `1e−${pThreshold}`}</span>
          </div>
        </div>
        <span class="viz-hint">Scroll / pinch to zoom · drag to pan · click a trait to pin</span>
        <svg
          ref={svgRef}
          class="viz-svg"
          style="touch-action: none;"
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          preserveAspectRatio="xMidYMid meet"
        />
        {pinned && (
          <div class="pin-card">
            <div class="pin-name">{pinned.name}</div>
            <div class="mono pin-meta">
              {pinned.count} strong correlation{pinned.count === 1 ? '' : 's'}
            </div>
            {pinned.top && pinned.top.length > 0 && (
              <ul class="pin-corrs">
                {pinned.top.map((t) => (
                  <li>
                    <span class="pin-corr-name" title={t.name}>
                      {t.name}
                    </span>
                    <span
                      class="pin-corr-rg mono"
                      style={`background:${colorForRg(t.rg)};color:${textOnRg(t.rg)}`}
                    >
                      {t.rg >= 0 ? '+' : '−'}
                      {Math.abs(t.rg).toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <button class="pin-explore" onClick={() => onSelect && onSelect(pinned.dataIndex)}>
              Explore this phenotype →
            </button>
          </div>
        )}
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
