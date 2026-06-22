// Broad-brand diverging color scale for genetic correlations in [-1, 1]:
//   rg = -1 -> Broad Red (#b12028)
//   rg =  0 -> white
//   rg = +1 -> Broad Blue (#006db6)
import { scaleLinear } from 'd3-scale';

const rgColor = scaleLinear()
  .domain([-1, 0, 1])
  .range(['#b12028', '#ffffff', '#006db6'])
  .clamp(true);

export function colorForRg(rg) {
  if (rg == null || Number.isNaN(rg)) return '#e4e4ea';
  return rgColor(rg);
}

// Pick black/white text for legibility on a given rg-colored chip.
export function textOnRg(rg) {
  if (rg == null || Number.isNaN(rg)) return '#3e3e40';
  // Mid-range (near white) needs dark text; saturated ends need white.
  return Math.abs(rg) > 0.45 ? '#ffffff' : '#3e3e40';
}
