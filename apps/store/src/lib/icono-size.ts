/**
 * The sizes an inline icon can take. Each has a `.icono-NN` class in the
 * stylesheet (Icon.astro): a `--icono-size` style attribute would need
 * 'unsafe-inline' in style-src. 20px is the stylesheet's default and travels
 * without a class.
 */

export type IconoSize = 12 | 14 | 16 | 18 | 20 | 22 | 24 | 26 | 28 | 32 | 36 | 40 | 48 | 72;

/** The class list of an icon span of `size`. */
export function iconoClass(size: IconoSize): string {
  return size === 20 ? 'icono' : `icono icono-${size}`;
}
