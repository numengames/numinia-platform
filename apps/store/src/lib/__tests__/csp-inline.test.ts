/**
 * The inline-script allowlist of the Content-Security-Policy (MIS-269).
 * What must hold: an executable inline script is found in HTML and in an
 * .astro source, data is not mistaken for code, an external script is not
 * hashed, the hash is the one a browser computes, and a missing or damaged
 * list degrades to today's policy instead of taking a page down.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  HASHES_PATH,
  SCRIPT_HASH_TOKEN,
  HEADERS_LINE_LIMIT,
  applyScriptHashes,
  inlineScriptBodies,
  loadScriptHashes,
  parseHashList,
  scriptHashSource,
  scriptHashSources,
  sealHeaders,
} from '../csp-inline';

const GOOD = `'sha256-${'A'.repeat(43)}='`;

describe('inlineScriptBodies', () => {
  it('finds classic and module inline scripts', () => {
    const html =
      '<script>var a=1</script><p>x</p><script type="module">import("/x.js")</script>' +
      "<script type='text/javascript'>b()</script><script type=application/javascript>c()</script>";
    expect(inlineScriptBodies(html)).toEqual(['var a=1', 'import("/x.js")', 'b()', 'c()']);
  });

  it('ends a script at a closing tag that carries attributes or whitespace, as a browser does', () => {
    // `</script\t\n bar>` closes the script in a browser: the body must stop there.
    const html = '<script>a()</script\t\n bar><p>x</p><script>b()</script >';
    expect(inlineScriptBodies(html)).toEqual(['a()', 'b()']);
  });

  it('skips external scripts, data blocks and types a browser does not run', () => {
    const html =
      '<script src="/a.js"></script><script type="module" src="/b.js"></script>' +
      '<script type="application/ld+json">{"a":1}</script><script type="importmap">{}</script>' +
      '<script type="speculationrules">{}</script><script type="text/plain">x</script>';
    expect(inlineScriptBodies(html)).toEqual([]);
  });

  it('is not fooled by a > inside a quoted attribute', () => {
    const html = `<script data-t='{"a":"x>y"}'>run()</script><script data-u="a>b">go()</script>`;
    expect(inlineScriptBodies(html)).toEqual(['run()', 'go()']);
  });

  it('keeps the exact bytes of the body, whitespace included', () => {
    expect(inlineScriptBodies('<script>\n  a();\n</script>')).toEqual(['\n  a();\n']);
  });

  it('reads an empty script as an empty body', () => {
    expect(inlineScriptBodies('<script></script>')).toEqual(['']);
  });

  it('in an .astro source takes only is:inline scripts, whatever the attribute braces hold', () => {
    const source = [
      '<script>bundled()</script>',
      '<script is:inline>boot()</script>',
      '<script is:inline data-x={fn((a) => a)}>templated()</script>',
      '<script is:inline type="application/json" set:html={json(x)} />',
      '<script is:inline src="/x.js"></script>',
      '<script data-is:inline-not>other()</script>',
    ].join('\n');
    expect(inlineScriptBodies(source, true)).toEqual(['boot()', 'templated()']);
  });
});

describe('scriptHashSource', () => {
  it('is the base64 SHA-256 of the UTF-8 bytes, quoted as a CSP source', async () => {
    const body = 'console.log("ñ")';
    const expected = createHash('sha256').update(body, 'utf8').digest('base64');
    expect(await scriptHashSource(body)).toBe(`'sha256-${expected}'`);
  });
});

describe('scriptHashSources', () => {
  it('lists each distinct hash once, sorted, from the pages and the .astro sources', async () => {
    const pages = ['<script>b()</script>', '<script>a()</script><script>b()</script>'];
    const astro = ['<script is:inline>c()</script>', '<script>not-shipped()</script>'];
    const list = await scriptHashSources(pages, astro);
    const want = await Promise.all(['a()', 'b()', 'c()'].map(scriptHashSource));
    expect(list).toEqual([...want].sort());
  });

  it('has no sources to add by default', async () => {
    expect(await scriptHashSources(['<script>a()</script>'])).toHaveLength(1);
    expect(await scriptHashSources([])).toEqual([]);
  });
});

describe('parseHashList', () => {
  it('accepts a non-empty list of sha256 sources', () => {
    expect(parseHashList({ scripts: [GOOD] })).toEqual([GOOD]);
  });

  it.each([
    ['null', null],
    ['a string', 'x'],
    ['no scripts key', {}],
    ['scripts not an array', { scripts: 'x' }],
    ['an empty list', { scripts: [] }],
    ['a non-string entry', { scripts: [GOOD, 3] }],
    ['an entry that is not a sha256 source', { scripts: ["'unsafe-inline'"] }],
    ['an unquoted hash', { scripts: [`sha256-${'A'.repeat(43)}=`] }],
  ])('refuses %s', (_name, raw) => {
    expect(parseHashList(raw)).toBeNull();
  });
});

describe('applyScriptHashes', () => {
  const policy = `default-src 'self'; script-src 'self' ${SCRIPT_HASH_TOKEN}; style-src 'self'`;

  it('puts the list where the placeholder is', () => {
    expect(applyScriptHashes(policy, [GOOD, "'sha256-x'"])).toBe(
      `default-src 'self'; script-src 'self' ${GOOD} 'sha256-x'; style-src 'self'`,
    );
  });

  it("falls back to 'unsafe-inline' when there is no list", () => {
    expect(applyScriptHashes(policy, null)).toBe(
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'",
    );
  });

  it('replaces every occurrence', () => {
    expect(applyScriptHashes(`${SCRIPT_HASH_TOKEN}|${SCRIPT_HASH_TOKEN}`, [GOOD])).toBe(
      `${GOOD}|${GOOD}`,
    );
  });
});

describe('loadScriptHashes', () => {
  const answer = (body: unknown, status = 200) => ({
    fetch: (request: Request): Promise<Response> => {
      expect(new URL(request.url).pathname).toBe(HASHES_PATH);
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    },
  });

  it('reads the list through the assets binding', async () => {
    expect(await loadScriptHashes(answer({ scripts: [GOOD] }), 'https://numinia.com')).toEqual([
      GOOD,
    ]);
  });

  it('answers null without a binding (node, dev)', async () => {
    expect(await loadScriptHashes(undefined, 'https://numinia.com')).toBeNull();
  });

  it('answers null when the file is missing', async () => {
    expect(await loadScriptHashes(answer({}, 404), 'https://numinia.com')).toBeNull();
  });

  it('answers null when the file is damaged', async () => {
    expect(await loadScriptHashes(answer({ scripts: ['x'] }), 'https://numinia.com')).toBeNull();
  });

  it('answers null when the fetch or the JSON fails', async () => {
    const broken = { fetch: () => Promise.reject(new Error('boom')) };
    expect(await loadScriptHashes(broken, 'https://numinia.com')).toBeNull();
    const notJson = { fetch: () => Promise.resolve(new Response('<html>')) };
    expect(await loadScriptHashes(notJson, 'https://numinia.com')).toBeNull();
  });
});

describe('sealHeaders', () => {
  const template = `/*\n  Content-Security-Policy: script-src 'self' ${SCRIPT_HASH_TOKEN}; style-src 'self'\n`;

  it('seals the template with the hashes of the built pages and returns the list', async () => {
    const { headers, sources } = await sealHeaders(template, ['<script>a()</script>']);
    expect(sources).toEqual([await scriptHashSource('a()')]);
    expect(headers).toBe(
      `/*\n  Content-Security-Policy: script-src 'self' ${sources[0]}; style-src 'self'\n`,
    );
    expect(headers).not.toContain(SCRIPT_HASH_TOKEN);
  });

  it('counts the .astro sources too', async () => {
    const { sources } = await sealHeaders(
      template,
      ['<script>a()</script>'],
      ['<script is:inline>b()</script>'],
    );
    expect(sources).toHaveLength(2);
  });

  it('refuses a template without the placeholder', async () => {
    await expect(sealHeaders('/*\n  X: y\n', ['<script>a()</script>'])).rejects.toThrow(
      /has no \{\{INLINE_SCRIPT_HASHES\}\}/,
    );
  });

  it('refuses pages with no inline script at all: the scan would be broken', async () => {
    await expect(sealHeaders(template, ['<p>none</p>'])).rejects.toThrow(/no inline script/);
  });

  it("refuses a line past Cloudflare's limit", async () => {
    const many = Array.from({ length: 40 }, (_, i) => `<script>s${i}()</script>`);
    await expect(sealHeaders(template, many)).rejects.toThrow(
      new RegExp(`past|limit is ${HEADERS_LINE_LIMIT}`),
    );
  });
});
