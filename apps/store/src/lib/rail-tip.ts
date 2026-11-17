/**
 * Where a folded rail's tooltip floats (v3, «La ciudad y tú»): beside its
 * icon, towards the page — right of the city's rail, left of yours —
 * centred on it and never past the window. Your face, at the page's top
 * right, takes it below instead (`below`): beside it would cover «Entrar». Its own module on purpose: the
 * tooltip's script is inlined into every page, and sharing lib/app-nav.ts
 * with the rails' script would turn both into an external chunk (the
 * landing page ships no external JavaScript).
 */

import type { Point, Rect, RailSide, Size } from './rails';

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(value, high));

export function placeTip(
  anchor: Rect,
  tip: Size,
  viewport: Size,
  side: RailSide | 'below',
  gap = 6,
  margin = 8,
): Point {
  const below = side === 'below';
  const left = below
    ? (anchor.left + anchor.right) / 2 - tip.width / 2
    : side === 'city'
      ? anchor.right + gap
      : anchor.left - tip.width - gap;
  const top = below ? anchor.bottom + gap : (anchor.top + anchor.bottom) / 2 - tip.height / 2;
  return {
    top: clamp(top, margin, viewport.height - tip.height - margin),
    left: clamp(left, margin, viewport.width - tip.width - margin),
  };
}
