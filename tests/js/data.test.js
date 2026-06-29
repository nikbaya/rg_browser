// Tests for the frontend data-access layer (src/lib/data.js). These run against
// a small synthetic in-memory dataset so the row-major index math, ranking,
// pair-stat derivation, and number formatting are verified independently of the
// real 677x677 payload.
import { describe, it, expect } from 'vitest';
import {
  get,
  topCorrelations,
  pairStats,
  formatP,
  formatNum,
  ukbShowcaseLink,
} from '../../src/lib/data.js';

// 3x3 symmetric fixture, row-major.
//        A      B      C
//  A [ 1.0    0.8   -0.5 ]
//  B [ 0.8    1.0    0.2 ]
//  C [-0.5    0.2    1.0 ]
function makeData() {
  const n = 3;
  const rg = Float32Array.from([
    1.0, 0.8, -0.5,
    0.8, 1.0, 0.2,
    -0.5, 0.2, 1.0,
  ]);
  const se = Float32Array.from([
    0.0, 0.1, 0.2,
    0.1, 0.0, 0.05,
    0.2, 0.05, 0.0,
  ]);
  const nlogp = Float32Array.from([
    NaN, 6, 3,
    6, NaN, 1,
    3, 1, NaN,
  ]);
  const phenotypes = [
    { id: 'A', h2: 0.1 },
    { id: 'B', h2: 0.2 },
    { id: 'C', h2: 0.3 },
  ];
  return { n, rg, se, nlogp, phenotypes };
}

describe('get', () => {
  it('reads matrix[i*n + j] (row-major)', () => {
    const { rg, n } = makeData();
    expect(get(rg, n, 0, 1)).toBeCloseTo(0.8, 6);
    expect(get(rg, n, 2, 0)).toBeCloseTo(-0.5, 6);
    expect(get(rg, n, 1, 1)).toBe(1);
  });
});

describe('topCorrelations', () => {
  it('excludes self and sorts by |rg| descending', () => {
    const data = makeData();
    const top = topCorrelations(data, 0);
    expect(top.map((t) => t.j)).toEqual([1, 2]); // |0.8| > |-0.5|
    expect(top[0].rg).toBeCloseTo(0.8, 6);
    expect(top.every((t) => t.j !== 0)).toBe(true);
  });

  it('respects k', () => {
    const data = makeData();
    expect(topCorrelations(data, 0, 1)).toHaveLength(1);
  });

  it('skips NaN correlations', () => {
    const data = makeData();
    data.rg[0 * 3 + 2] = NaN; // A-C becomes missing
    const top = topCorrelations(data, 0);
    expect(top.map((t) => t.j)).toEqual([1]);
  });
});

describe('pairStats', () => {
  it('derives z, p, and heritabilities', () => {
    const data = makeData();
    const s = pairStats(data, 0, 1);
    expect(s.rg).toBeCloseTo(0.8, 6);
    expect(s.se).toBeCloseTo(0.1, 6);
    expect(s.z).toBeCloseTo(8, 4); // 0.8 / 0.1
    expect(s.nlogp).toBeCloseTo(6, 6);
    expect(s.p).toBeCloseTo(1e-6, 12); // 10^-6
    expect(s.h2_i).toBe(0.1);
    expect(s.h2_j).toBe(0.2);
  });

  it('returns NaN z when se is 0 and NaN p when nlogp is NaN', () => {
    const data = makeData();
    const s = pairStats(data, 0, 0); // diagonal: se=0, nlogp=NaN
    expect(Number.isNaN(s.z)).toBe(true);
    expect(Number.isNaN(s.p)).toBe(true);
  });
});

describe('formatP', () => {
  it('formats edge cases', () => {
    expect(formatP(NaN)).toBe('—');
    expect(formatP(null)).toBe('—'); // stat not computed (e.g. h2_p for a sex-specific trait)
    expect(formatP(undefined)).toBe('—');
    expect(formatP(0)).toBe('<1e-300');
    expect(formatP(1e-6)).toBe((1e-6).toExponential(2));
    expect(formatP(0.5)).toBe((0.5).toPrecision(3));
  });
});

describe('formatNum', () => {
  it('handles null/NaN and fixed digits', () => {
    expect(formatNum(null)).toBe('—');
    expect(formatNum(NaN)).toBe('—');
    expect(formatNum(0.12345)).toBe('0.123');
    expect(formatNum(0.12345, 2)).toBe('0.12');
  });
});

describe('ukbShowcaseLink', () => {
  const field = (id) => ukbShowcaseLink(id)?.url;

  it('links numeric field ids to the field showcase page', () => {
    expect(field('5101_irnt')).toBe('https://biobank.ndph.ox.ac.uk/showcase/field.cgi?id=5101');
    expect(field('2395_2')).toBe('https://biobank.ndph.ox.ac.uk/showcase/field.cgi?id=2395');
    expect(field('2365')).toBe('https://biobank.ndph.ox.ac.uk/showcase/field.cgi?id=2365');
  });

  it('links ICD10 codes to the data-coding 19 page', () => {
    const icd = 'https://biobank.ndph.ox.ac.uk/showcase/coding.cgi?id=19';
    expect(field('I48')).toBe(icd);
    expect(field('C44')).toBe(icd);
    expect(field('M20')).toBe(icd);
  });

  it('returns null for curated/FinnGen-style ids with no showcase page', () => {
    expect(ukbShowcaseLink('CARDIAC_ARRHYTM')).toBeNull();
    expect(ukbShowcaseLink('C3_PROSTATE')).toBeNull();
    expect(ukbShowcaseLink('I9_MI')).toBeNull();
    expect(ukbShowcaseLink('H7_LENS')).toBeNull();
  });
});
