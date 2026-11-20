/**
 * The template's own contract, read from the repository it generated. The
 * header of the template's REUSE.toml says, in two comment blocks, which
 * files are the template's alone (removed from what it generates) and which
 * file becomes the LICENSE:
 *
 *   # Mould-only artifacts, stripped by nwos-deploy after generation:
 *   #   LICENSE, LICENSES/, REUSE.toml, TRADEMARKS.md, LEGAL_DEBT.md
 *   # Renamed by nwos-deploy after generation:
 *   #   LICENSE.client -> LICENSE (placeholders resolved)
 *
 * The same format NWOS reads (nwos-deploy `src/lib/mould.ts`), so one
 * template serves both. Pure: no network. A contract that cannot be read is
 * null — the caller stops, it never guesses a list.
 */

export interface MouldSpec {
  /** Paths (files, or folders without the trailing slash) the generated repository loses. */
  readonly strip: readonly string[];
  readonly renameFrom: string;
  readonly renameTo: string;
}

export function parseMouldSpec(reuseToml: string): MouldSpec | null {
  const lines = reuseToml.split('\n').map((line) => line.replace(/^#\s?/, '').trim());
  const stripAt = lines.findIndex((line) => line.startsWith('Mould-only artifacts, stripped by'));
  const renameAt = lines.findIndex((line) => line.startsWith('Renamed by'));
  if (stripAt === -1 || renameAt <= stripAt) return null;
  const strip = lines
    .slice(stripAt + 1, renameAt)
    .flatMap((line) => line.split(','))
    .map((entry) => entry.trim().replace(/\/$/, ''))
    .filter((entry) => entry !== '');
  const rename = /^(\S+)\s*->\s*(\S+)/.exec(lines[renameAt + 1] ?? '');
  if (rename === null || strip.length === 0) return null;
  const renameFrom = rename[1] as string;
  const renameTo = rename[2] as string;
  if (renameFrom === renameTo) return null;
  return { strip: strip.filter((path) => path !== renameFrom), renameFrom, renameTo };
}

/** Whether the contract takes `path` away: the path itself, or anything under a stripped folder. */
export function stripped(spec: MouldSpec, path: string): boolean {
  return spec.strip.some((artifact) => path === artifact || path.startsWith(`${artifact}/`));
}

/** What the placeholders become. No person's data: nobody's email is written. */
export interface MouldValues {
  /** The organization's name, already made safe by `safeTitle`. */
  readonly title: string;
  /** The repository's name. */
  readonly slug: string;
  /** The day it was made, `YYYY-MM-DD` (UTC). */
  readonly date: string;
}

/** Characters that could become markup, a placeholder or an escape where the name is written. */
const UNSAFE = '<>&"\'`{}\\';

/**
 * An organization's name as it may be written into Markdown, HTML and a
 * licence: no control characters, no markup, no braces, one line, at most 80
 * characters. Null when nothing is left.
 */
export function safeTitle(name: string): string | null {
  const clean = [...name]
    .map((char) => (char < ' ' || char === '\u007f' || UNSAFE.includes(char) ? ' ' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim();
  return clean === '' ? null : clean;
}

/** The text with the template's placeholders resolved; every other `{{…}}` is left as the template wrote it. */
export function personalize(text: string, values: MouldValues): string {
  return text
    .replace(/\{\{COMPANY_NAME\}\}/g, values.title)
    .replace(/\{\{COMPANY_SLUG\}\}/g, values.slug)
    .replace(/\{\{DEPLOY_DATE\}\}/g, values.date)
    .replace(/\{\{DATE\}\}/g, values.date)
    .replace(/\{\{RESPONSIBLE_EMAIL\}\}/g, 'not recorded in this repository');
}

/** An entry of a repository's tree as GitHub lists it, read as untrusted. */
export interface TreeEntry {
  readonly path: string;
  readonly mode: string;
  readonly type: string;
  readonly sha: string;
}

/** An entry of the tree to write: an existing blob by its sha, or new text. */
export type NewTreeEntry =
  | { readonly path: string; readonly mode: string; readonly type: string; readonly sha: string }
  | {
      readonly path: string;
      readonly mode: '100644';
      readonly type: 'blob';
      readonly content: string;
    };

/**
 * The whole tree of the one commit that makes a generated repository the
 * organization's own: what the contract strips is gone, the reserved
 * licence takes the LICENSE's place, and every file in `rewritten` carries
 * its personalized text. `rewritten` must hold the licence (`renameFrom`).
 */
export function installTree(
  head: readonly TreeEntry[],
  spec: MouldSpec,
  rewritten: ReadonlyMap<string, string>,
): NewTreeEntry[] {
  const licence = rewritten.get(spec.renameFrom);
  if (licence === undefined) throw new TypeError(`${spec.renameFrom} was not personalized`);
  const kept = head.filter(
    (entry) =>
      entry.type !== 'tree' &&
      entry.path !== spec.renameFrom &&
      entry.path !== spec.renameTo &&
      !stripped(spec, entry.path),
  );
  return [
    ...kept.map((entry): NewTreeEntry => {
      const text = rewritten.get(entry.path);
      return text === undefined
        ? { path: entry.path, mode: entry.mode, type: entry.type, sha: entry.sha }
        : { path: entry.path, mode: '100644', type: 'blob', content: text };
    }),
    { path: spec.renameTo, mode: '100644', type: 'blob', content: licence },
  ];
}
