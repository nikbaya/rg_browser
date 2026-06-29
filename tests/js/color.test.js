// Tests for the color encodings (src/lib/color.js): the rg diverging scale, the
// text-contrast helpers, and the ordinal category palette. Colors are compared
// by parsed RGB channels so the assertions hold whether d3 returns "#rrggbb" or
// "rgb(r, g, b)".
import { describe, it, expect, beforeEach } from 'vitest';
import {
  colorForRg,
  textOnRg,
  setCategories,
  getCategories,
  colorForCategory,
  textOnColor,
} from '../../src/lib/color.js';

function toRGB(s) {
  const m = s.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (m) return [+m[1], +m[2], +m[3]];
  const h = s.replace('#', '');
  const v = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

describe('colorForRg', () => {
  it('maps endpoints and midpoint to the soft diverging scale', () => {
    expect(toRGB(colorForRg(-1))).toEqual([100, 149, 237]); // #6495ed cornflower (neg)
    expect(toRGB(colorForRg(0))).toEqual([255, 255, 255]); // white
    expect(toRGB(colorForRg(1))).toEqual([205, 85, 85]); // #cd5555 coral (pos)
  });

  it('clamps out-of-range values', () => {
    expect(colorForRg(-5)).toBe(colorForRg(-1));
    expect(colorForRg(5)).toBe(colorForRg(1));
  });

  it('returns gray for missing values', () => {
    expect(colorForRg(NaN)).toBe('#e4e4ea');
    expect(colorForRg(null)).toBe('#e4e4ea');
  });
});

describe('textOnRg', () => {
  it('uses white text only on the darker (saturated) ends of the scale', () => {
    expect(textOnRg(1)).toBe('#ffffff'); // coral endpoint is dark enough
    expect(textOnRg(-1)).toBe('#ffffff'); // cornflower endpoint is dark enough
    expect(textOnRg(0.5)).toBe('#3e3e40'); // near-white mid needs dark text
    expect(textOnRg(0)).toBe('#3e3e40');
    expect(textOnRg(NaN)).toBe('#3e3e40');
  });
});

describe('category palette', () => {
  beforeEach(() => setCategories(['X', 'Y', 'Z']));

  it('assigns palette colors in registration order', () => {
    expect(getCategories()).toEqual(['X', 'Y', 'Z']);
    expect(colorForCategory('X')).toBe('#4e79a7');
    expect(colorForCategory('Y')).toBe('#f28e2b');
    expect(colorForCategory('Z')).toBe('#59a14f');
  });

  it('returns fallback gray for an empty/missing name', () => {
    expect(colorForCategory('')).toBe('#bab0ac');
    expect(colorForCategory(null)).toBe('#bab0ac');
    expect(colorForCategory(undefined)).toBe('#bab0ac');
  });
});

describe('textOnColor', () => {
  it('chooses dark text on light backgrounds and vice versa', () => {
    expect(textOnColor('#ffffff')).toBe('#1f1f1f');
    expect(textOnColor('#000000')).toBe('#ffffff');
    expect(textOnColor('#006db6')).toBe('#ffffff'); // dark blue -> white text
  });
});
