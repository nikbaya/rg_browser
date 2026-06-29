import { colorForRg } from '../lib/color.js';

// Lightweight, data-free SVG thumbnails that evoke each explore view using the
// real rg diverging scale (cornflower -> white -> coral).

export function HeatmapPreview() {
  const cols = 11;
  const rows = 7;
  const cell = 9;
  const gap = 1;
  const w = cols * (cell + gap) - gap;
  const h = rows * (cell + gap) - gap;
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = Math.sin(r * 0.95) * Math.cos(c * 0.85); // smooth diverging blocks
      cells.push(
        <rect
          key={`${r}-${c}`}
          x={c * (cell + gap)}
          y={r * (cell + gap)}
          width={cell}
          height={cell}
          rx="1.5"
          fill={colorForRg(v)}
        />
      );
    }
  }
  return (
    <svg class="card-preview-svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {cells}
    </svg>
  );
}

export function NetworkPreview() {
  const N = 12;
  const cx = 50;
  const cy = 50;
  const R = 40;
  const nodes = Array.from({ length: N }, (_, i) => {
    const a = (i / N) * 2 * Math.PI - Math.PI / 2;
    return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
  });
  const edges = [
    [0, 5, 0.85], [1, 7, -0.55], [2, 9, 0.6], [3, 8, -0.72],
    [4, 10, 0.45], [6, 11, 0.9], [0, 7, -0.4], [2, 6, 0.55], [9, 11, -0.6],
  ];
  return (
    <svg class="card-preview-svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {edges.map(([a, b, v], k) => {
        const A = nodes[a];
        const B = nodes[b];
        return (
          <path
            key={k}
            d={`M${A.x},${A.y} Q${cx},${cy} ${B.x},${B.y}`}
            fill="none"
            stroke={colorForRg(v)}
            stroke-width="1.4"
            stroke-opacity="0.85"
          />
        );
      })}
      {nodes.map((n, k) => (
        <circle key={k} cx={n.x} cy={n.y} r="2.2" style="fill: var(--slate)" />
      ))}
    </svg>
  );
}

export function PairPreview() {
  return (
    <svg class="card-preview-svg" viewBox="0 0 120 64" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {/* connector */}
      <line x1="40" y1="32" x2="80" y2="32" style="stroke: var(--border)" stroke-width="2" />
      {/* left + right trait cards */}
      {[6, 80].map((x, idx) => (
        <g key={idx}>
          <rect x={x} y="14" width="34" height="36" rx="4" style="fill: var(--surface); stroke: var(--border)" />
          <rect x={x + 5} y="20" width="24" height="3" rx="1.5" style="fill: var(--slate-mut)" />
          <rect x={x + 5} y="27" width="18" height="3" rx="1.5" style="fill: var(--border)" />
          <rect x={x + 5} y="34" width="21" height="3" rx="1.5" style="fill: var(--border)" />
        </g>
      ))}
      {/* center rg pill */}
      <rect x="46" y="23" width="28" height="18" rx="9" fill={colorForRg(0.66)} />
      <text x="60" y="35.5" text-anchor="middle" font-size="9" font-weight="700" fill="#ffffff">
        rg
      </text>
    </svg>
  );
}
