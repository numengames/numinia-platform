/**
 * Computed style values without a style attribute. The site's CSP has no
 * 'unsafe-inline' in style-src, so a React `style={…}` (printed as an attribute
 * on the server) is refused; the CSSOM (`style.setProperty`) is allowed. A
 * component hands its values to `ref={styleRef({ … })}` and they are applied
 * when the element mounts. A `null` value removes the property.
 */

export type StyleValues = Readonly<Record<string, string | null>>;

/** A ref callback that writes `values` (CSS property or custom property names, kebab-case) onto the element. */
export function styleRef(values: StyleValues): (element: HTMLElement | SVGElement | null) => void {
  return (element) => {
    if (element === null) return;
    for (const [name, value] of Object.entries(values)) {
      if (value === null) element.style.removeProperty(name);
      else element.style.setProperty(name, value);
    }
  };
}
