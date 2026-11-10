import { describe, expect, it } from 'vitest';
import { iconoClass } from '../icono-size';

describe('iconoClass', () => {
  it('leaves the default size (20) without a size class', () => {
    expect(iconoClass(20)).toBe('icono');
  });

  it('adds the size class for any other size', () => {
    expect(iconoClass(16)).toBe('icono icono-16');
    expect(iconoClass(36)).toBe('icono icono-36');
  });
});
