import { describe, it, expect } from 'vitest';
import { render } from 'preact-render-to-string';
import { h } from 'preact';
import { EncodingCard } from '../../src/components/PhenotypeDetail.jsx';

const html = (seed) => render(h(EncodingCard, { seed }));

describe('EncodingCard', () => {
  it('renders an ordinal scale in low→high order with a direction note', () => {
    const seed = {
      kind: 'ordinal',
      levels: [
        [1, 'Extremely happy'],
        [2, 'Very happy'],
        [6, 'Extremely unhappy'],
      ],
    };
    const out = html(seed);
    expect(out).toContain('Ordinal scale');
    // Direction is stated relative to the coded ends.
    expect(out).toContain('rising from “Extremely happy” to “Extremely unhappy”');
    expect(out).toContain('higher');
    // Levels appear in order, with their coded values.
    const iHappy = out.indexOf('Extremely happy');
    const iUnhappy = out.indexOf('Extremely unhappy');
    expect(iHappy).toBeGreaterThan(-1);
    expect(iUnhappy).toBeGreaterThan(iHappy);
    expect(out).toContain('>6<'); // the reordered code value is shown verbatim
  });

  it('states the case direction for a binary trait, without a scale', () => {
    const out = html({ kind: 'binary' });
    expect(out).toContain('Binary (case/control)');
    expect(out).toContain('being a');
    expect(out).not.toContain('encoding-scale');
  });

  it('states higher-is-more for continuous and count traits', () => {
    expect(html({ kind: 'continuous' })).toContain('continuous trait');
    expect(html({ kind: 'integer' })).toContain('count trait');
  });

  it('renders nothing without encoding metadata', () => {
    expect(html({})).toBe('');
  });
});
