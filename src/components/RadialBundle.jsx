import { useEffect, useRef, useState } from 'preact/hooks';
import { hierarchy, cluster } from 'd3-hierarchy';
import { lineRadial, curveBundle } from 'd3-shape';
import { select } from 'd3-selection';
import { zoom, zoomIdentity } from 'd3-zoom';
import { colorForRg } from '../lib/color.js';

const SIZE = 1000;             // viewBox units (square)
const RADIUS = SIZE / 2 - 130; // leave room for labels
const BASE_FONT = 5.5;         // label font at base zoom
const LABEL_PAD = 1.25;        // multiplier on font height for collision spacing

// Label colors (hex — CSS custom properties don't resolve inside SVG attributes).
const C_MUTED = '#63666a';
const C_TEXT = '#09395f';
const C_DIM = '#d3d3da';
const C_ACCENT = '#006db6';

// Hierarchical edge bundling of the strongest genetic correlations, laid out on a
// radial dendrogram derived from average-linkage clustering of the rg matrix.
// Scroll/pinch to zoom, drag to pan, click a trait to pin its connections.
// The rg slider tightens which correlations are drawn; labels are revealed
// adaptively so they never overlap (more appear as you zoom in).
export function RadialBundle({ data, onSelect }) {
  const svgRef = useRef(null);
  const tipRef = useRef(null);
  const zoomApi = useRef(null);
  const rebuildRef = useRef(null);   // re-filter links when the threshold changes
  const thresholdRef = useRef(0.5);
  const [pinned, setPinned] = useState(null); // {name, dataIndex, count}
  const [rgThreshold, setRgThreshold] = useState(0.5);

  useEffect(() => {
    const svg = select(svgRef.current);
    svg.selectAll('*').remove();

    const root = hierarchy(data.hierarchy.tree);
    cluster().size([2 * Math.PI, RADIUS])(root);

    const leaves = root.leaves();
    const leafByIndex = new Map();
    leaves.forEach((leaf) => {
      leaf.dataIndex = data.idToIndex.get(leaf.data.id);
      leaf.incident = [];
      leafByIndex.set(leaf.dataIndex, leaf);
    });

    const line = lineRadial()
      .curve(curveBundle.beta(0.85))
      .radius((d) => d.y)
      .angle((d) => d.x);

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
      .attr('transform', (d) => {
        const angle = (d.x * 180) / Math.PI - 90;
        const flip = d.x >= Math.PI;
        return `rotate(${angle}) translate(${d.y + 6},0)${flip ? ' rotate(180)' : ''}`;
      })
      .attr('text-anchor', (d) => (d.x >= Math.PI ? 'end' : 'start'))
      .attr('font-size', BASE_FONT)
      .attr('fill', C_MUTED)
      .style('cursor', 'pointer')
      .text((d) => d.data.name)
      .on('mouseover', (_, d) => scheduleHighlight(d, true))
      .on('mouseout', () => scheduleHighlight(pinnedLeaf, false))
      .on('click', (event, d) => {
        event.stopPropagation();
        pinnedLeaf = pinnedLeaf === d ? null : d;
        applyHighlight(pinnedLeaf, false);
        setPinned(
          pinnedLeaf
            ? { name: d.data.name, dataIndex: d.dataIndex, count: d.incident.length }
            : null
        );
      });

    const tip = select(tipRef.current);
    let pinnedLeaf = null;
    let renderedLeaf = undefined; // last leaf whose highlight is on screen
    let rafId = 0;
    let pending = null;
    let curK = 1;                 // current zoom scale
    let visible = new Set();      // leaves whose labels are shown at base state

    // Reveal as many non-overlapping labels as fit at the current zoom. Higher
    // angular density is allowed as you zoom in; more-connected traits win ties.
    function updateLabelVisibility() {
      const minGap = (BASE_FONT * LABEL_PAD) / (RADIUS * curK); // radians between labels
      const order = [...leaves].sort((a, b) => b.incident.length - a.incident.length);
      const accepted = []; // angles, kept sorted
      const show = new Set();
      for (const leaf of order) {
        const a = leaf.x;
        // nearest accepted angle (linear scan is fine at this size)
        let ok = true;
        for (let i = 0; i < accepted.length; i++) {
          if (Math.abs(accepted[i] - a) < minGap) {
            ok = false;
            break;
          }
        }
        if (ok) {
          accepted.push(a);
          show.add(leaf);
        }
      }
      visible = show;
      if (!renderedLeaf) labelSel.attr('display', (d) => (show.has(d) ? null : 'none'));
    }

    // Coalesce the mouseover storm: only repaint once per frame, and skip if the
    // hovered leaf hasn't actually changed.
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
        labelSel
          .attr('fill', C_MUTED)
          .attr('font-weight', 400)
          .attr('font-size', BASE_FONT)
          .attr('display', (d) => (visible.has(d) ? null : 'none'));
        tip.classed('show', false);
        return;
      }
      const active = new Set(leaf.incident);
      const activeLeaves = new Set([leaf]);
      leaf.incident.forEach((l) => activeLeaves.add(l.source === leaf ? l.target : l.source));

      linkSel
        .attr('stroke-opacity', (d) => (active.has(d) ? 0.95 : 0.03))
        .attr('stroke-width', (d) => (active.has(d) ? 2 : 1));

      labelSel
        .attr('fill', (d) => (d === leaf ? C_ACCENT : activeLeaves.has(d) ? C_TEXT : C_DIM))
        .attr('font-weight', (d) => (activeLeaves.has(d) ? 700 : 400))
        .attr('font-size', (d) => (d === leaf ? 8.5 : activeLeaves.has(d) ? 6.5 : BASE_FONT))
        // Always show the focused trait and its neighbors, even if normally hidden.
        .attr('display', (d) => (activeLeaves.has(d) || visible.has(d) ? null : 'none'));

      if (showTip) {
        tip
          .classed('show', true)
          .html(
            `<strong>${leaf.data.name}</strong><br>` +
              `<span class="mono">${leaf.incident.length} strong correlation${
                leaf.incident.length === 1 ? '' : 's'
              }</span>`
          );
      } else {
        tip.classed('show', false);
      }
    }

    // (Re)build the drawn links from the current rg threshold without disturbing
    // the zoom/pan transform.
    function rebuild() {
      const th = thresholdRef.current;
      leaves.forEach((l) => (l.incident = []));
      const links = [];
      for (const [a, b, rg] of data.hierarchy.edges) {
        if (Math.abs(rg) < th) continue;
        const sa = leafByIndex.get(a);
        const sb = leafByIndex.get(b);
        if (!sa || !sb) continue;
        const link = { source: sa, target: sb, rg, path: sa.path(sb) };
        links.push(link);
        sa.incident.push(link);
        sb.incident.push(link);
      }
      linkSel = linkLayer
        .selectAll('path')
        .data(links)
        .join('path')
        .attr('class', 'rb-link')
        .attr('d', (d) => line(d.path))
        .attr('stroke', (d) => colorForRg(d.rg))
        .attr('stroke-width', 1)
        .attr('stroke-opacity', 0.38);

      renderedLeaf = undefined; // force highlight + visibility to repaint
      updateLabelVisibility();
      if (pinnedLeaf) {
        setPinned({
          name: pinnedLeaf.data.name,
          dataIndex: pinnedLeaf.dataIndex,
          count: pinnedLeaf.incident.length,
        });
      }
      applyHighlight(pinnedLeaf, false);
    }
    rebuildRef.current = rebuild;
    rebuild();

    // Click empty space clears the pin.
    svg.on('click', () => {
      pinnedLeaf = null;
      applyHighlight(null, false);
      setPinned(null);
    });

    svg.on('mousemove', (event) => {
      tip.style('left', `${event.clientX + 14}px`).style('top', `${event.clientY + 14}px`);
    });

    // Zoom + pan (wheel, drag, touch pinch). Revealing more labels as we zoom in.
    const zoomBehavior = zoom()
      .scaleExtent([0.6, 12])
      .on('zoom', (e) => {
        zoomLayer.attr('transform', e.transform);
        if (Math.abs(e.transform.k - curK) > 1e-3) {
          curK = e.transform.k;
          if (!renderedLeaf) updateLabelVisibility();
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

  // Re-filter the drawn links when the threshold slider moves (keeps zoom/pan).
  useEffect(() => {
    thresholdRef.current = rgThreshold;
    if (rebuildRef.current) rebuildRef.current();
  }, [rgThreshold]);

  return (
    <div>
      <p class="view-intro">
        Each thread links two phenotypes with a strong genetic correlation
        (<strong>|rg| ≥ {rgThreshold.toFixed(2)}</strong>), bundled along a tree built by
        clustering the full correlation matrix.{' '}
        <strong style="color: var(--rg-pos)">Coral</strong> = positive,{' '}
        <strong style="color: var(--rg-neg)">cornflower blue</strong> = negative. Hover a label to trace its
        connections; click it to pin and explore.
      </p>
      <div class="viz-wrap card" style="padding: 0.5rem;">
        <div class="viz-controls">
          <button title="Zoom in" onClick={() => zoomApi.current?.in()}>＋</button>
          <button title="Zoom out" onClick={() => zoomApi.current?.out()}>－</button>
          <button title="Reset view" onClick={() => zoomApi.current?.reset()}>⟲</button>
        </div>
        <div class="rb-threshold">
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
