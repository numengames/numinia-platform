/**
 * The folded rails' tooltip floats beside its icon, towards the page.
 */

import { describe, expect, it } from 'vitest';
import { placeTip } from '../rail-tip';

describe('placeTip', () => {
  const viewport = { width: 1600, height: 900 };
  const item = { top: 200, bottom: 244, left: 10, right: 62 };

  it('the city rail: to the right of the item, centred on it', () => {
    expect(placeTip(item, { width: 120, height: 30 }, viewport, 'city')).toEqual({
      top: 207,
      left: 68,
    });
  });

  it('your rail: to the left of the item', () => {
    const right = { top: 200, bottom: 244, left: 1538, right: 1590 };
    expect(placeTip(right, { width: 120, height: 30 }, viewport, 'you')).toEqual({
      top: 207,
      left: 1412,
    });
  });

  it('your face: below it, centred, never past the window', () => {
    const face = { top: 16, bottom: 60, left: 1500, right: 1544 };
    expect(placeTip(face, { width: 80, height: 30 }, viewport, 'below')).toEqual({
      top: 66,
      left: 1482,
    });
    const edge = { top: 16, bottom: 60, left: 1550, right: 1594 };
    expect(placeTip(edge, { width: 120, height: 30 }, viewport, 'below').left).toBe(1472);
  });

  it('stays inside the window', () => {
    const top = { top: 0, bottom: 10, left: 1590, right: 1600 };
    expect(placeTip(top, { width: 120, height: 30 }, viewport, 'city')).toEqual({
      top: 8,
      left: 1472,
    });
  });
});
