import { useEffect, useRef, useState } from 'preact/hooks';
import { hierarchy, cluster } from 'd3-hierarchy';
import { lineRadial, curveBundle } from 'd3-shape';
import { select } from 'd3-selection';
import { zoom, zoomIdentity } from 'd3-zoom';
import { colorForRg } from '../lib/color.js';

const SIZE = 1000;             // viewBox units (square)
const RADIUS = SIZE / 2 - 130; // leave room for labels

// Label colors (hex — CSS custom properties don't resolve inside SVG attributes).
const C_MUTED = '#63666a';
const C_TEXT = '#09395f';
const C_DIM = '#d3d3da';
const C_ACCENT = '#006db6';

// Hierarchical edge bundling of the strongest genetic correlations, laid out on a
// radial dendrogram derived from average-linkage clustering of the rg matrix.
// Scroll/pinch to zoom, drag to pan, click a trait to pin its connections.
export function RadialBundle({ data, onSelect }) {
  const svgRef = useRef(null);
  const tipRef = useRef(null);
  const zoomApi = useRef(null);
  const [pinned, setPinned] = useState(null); // {name, dataIndex, count}

  useEffect(() => {
    const svg = select(svgRef.current);
    svg.selectAll('*').remove();

    const root = hierarchy(data.hierarchy.tree);
    cluster().size([2 * Math.PI, RADIUS])(root);

    const leafByIndex = new Map();
    root.leaves().forEach((leaf) => {
      leaf.dataIndex = data.idToIndex.get(leaf.data.id);
      leaf.incident = [];
      leafByIndex.set(leaf.dataIndex, leaf);
    });

    const links = [];
    for (const [a, b, rg] of data.hierarchy.edges) {
      const sa = leafByIndex.get(a);
      const sb = leafByIndex.get(b);
      if (!sa || !sb) continue;
      const link = { source: sa, target: sb, rg, path: sa.path(sb) };
      links.push(link);
      sa.incident.push(link);
      sb.incident.push(link);
    }

    const line = lineRadial()
      .curve(curveBundle.beta(0.85))
      .radius((d) => d.y)
      .angle((d) => d.x);

    // svg > zoomLayer (gets zoom transform) > centered group
    const zoomLayer = svg.append('g');
    const g = zoomLayer.append('g').attr('transform', `translate(${SIZE / 2},${SIZE / 2})`);

    const linkSel = g
      .append('g')
      .attr('class', 'rb-links')
      .attr('fill', 'none')
      .selectAll('path')
      .data(links)
      .join('path')
      .attr('class', 'rb-link')
      .attr('d', (d) => line(d.path))
      .attr('stroke', (d) => colorForRg(d.rg))
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0.38);

    const labelSel = g
      .append('g')
      .selectAll('text')
      .data(root.leaves())
      .join('text')
      .attr('dy', '0.31em')
      .attr('transform', (d) => {
        const angle = (d.x * 180) / Math.PI - 90;
        const flip = d.x >= Math.PI;
        return `rotate(${angle}) translate(${d.y + 6},0)${flip ? ' rotate(180)' : ''}`;
      })
      .attr('text-anchor', (d) => (d.x >= Math.PI ? 'end' : 'start'))
      .attr('font-size', 5.5)
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
        // Same leaf already drawn — only the tooltip text/visibility may differ.
        tip.classed('show', !!(leaf && showTip));
        return;
      }
      renderedLeaf = leaf;

      if (!leaf) {
        linkSel.attr('stroke-opacity', 0.38).attr('stroke-width', 1);
        labelSel.attr('fill', C_MUTED).attr('font-weight', 400).attr('font-size', 5.5);
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
        .attr('font-size', (d) => (d === leaf ? 8.5 : activeLeaves.has(d) ? 6.5 : 5.5));

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

    // Click empty space clears the pin.
    svg.on('click', () => {
      pinnedLeaf = null;
      applyHighlight(null, false);
      setPinned(null);
    });

    svg.on('mousemove', (event) => {
      tip.style('left', `${event.clientX + 14}px`).style('top', `${event.clientY + 14}px`);
    });

    // Zoom + pan (wheel, drag, touch pinch).
    const zoomBehavior = zoom()
      .scaleExtent([0.6, 12])
      .on('zoom', (e) => zoomLayer.attr('transform', e.transform));
    svg.call(zoomBehavior).on('dblclick.zoom', null);
    zoomApi.current = {
      in: () => svg.transition().duration(250).call(zoomBehavior.scaleBy, 1.5),
      out: () => svg.transition().duration(250).call(zoomBehavior.scaleBy, 1 / 1.5),
      reset: () => svg.transition().duration(350).call(zoomBehavior.transform, zoomIdentity),
    };

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [data]);

  return (
    <div>
      <p class="view-intro">
        Each thread links two phenotypes with a strong genetic correlation (<strong>|rg| ≥ 0.5</strong>),
        bundled along a tree built by clustering the full correlation matrix.{' '}
        <strong style="color: var(--broad-blue)">Blue</strong> = positive,{' '}
        <strong style="color: var(--red)">red</strong> = negative. Hover a label to trace its
        connections; click it to pin and explore.
      </p>
      <div class="viz-wrap card" style="padding: 0.5rem;">
        <div class="viz-controls">
          <button title="Zoom in" onClick={() => zoomApi.current?.in()}>＋</button>
          <button title="Zoom out" onClick={() => zoomApi.current?.out()}>－</button>
          <button title="Reset view" onClick={() => zoomApi.current?.reset()}>⟲</button>
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
