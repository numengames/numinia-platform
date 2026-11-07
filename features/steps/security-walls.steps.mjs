/**
 * Step definitions for features/security-walls.feature.
 * Reads the two places the Content-Security-Policy is written (public/_headers and
 * src/middleware.ts) and SECURITY.md — the real files, never a copy of their text.
 */
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Given, Then } from '@cucumber/cucumber';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HEADERS = 'apps/store/public/_headers';
const MIDDLEWARE = 'apps/store/src/middleware.ts';
const POLICY = 'Content-Security-Policy:';
const DETACH = '! Content-Security-Policy';
const TOKEN = '{{INLINE_SCRIPT_HASHES}}';
const BUILT = 'apps/store/dist/client';

/** Locale prefixes of the site, as the middleware's regular expression writes them. */
const PREFIXES = ['', '/es', '/ja', '/ko', '/pt-br'];
/** Pages where a wallet signs (middleware.ts, isSessionPath). */
const SESSION_SCREENS = ['lap/session', 'lap/admin/worlds', 'panel/miembros', 'panel/roles'];
/**
 * A rule that stays in _headers for a page that no longer exists (src/pages has
 * no spike/auth; the middleware says it was retired with MIS-078). It opens
 * connect-src for nobody. Listed so the guard names it instead of failing on it;
 * remove the rule and this line together.
 */
const DEAD_RULES = ['/spike/auth'];

/** The directives of a policy, by name: `connect-src 'self' blob:` -> { 'connect-src': ["'self'", 'blob:'] }. */
function directives(policy) {
  const out = {};
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) out[name] = sources;
  }
  return out;
}

/** `_headers` as { route -> [indented lines] }; comments and blank lines are skipped. */
function headerRules(text) {
  const rules = new Map();
  let route = null;
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (/^\s/.test(line)) {
      assert.ok(route !== null, `_headers: an indented line before any route: ${line}`);
      rules.get(route).push(line.trim());
    } else {
      route = line.trim();
      assert.ok(!rules.has(route), `_headers: the route ${route} is written twice`);
      rules.set(route, []);
    }
  }
  return rules;
}

function policyOf(lines) {
  const line = lines.find((l) => l.startsWith(POLICY));
  return line === undefined ? null : line.slice(POLICY.length).trim();
}

/** The string literals of `const CSP_STRICT = [ ... ].join('; ')` joined the way the middleware joins them. */
function middlewareStrict(source) {
  const start = source.indexOf('const CSP_STRICT = [');
  assert.ok(start >= 0, `${MIDDLEWARE}: no CSP_STRICT array any more`);
  const end = source.indexOf("].join('; ')", start);
  assert.ok(end > start, `${MIDDLEWARE}: CSP_STRICT is no longer joined with '; '`);
  const body = source.slice(start + 'const CSP_STRICT = ['.length, end);
  const parts = [...body.matchAll(/"([^"\n]+)"/g)].map((m) => m[1]);
  assert.ok(parts.length > 0, `${MIDDLEWARE}: CSP_STRICT has no double-quoted directive`);
  return parts.join('; ');
}

/** The regular expression isSessionPath returns, rebuilt from the source (same trick as panel.steps.mjs). */
function middlewareSessionPattern(source) {
  const body = source.slice(source.indexOf('function isSessionPath'));
  const literal = /return\s+(\/(?:\\\/|[^/\n])+\/[a-z]*)\s*\.test\(/.exec(body);
  assert.ok(literal, `${MIDDLEWARE}: isSessionPath no longer returns a regular expression`);
  const slash = literal[1].lastIndexOf('/');
  return new RegExp(literal[1].slice(1, slash), literal[1].slice(slash + 1));
}

Given('the source of the security walls', async function () {
  const read = (file) => readFile(path.join(repoRoot, file), 'utf8');
  this.headersText = await read(HEADERS);
  this.middlewareText = await read(MIDDLEWARE);
  this.securityText = await read('SECURITY.md');
  this.rules = headerRules(this.headersText);
  const globalLines = this.rules.get('/*');
  assert.ok(globalLines, `${HEADERS}: no /* rule`);
  this.globalPolicy = policyOf(globalLines);
  assert.ok(this.globalPolicy, `${HEADERS}: the /* rule carries no ${POLICY}`);
  this.strictPolicy = middlewareStrict(this.middlewareText);
});

Then(
  'the global policy in _headers and the strict policy in the middleware are the same text',
  function () {
    assert.equal(
      this.globalPolicy,
      this.strictPolicy,
      `${HEADERS} (/*) and ${MIDDLEWARE} (CSP_STRICT) disagree: the static layer and the Worker would serve different walls`,
    );
  },
);

Then('the strict policy lets connect-src reach only the site and blob', function () {
  for (const [where, policy] of [
    [`${HEADERS} (/*)`, this.globalPolicy],
    [`${MIDDLEWARE} (CSP_STRICT)`, this.strictPolicy],
  ]) {
    assert.deepEqual(
      directives(policy)['connect-src'],
      ["'self'", 'blob:'],
      `${where}: connect-src must be exactly 'self' blob: (an open scheme or a host lets a script send data anywhere)`,
    );
  }
});

Then(
  'the strict policy keeps default-src, object-src, base-uri, form-action and frame-ancestors closed',
  function () {
    const expected = {
      'default-src': ["'self'"],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
    };
    for (const [where, policy] of [
      [`${HEADERS} (/*)`, this.globalPolicy],
      [`${MIDDLEWARE} (CSP_STRICT)`, this.strictPolicy],
    ]) {
      const found = directives(policy);
      for (const [name, sources] of Object.entries(expected)) {
        assert.deepEqual(found[name], sources, `${where}: ${name} changed`);
      }
    }
  },
);

Then(
  'every rule of _headers that opens connect-src belongs to a page the middleware treats as a session page',
  function () {
    const isSession = middlewareSessionPattern(this.middlewareText);
    for (const [route, lines] of this.rules) {
      const policy = policyOf(lines);
      if (policy === null) continue;
      const connect = directives(policy)['connect-src'] ?? [];
      const open = connect.some(
        (s) => s === 'https:' || s === 'wss:' || s === 'http:' || s === '*',
      );
      if (!open || DEAD_RULES.includes(route)) continue;
      assert.ok(
        route.endsWith('/*'),
        `${HEADERS}: ${route} opens connect-src but is not a path rule`,
      );
      const page = route.slice(0, -1);
      assert.ok(
        isSession.test(page),
        `${HEADERS}: ${route} opens connect-src, but ${MIDDLEWARE} would serve ${page} with the strict walls`,
      );
    }
  },
);

Then(
  'every session page in every locale has its rule, detaching the global policy before relaxing it',
  function () {
    const isSession = middlewareSessionPattern(this.middlewareText);
    for (const prefix of PREFIXES) {
      for (const screen of SESSION_SCREENS) {
        const page = `${prefix}/${screen}/`;
        assert.ok(isSession.test(page), `${MIDDLEWARE}: ${page} is not a session page`);
        const lines = this.rules.get(`${prefix}/${screen}/*`);
        assert.ok(lines, `${HEADERS}: no rule for ${prefix}/${screen}/*`);
        const detach = lines.indexOf(DETACH);
        const set = lines.findIndex((l) => l.startsWith(POLICY));
        assert.ok(
          detach >= 0 && detach < set,
          `${HEADERS}: ${prefix}/${screen}/* must detach the global policy before it sets its own`,
        );
      }
    }
  },
);

Then(
  'the session policy of the middleware is the strict one with only connect-src and frame-src opened',
  function () {
    // CSP_SESSION is built by replacing text in CSP_STRICT; a replace that finds nothing is silent.
    const replaced = this.middlewareText.includes(
      'CSP_STRICT.replace("connect-src \'self\' blob:", "connect-src \'self\' blob: https: wss:")',
    );
    assert.ok(
      replaced,
      `${MIDDLEWARE}: CSP_SESSION is no longer the strict policy with connect-src opened`,
    );
    assert.ok(
      this.middlewareText.includes("'; frame-src https:'"),
      `${MIDDLEWARE}: CSP_SESSION no longer adds exactly frame-src https:`,
    );
    const strict = directives(this.strictPolicy);
    assert.ok(
      this.strictPolicy.includes("connect-src 'self' blob:"),
      `${MIDDLEWARE}: the text CSP_SESSION replaces is not in CSP_STRICT, so the replace does nothing`,
    );
    assert.equal(
      strict['frame-src'],
      undefined,
      `${MIDDLEWARE}: the strict policy sets a frame-src`,
    );
    // The static copies of the session policy must say the same.
    for (const [route, lines] of this.rules) {
      const policy = policyOf(lines);
      if (policy === null || route === '/*' || DEAD_RULES.includes(route)) continue;
      const expected = `${this.strictPolicy.replace("connect-src 'self' blob:", "connect-src 'self' blob: https: wss:")}; frame-src https:`;
      assert.equal(
        policy,
        expected,
        `${HEADERS}: ${route} is not the session policy of the middleware`,
      );
    }
  },
);

Then(
  "script-src is 'self' and the hash placeholder, in _headers and in the middleware, and nowhere 'unsafe-inline', a scheme, a host or a wildcard",
  function () {
    const policies = [
      [`${HEADERS} (/*)`, this.globalPolicy],
      [`${MIDDLEWARE} (CSP_STRICT)`, this.strictPolicy],
    ];
    for (const [route, lines] of this.rules) {
      const policy = policyOf(lines);
      if (policy !== null && route !== '/*') policies.push([`${HEADERS} (${route})`, policy]);
    }
    for (const [where, policy] of policies) {
      assert.deepEqual(
        directives(policy)['script-src'],
        ["'self'", TOKEN],
        `${where}: script-src must be 'self' ${TOKEN} (the build replaces the placeholder with the hash of each inline script; anything else lets an injected script run)`,
      );
    }
  },
);

Then(
  "style-src is exactly 'self' and 'unsafe-inline', in _headers and in the middleware",
  function () {
    for (const [where, policy] of [
      [`${HEADERS} (/*)`, this.globalPolicy],
      [`${MIDDLEWARE} (CSP_STRICT)`, this.strictPolicy],
    ]) {
      assert.deepEqual(
        directives(policy)['style-src'],
        ["'self'", "'unsafe-inline'"],
        `${where}: style-src changed; it holds the one allowance that SECURITY.md names as a residual risk, and may only lose it (a new source needs a decision)`,
      );
    }
  },
);

/** Every file under `dir` ending in `suffix`. */
async function filesEnding(dir, suffix) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await filesEnding(full, suffix)));
    else if (entry.name.endsWith(suffix)) found.push(full);
  }
  return found;
}

/**
 * The inline scripts a browser would run in a page, read with a parser of our
 * own (not the one the build uses): a start tag with no src and a JavaScript
 * type, up to the next closing tag. Quoted attribute values may hold a '>'.
 */
function inlineScripts(html) {
  const found = [];
  const tag = /<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script\s*>/gi;
  for (const [, attributes, body] of html.matchAll(tag)) {
    if (/\ssrc\s*=/i.test(` ${attributes}`)) continue;
    const type = /\stype\s*=\s*["']?([^"'\s>]*)/i.exec(` ${attributes}`)?.[1] ?? '';
    if (type !== '' && !/^(module|(text|application)\/(x-)?(java|ecma)script)$/i.test(type))
      continue;
    found.push(body);
  }
  return found;
}

const sha256Source = (body) =>
  `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`;

Given('the built static layer', async function () {
  this.builtHeaders = await readFile(path.join(repoRoot, BUILT, '_headers'), 'utf8').catch(() => {
    assert.fail(`${BUILT}/_headers is missing: build the store first (npm run ci)`);
  });
  this.builtRules = headerRules(this.builtHeaders);
});

Then('no placeholder is left in the built _headers', function () {
  assert.ok(
    !this.builtHeaders.includes(TOKEN),
    `${BUILT}/_headers still holds ${TOKEN}: the build step (scripts/csp-script-hashes.mjs) did not seal it, and the browser would read a source that matches nothing`,
  );
});

Then(
  'every inline script of every built page is allowed by the script-src of the built policy',
  async function () {
    const pages = await filesEnding(path.join(repoRoot, BUILT), '.html');
    assert.ok(
      pages.length > 100,
      `${BUILT}: only ${pages.length} pages; the scan would prove nothing`,
    );
    const needed = new Map();
    for (const page of pages) {
      for (const body of inlineScripts(await readFile(page, 'utf8'))) {
        needed.set(sha256Source(body), path.relative(repoRoot, page));
      }
    }
    assert.ok(
      needed.size > 0,
      'no inline script found in the built pages: the island runtime is always there, so the scan is broken',
    );
    for (const [route, lines] of this.builtRules) {
      const policy = policyOf(lines);
      if (policy === null) continue;
      const allowed = new Set(directives(policy)['script-src']);
      assert.ok(
        !allowed.has("'unsafe-inline'"),
        `${BUILT}/_headers (${route}): script-src allows 'unsafe-inline'`,
      );
      for (const [source, page] of needed) {
        assert.ok(
          allowed.has(source),
          `${BUILT}/_headers (${route}): script-src does not allow an inline script of ${page} (${source}); the browser would block it`,
        );
      }
    }
    this.neededScripts = [...needed.keys()];
  },
);

Then('the list the Worker reads is the list the built policy carries', async function () {
  const list = JSON.parse(
    await readFile(path.join(repoRoot, BUILT, 'csp-script-hashes.json'), 'utf8'),
  );
  const carried = directives(policyOf(this.builtRules.get('/*')))['script-src'].filter(
    (s) => s !== "'self'",
  );
  assert.deepEqual(
    [...list.scripts].sort(),
    [...carried].sort(),
    'csp-script-hashes.json (read by the Worker for its own pages) and the built _headers disagree',
  );
  for (const source of this.neededScripts) {
    assert.ok(list.scripts.includes(source), `csp-script-hashes.json lacks ${source}`);
  }
});

Then(
  'SECURITY.md has a residual-risk note for each of script-src and style-src that the strict policy still allows inline, and for no other',
  function () {
    const strict = directives(this.strictPolicy);
    for (const name of ['script-src', 'style-src']) {
      const allowsInline = (strict[name] ?? []).includes("'unsafe-inline'");
      const noted = this.securityText.includes(`\`${name} 'unsafe-inline'\``);
      if (allowsInline) {
        assert.ok(
          noted,
          `SECURITY.md: the policy allows ${name} 'unsafe-inline' and the residual-risk note does not say so`,
        );
      } else {
        assert.ok(
          !noted,
          `SECURITY.md: still names ${name} 'unsafe-inline' as a residual risk, but the policy no longer allows it; remove the note`,
        );
      }
    }
    for (const name of Object.keys(strict)) {
      if (name === 'script-src' || name === 'style-src') continue;
      assert.ok(
        !(strict[name] ?? []).includes("'unsafe-inline'"),
        `${MIDDLEWARE}: ${name} allows 'unsafe-inline' and no note in SECURITY.md covers it`,
      );
    }
  },
);
