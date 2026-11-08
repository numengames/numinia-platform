/**
 * Dynamic style values without a style attribute (CSP: style-src has no
 * 'unsafe-inline', so `style="…"` in the HTML is refused). A component that
 * needs a computed value writes it as JSON in `data-style`, e.g.
 * `data-style={JSON.stringify({ left: '40%', '--n': '12' })}`; this script
 * hands every entry to `style.setProperty`, which the CSP allows (CSSOM).
 * Keys are CSS property names (kebab-case) or custom properties.
 */

function applyDataStyle(root: ParentNode): void {
  for (const element of root.querySelectorAll<HTMLElement>('[data-style]')) {
    let entries: Record<string, unknown>;
    try {
      entries = JSON.parse(element.dataset.style ?? '{}') as Record<string, unknown>;
    } catch {
      continue;
    }
    for (const [name, value] of Object.entries(entries)) {
      element.style.setProperty(name, String(value));
    }
  }
}

applyDataStyle(document);
