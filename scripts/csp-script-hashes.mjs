// Astro integration (MIS-269): turns the placeholder in `_headers` into the
// SHA-256 list of every inline script the built pages really contain (plus the
// `is:inline` ones written in the sources, for pages the Worker renders), and
// leaves the same list in `csp-script-hashes.json` for the Worker.
//
// It runs on the FINAL output (dist/client/**/*.html), after the bundler and
// the adapter have done their work, so it hashes the bytes that ship. It
// fails the build — and so the deploy, leaving the previous version live —
// when the result cannot be trusted: no placeholder, no scripts, a policy
// line past the 2000 characters Cloudflare allows in `_headers`. The rules
// (and their tests) live in apps/store/src/lib/csp-inline.ts.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HASHES_PATH, sealHeaders } from '../apps/store/src/lib/csp-inline';

function* filesEnding(dir, suffix) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* filesEnding(path, suffix);
    else if (entry.name.endsWith(suffix)) yield path;
  }
}

export function cspScriptHashes() {
  let srcDir = '';
  return {
    name: 'csp-script-hashes',
    hooks: {
      'astro:config:done': ({ config }) => {
        srcDir = fileURLToPath(config.srcDir);
      },
      'astro:build:done': async ({ dir }) => {
        const out = fileURLToPath(dir);
        const headersPath = join(out, '_headers');
        const pages = [...filesEnding(out, '.html')].map((file) => readFileSync(file, 'utf8'));
        const astroSources = [...filesEnding(srcDir, '.astro')].map((file) =>
          readFileSync(file, 'utf8'),
        );
        const { headers, sources } = await sealHeaders(
          readFileSync(headersPath, 'utf8'),
          pages,
          astroSources,
        );
        writeFileSync(headersPath, headers);
        writeFileSync(
          join(out, HASHES_PATH.slice(1)),
          `${JSON.stringify({ scripts: sources }, null, 2)}\n`,
        );
        console.log(
          `[csp-script-hashes] ${sources.length} inline-script hashes from ${pages.length} pages + ${astroSources.length} .astro sources → _headers + ${HASHES_PATH}`,
        );
      },
    },
  };
}
