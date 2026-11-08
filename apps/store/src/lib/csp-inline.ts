/**
 * Inline-script allowlist for the Content-Security-Policy (MIS-269).
 *
 * `script-src` used to carry 'unsafe-inline', so a script injected into any
 * page would have run. The pages do need a few inline scripts — Astro's own
 * island runtime and the small `is:inline` boot scripts — so instead of
 * allowing all inline code the policy lists the SHA-256 of each one.
 *
 * The list is taken from the FINAL build output (every `*.html` under
 * `dist/client`), never from the sources: an earlier attempt hashed the
 * sources in Node and missed what the Cloudflare bundler really emitted, so
 * one wrong hash blocked the sign-in. Hashing the bytes that ship cannot
 * miss. The build step (scripts/csp-script-hashes.mjs) writes the list into
 * `_headers` and into `csp-script-hashes.json`; the Worker reads that file
 * for the pages it answers itself (src/middleware.ts).
 *
 * The list is built from the build, never from a response: hashing what a
 * request returns would bless a script an attacker managed to inject.
 */

/** Where the build leaves the list, next to the other static assets. */
export const HASHES_PATH = '/csp-script-hashes.json';

/** The placeholder that stands for the list in `_headers` and in the middleware. */
export const SCRIPT_HASH_TOKEN = '{{INLINE_SCRIPT_HASHES}}';

/** What the placeholder becomes when the list cannot be read: today's policy before MIS-269. */
const FALLBACK_SOURCE = "'unsafe-inline'";

const SOURCE_SHAPE = /^'sha256-[A-Za-z0-9+/]{43}='$/;

/**
 * A `<script ...>` start tag whose attribute values may themselves contain `>`
 * — quoted in HTML, or inside `{ ... }` in an .astro source (`{(a) => a}`).
 */
const SCRIPT = /<script\b((?:[^>"'{]|"[^"]*"|'[^']*'|\{[^{}]*\})*)>([\s\S]*?)<\/script\b[^>]*>/gi;
const IS_INLINE = /\sis:inline(?=[\s=>]|$)/;
const SRC_ATTRIBUTE = /\ssrc\s*=/i;
const TYPE_ATTRIBUTE = /\stype\s*=\s*["']?([^"'\s>]*)/i;
/** The types a browser runs; anything else (JSON, import maps, rules) is data and is not governed by script-src. */
const EXECUTABLE_TYPE = /^(?:module|(?:text|application)\/(?:x-)?(?:java|ecma)script)$/i;

/**
 * Bodies of the executable inline scripts of a text: no `src`, a type the
 * browser runs. With `onlyIsInline` the text is an .astro source, where a
 * plain `<script>` is bundled by Vite and only `is:inline` ones ship as written.
 */
export function inlineScriptBodies(text: string, onlyIsInline = false): string[] {
  const bodies: string[] = [];
  for (const match of text.matchAll(SCRIPT)) {
    const attributes = ` ${String(match[1])}`;
    if (onlyIsInline && !IS_INLINE.test(attributes)) continue;
    if (SRC_ATTRIBUTE.test(attributes)) continue;
    const declared = TYPE_ATTRIBUTE.exec(attributes);
    const type = declared === null ? '' : String(declared[1]);
    if (type !== '' && !EXECUTABLE_TYPE.test(type)) continue;
    bodies.push(String(match[2]));
  }
  return bodies;
}

/** The CSP source for one script body: `'sha256-<base64>'` over its UTF-8 bytes. */
export async function scriptHashSource(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return `'sha256-${btoa(binary)}'`;
}

/**
 * Every distinct inline-script hash source, sorted so the output is reproducible:
 * the scripts found in the built pages, plus the `is:inline` scripts written in
 * the .astro sources. The pages cannot be the only witness — a page rendered by
 * the Worker on request (the manual, say) never reaches `dist/` as a file, and
 * its own inline script would be blocked. An `is:inline` body ships verbatim
 * (the bundler does not touch it), so the source text hashes the same.
 */
export async function scriptHashSources(
  pages: Iterable<string>,
  astroSources: Iterable<string> = [],
): Promise<string[]> {
  const sources = new Set<string>();
  const bodies = [
    ...[...pages].flatMap((page) => inlineScriptBodies(page)),
    ...[...astroSources].flatMap((source) => inlineScriptBodies(source, true)),
  ];
  for (const body of bodies) sources.add(await scriptHashSource(body));
  return [...sources].sort();
}

/** Reads the list the build left; anything that is not a non-empty list of hash sources is no list at all. */
export function parseHashList(raw: unknown): string[] | null {
  if (raw === null || typeof raw !== 'object') return null;
  const scripts = (raw as { scripts?: unknown }).scripts;
  if (!Array.isArray(scripts) || scripts.length === 0) return null;
  const list: unknown[] = scripts;
  if (!list.every((entry) => typeof entry === 'string' && SOURCE_SHAPE.test(entry))) return null;
  return list as string[];
}

/** The policy with the placeholder replaced by the list, or by 'unsafe-inline' when there is none. */
export function applyScriptHashes(policy: string, sources: readonly string[] | null): string {
  return policy.replaceAll(
    SCRIPT_HASH_TOKEN,
    sources === null ? FALLBACK_SOURCE : sources.join(' '),
  );
}

/** What the Worker can ask for: the assets binding's fetch. */
export interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

/**
 * The list through the Worker's assets binding (the file is a static asset of
 * the same deploy, so it always matches the pages the Worker's twin serves).
 * Null on any failure: the caller falls back and says so; a missing file must
 * never take a page down.
 */
export async function loadScriptHashes(
  assets: AssetFetcher | undefined,
  origin: string,
): Promise<string[] | null> {
  if (assets === undefined) return null;
  try {
    const response = await assets.fetch(new Request(new URL(HASHES_PATH, origin)));
    if (!response.ok) return null;
    return parseHashList(await response.json());
  } catch {
    return null;
  }
}

/** Cloudflare Workers static assets: a `_headers` line may not exceed this. */
export const HEADERS_LINE_LIMIT = 2000;

/**
 * The build step's core: the `_headers` template and the built pages (plus the
 * .astro sources) in, the sealed `_headers` and the list out. It throws when
 * the result cannot be trusted, and a throw fails the build, so the deploy
 * never happens and the previous version stays live: no placeholder to seal,
 * no inline script anywhere (the scan itself is broken — the island runtime is
 * always there), or a line past what Cloudflare accepts.
 */
export async function sealHeaders(
  headersText: string,
  pages: Iterable<string>,
  astroSources: Iterable<string> = [],
): Promise<{ headers: string; sources: string[] }> {
  if (!headersText.includes(SCRIPT_HASH_TOKEN)) {
    throw new Error(
      `csp-script-hashes: _headers has no ${SCRIPT_HASH_TOKEN}; the script-src of the static layer would not be sealed`,
    );
  }
  const sources = await scriptHashSources(pages, astroSources);
  if (sources.length === 0) {
    throw new Error(
      'csp-script-hashes: the built pages hold no inline script at all; the scan is broken',
    );
  }
  const headers = applyScriptHashes(headersText, sources);
  const tooLong = headers.split('\n').find((line) => line.length > HEADERS_LINE_LIMIT);
  if (tooLong !== undefined) {
    throw new Error(
      `csp-script-hashes: a _headers line is ${tooLong.length} characters (Cloudflare's limit is ${HEADERS_LINE_LIMIT}): ${sources.length} hashes no longer fit; move inline scripts to files`,
    );
  }
  return { headers, sources };
}
