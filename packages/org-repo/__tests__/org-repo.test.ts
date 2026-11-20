/**
 * @numinia/org-repo against a GitHub made of a Map: the configuration that
 * fails closed, the App's signed JWT, the template's contract, and the
 * whole making of an organization's repository — first time, again, while
 * GitHub is still copying, and every refusal in words.
 */

import { toBase64 } from '@numinia/state';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  OrgRepoConfigError,
  OrgRepoError,
  ORGANIZATION_TOPIC,
  installationToken,
  parseOrgRepoEnv,
  provisionRepository,
  repositoryNameOf,
  type OrgRepoEnv,
} from '../src/index';
import { appJwt, ask, field } from '../src/github';
import { installTree, parseMouldSpec, personalize, safeTitle, stripped } from '../src/mould';

const NOW = new Date('2026-11-20T12:00:00.000Z');
let env: OrgRepoEnv;
let verifies: (signature: Uint8Array, signed: string) => Promise<boolean>;

/** The PEM's marker lines, put together here so no scanner reads this file as a key. */
const MARK = (edge: string): string => `-----${edge} ${['PRIVATE', 'KEY'].join(' ')}-----`;

const pem = (der: ArrayBuffer): string =>
  `${MARK('BEGIN')}\n${(toBase64(new Uint8Array(der)).match(/.{1,64}/g) ?? []).join('\n')}\n${MARK('END')}\n`;

const input = (key: string) => ({
  ORG_REPO_APP_ID: '5846730',
  ORG_REPO_INSTALLATION_ID: '183988580',
  ORG_REPO_OWNER: 'numen-games-nwos-orgs',
  ORG_REPO_TEMPLATE: 'nwos-workspace-template',
  ORG_REPO_APP_PRIVATE_KEY: key,
});

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  verifies = (signature, signed) =>
    crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      pair.publicKey,
      signature,
      new TextEncoder().encode(signed),
    );
  env = parseOrgRepoEnv(input(pem(await crypto.subtle.exportKey('pkcs8', pair.privateKey))));
});

const REUSE = `# REUSE.toml — the mould
#
# Mould-only artifacts, stripped by nwos-deploy after generation:
#   LICENSE, LICENSES/, REUSE.toml, TRADEMARKS.md,
#   tests/, .github/
# Renamed by nwos-deploy after generation:
#   LICENSE.client -> LICENSE (placeholders resolved)
#
version = 1
`;

const TEMPLATE_FILES: Readonly<Record<string, string>> = {
  'REUSE.toml': REUSE,
  LICENSE: 'MIT, the mould’s',
  'LICENSE.client': 'Copyright (c) {{DEPLOY_DATE}} {{COMPANY_NAME}}. All rights reserved.',
  'LICENSES/MIT.txt': 'MIT',
  'TRADEMARKS.md': 'marks',
  'tests/check.mjs': 'check',
  '.github/workflows/ci.yml': 'ci',
  'README.md': '# {{COMPANY_NAME}}\nOracle: {{RESPONSIBLE_EMAIL}} · level {{AUTONOMY_LEVEL}}',
  'CHANGELOG.md': '## [0.1.0] — {{DATE}}',
  'agents/_template/SOUL.md': '# SOUL — {{AGENT_NAME}} {{DATE}}',
  'worlds/README.md': 'worlds of {{COMPANY_SLUG}}',
};

interface Repo {
  id: number;
  private: boolean;
  template: string | null;
  topics: string[];
  /** null while GitHub is still copying the template. */
  files: Map<string, string> | null;
  commits: string[];
}

/** A GitHub that keeps repositories in a Map and answers the calls the package makes. */
function github(options: { copying?: boolean } = {}) {
  const repos = new Map<string, Repo>();
  const calls: string[] = [];
  const broken = new Map<string, { status: number; json?: unknown }>();
  const trees = new Map<string, Map<string, string>>();
  let serial = 100;
  const json = (status: number, body?: unknown) =>
    body === undefined ? new Response(null, { status }) : Response.json(body, { status });

  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace('https://api.github.com', '');
    const method = init?.method ?? 'GET';
    const call = `${method} ${path}`;
    calls.push(call);
    const sent = init?.body === undefined ? {} : (JSON.parse(String(init.body)) as never);
    const fault = broken.get(call);
    if (fault !== undefined) return json(fault.status, fault.json);
    if (path.endsWith('/access_tokens')) return json(201, { token: 'ghs_test', sent });
    const [, , owner, name, ...rest] = path.split('?')[0]!.split('/');
    const what = rest.join('/');
    if (method === 'POST' && what === 'generate') {
      const made = sent as { name: string; private: boolean };
      if (repos.has(made.name)) return json(422, { message: 'Name already exists' });
      repos.set(made.name, {
        id: ++serial,
        private: made.private,
        template: name!,
        topics: [],
        files: options.copying === true ? null : new Map(Object.entries(TEMPLATE_FILES)),
        commits: ['c0'],
      });
      return json(201, { id: serial, default_branch: 'main', private: made.private });
    }
    const repo = repos.get(name!);
    if (repo === undefined) return json(404, { message: 'Not Found' });
    if (what === '') {
      return json(200, {
        id: repo.id,
        default_branch: 'main',
        private: repo.private,
        owner: { login: owner },
        ...(repo.template === null ? {} : { template_repository: { name: repo.template } }),
      });
    }
    if (what === 'topics') {
      repo.topics = (sent as { names: string[] }).names;
      return json(200, { names: repo.topics });
    }
    if (what === 'git/ref/heads/main') {
      return repo.files === null
        ? json(409, { message: 'Git Repository is empty.' })
        : json(200, { object: { sha: repo.commits.at(-1) } });
    }
    const files = repo.files ?? new Map<string, string>();
    if (what.startsWith('git/commits/')) return json(200, { tree: { sha: 't0' } });
    if (what.startsWith('git/trees/')) {
      return json(200, {
        truncated: false,
        tree: [
          { path: 'agents', mode: '040000', type: 'tree', sha: 'dir' },
          { path: 'broken' },
          ...[...files.keys()].map((file) => ({
            path: file,
            mode: '100644',
            type: 'blob',
            sha: `sha:${file}`,
          })),
        ],
      });
    }
    if (what.startsWith('git/blobs/')) {
      const file = decodeURIComponent(what.slice('git/blobs/sha:'.length));
      return json(200, {
        encoding: 'base64',
        content: toBase64(new TextEncoder().encode(files.get(file) ?? '')),
      });
    }
    if (method === 'POST' && what === 'git/trees') {
      const next = new Map<string, string>();
      for (const entry of (sent as { tree: Record<string, string>[] }).tree) {
        next.set(
          entry['path']!,
          entry['content'] ?? files.get(entry['sha']!.slice('sha:'.length)) ?? '',
        );
      }
      trees.set(`t${trees.size + 1}`, next);
      return json(201, { sha: `t${trees.size}` });
    }
    if (method === 'POST' && what === 'git/commits') {
      const made = sent as { tree: string; message: string };
      return json(201, { sha: `commit:${made.tree}`, message: made.message });
    }
    if (method === 'PATCH' && what === 'git/refs/heads/main') {
      const sha = (sent as { sha: string }).sha;
      repo.files = trees.get(sha.slice('commit:'.length))!;
      repo.commits.push(sha);
      return json(200, { object: { sha } });
    }
    return json(500, { message: `the fake has no ${call}` });
  }) as typeof fetch;

  return { fetchImpl, repos, calls, broken };
}

const R = '/repos/numen-games-nwos-orgs';
const refusal = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OrgRepoError) return error.words;
    throw error;
  }
  throw new Error('expected a refusal');
};

describe('parseOrgRepoEnv: fail closed, never echoing a value', () => {
  it('reads the five variables', () => {
    expect(env).toMatchObject({
      appId: '5846730',
      installationId: '183988580',
      owner: 'numen-games-nwos-orgs',
      template: 'nwos-workspace-template',
    });
    expect(env.privateKey).toContain('BEGIN PRIVATE KEY');
  });

  it('names every variable that is missing or out of shape, and never the key', () => {
    const secret = `-----BEGIN RSA PRIVATE KEY-----\n${'A'.repeat(200)}\n-----END RSA PRIVATE KEY-----`;
    let message = '';
    try {
      parseOrgRepoEnv({
        ORG_REPO_APP_ID: 'abc',
        ORG_REPO_OWNER: 'a/b',
        ORG_REPO_TEMPLATE: '',
        ORG_REPO_APP_PRIVATE_KEY: secret,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(OrgRepoConfigError);
      message = (error as Error).message;
    }
    expect(message).toContain('ORG_REPO_APP_ID must be a number');
    expect(message).toContain('ORG_REPO_INSTALLATION_ID: ');
    expect(message).toContain('ORG_REPO_OWNER must be a GitHub name');
    expect(message).toContain('ORG_REPO_TEMPLATE must be a GitHub name');
    expect(message).toContain('ORG_REPO_APP_PRIVATE_KEY must be a PKCS#8 PEM');
    expect(message).not.toContain('AAAA');
  });
});

describe('the App’s pen', () => {
  it('signs a JWT GitHub can verify, valid from a minute ago for nine more', async () => {
    const jwt = await appJwt(env, NOW);
    const [head, body, signature] = jwt.split('.') as [string, string, string];
    const decode = (part: string) => Buffer.from(part, 'base64url');
    expect(JSON.parse(decode(head).toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    const seconds = NOW.getTime() / 1000;
    expect(JSON.parse(decode(body).toString())).toEqual({
      iat: seconds - 60,
      exp: seconds + 540,
      iss: '5846730',
    });
    expect(await verifies(decode(signature), `${head}.${body}`)).toBe(true);
  });

  it('refuses a key it cannot read, in words that do not carry it', async () => {
    const bad = { ...env, privateKey: env.privateKey.replace(/[A-Za-z0-9+/]{40}/, '!'.repeat(40)) };
    expect(await refusal(appJwt(bad, NOW))).toMatch(/could not be read/);
    const garbage = { ...env, privateKey: pem(new Uint8Array(200).buffer) };
    expect(await refusal(appJwt(garbage, NOW))).toMatch(/could not be read/);
  });

  it('buys a whole token, or one cut down to a repository and its permissions', async () => {
    const hub = github();
    expect(await installationToken(env, hub.fetchImpl, NOW)).toBe('ghs_test');
    const seen: unknown[] = [];
    const spy = (async (url: string, init: RequestInit) => {
      seen.push(JSON.parse(String(init.body)));
      return hub.fetchImpl(url, init);
    }) as typeof fetch;
    await installationToken(env, spy, NOW);
    await installationToken(env, spy, NOW, {
      repository: 'org-vic',
      permissions: { contents: 'write' },
    });
    expect(seen).toEqual([{}, { repositories: ['org-vic'], permissions: { contents: 'write' } }]);
  });

  it('says so when GitHub refuses the token or sends none', async () => {
    const hub = github();
    const call = 'POST /app/installations/183988580/access_tokens';
    hub.broken.set(call, { status: 401, json: { message: 'bad' } });
    expect(await refusal(installationToken(env, hub.fetchImpl, NOW))).toBe(
      'GitHub answered 401 to: a token for the GitHub App',
    );
    hub.broken.set(call, { status: 201, json: { token: '' } });
    expect(await refusal(installationToken(env, hub.fetchImpl, NOW))).toBe(
      'GitHub gave no token for the GitHub App',
    );
  });

  it('turns a dead network into words, and an answer without JSON into its status', async () => {
    const dead = (() => Promise.reject(new Error('socket'))) as unknown as typeof fetch;
    expect(await refusal(ask(dead, 't', 'GET', '/x'))).toBe('GitHub did not answer (GET /x)');
    const empty = (() => Promise.resolve(new Response(null, { status: 204 }))) as typeof fetch;
    expect(await ask(empty, 't', 'GET', '/x')).toEqual({ status: 204, json: null });
  });

  it('reads a field of an answer as untrusted', () => {
    expect(field({ a: { b: 1 } }, 'a', 'b')).toBe(1);
    expect(field({ a: null }, 'a', 'b')).toBeUndefined();
    expect(field('text', 'a')).toBeUndefined();
  });
});

describe('the template’s contract', () => {
  it('reads what is stripped and what becomes the LICENSE', () => {
    const spec = parseMouldSpec(REUSE);
    expect(spec).toEqual({
      strip: ['LICENSE', 'LICENSES', 'REUSE.toml', 'TRADEMARKS.md', 'tests', '.github'],
      renameFrom: 'LICENSE.client',
      renameTo: 'LICENSE',
    });
    expect(stripped(spec!, 'LICENSES/MIT.txt')).toBe(true);
    expect(stripped(spec!, 'LICENSE')).toBe(true);
    expect(stripped(spec!, 'LICENSE.client')).toBe(false);
    expect(stripped(spec!, 'testsuite/a')).toBe(false);
  });

  it('is null for a contract it cannot read, never a guess', () => {
    expect(parseMouldSpec('version = 1')).toBeNull();
    expect(
      parseMouldSpec('# Renamed by x:\n#  a -> b\n# Mould-only artifacts, stripped by x:\n#  c'),
    ).toBeNull();
    expect(
      parseMouldSpec('# Mould-only artifacts, stripped by x:\n#\n# Renamed by x:\n#  a -> b'),
    ).toBeNull();
    expect(
      parseMouldSpec('# Mould-only artifacts, stripped by x:\n#  c\n# Renamed by x:\n#  a to b'),
    ).toBeNull();
    expect(
      parseMouldSpec('# Mould-only artifacts, stripped by x:\n#  c\n# Renamed by x:'),
    ).toBeNull();
    expect(
      parseMouldSpec('# Mould-only artifacts, stripped by x:\n#  c\n# Renamed by x:\n#  a -> a'),
    ).toBeNull();
    // The file that becomes the LICENSE is never among what is stripped.
    expect(
      parseMouldSpec('# Mould-only artifacts, stripped by x:\n#  a, c\n# Renamed by x:\n#  a -> b')
        ?.strip,
    ).toEqual(['c']);
  });

  it('makes a name safe to write, or null when nothing is left', () => {
    expect(safeTitle('  València   Innovation\nCapital ')).toBe('València Innovation Capital');
    expect(safeTitle('<script>{{X}}</script> & "Co"')).toBe('script X /script Co');
    expect(safeTitle('x'.repeat(200))).toHaveLength(80);
    expect(safeTitle(' \u0000<> ')).toBeNull();
  });

  it('resolves the placeholders it knows and leaves the rest', () => {
    expect(
      personalize(
        '{{COMPANY_NAME}} {{COMPANY_SLUG}} {{DEPLOY_DATE}} {{DATE}} {{RESPONSIBLE_EMAIL}} {{MISSION}}',
        {
          title: 'VIC',
          slug: 'org-vic',
          date: '2026-11-20',
        },
      ),
    ).toBe('VIC org-vic 2026-11-20 2026-11-20 not recorded in this repository {{MISSION}}');
  });

  it('refuses to build a tree without the licence', () => {
    expect(() => installTree([], parseMouldSpec(REUSE)!, new Map())).toThrow(
      'LICENSE.client was not personalized',
    );
  });
});

describe('repositoryNameOf', () => {
  it('is org- and the community’s id, or null', () => {
    expect(repositoryNameOf('vic')).toBe('org-vic');
    expect(repositoryNameOf('city-of-mesa')).toBe('org-city-of-mesa');
    for (const id of ['', '-vic', 'VIC', 'a/b', 'a'.repeat(64)]) {
      expect(repositoryNameOf(id)).toBeNull();
    }
  });
});

describe('provisionRepository', () => {
  const make = (hub: ReturnType<typeof github>, name = 'org-vic', title = 'VIC <València>') =>
    provisionRepository({ env, fetchImpl: hub.fetchImpl, now: NOW }, name, title);

  it('makes a private repository from the template and makes it the organization’s own, in one commit', async () => {
    const hub = github();
    expect(await make(hub)).toEqual({ state: 'ready', name: 'org-vic', id: 101 });
    const repo = hub.repos.get('org-vic')!;
    expect(repo.private).toBe(true);
    expect(repo.topics).toEqual([ORGANIZATION_TOPIC]);
    expect(repo.commits).toHaveLength(2);
    expect(Object.fromEntries(repo.files!)).toEqual({
      LICENSE: 'Copyright (c) 2026-11-20 VIC València. All rights reserved.',
      'README.md':
        '# VIC València\nOracle: not recorded in this repository · level {{AUTONOMY_LEVEL}}',
      'CHANGELOG.md': '## [0.1.0] — 2026-11-20',
      'agents/_template/SOUL.md': '# SOUL — {{AGENT_NAME}} {{DATE}}',
      'worlds/README.md': 'worlds of {{COMPANY_SLUG}}',
    });
    expect(hub.calls.filter((call) => call.endsWith('/generate'))).toEqual([
      `POST ${R}/nwos-workspace-template/generate`,
    ]);
  });

  it('links the same repository when asked again: no second repository, no second commit', async () => {
    const hub = github();
    await make(hub);
    hub.calls.length = 0;
    expect(await make(hub)).toEqual({ state: 'ready', name: 'org-vic', id: 101 });
    expect(hub.repos.size).toBe(1);
    expect(hub.repos.get('org-vic')!.commits).toHaveLength(2);
    expect(hub.calls.some((call) => call.startsWith('POST /repos'))).toBe(false);
  });

  it('answers creating while GitHub is still copying, and finishes on a later call', async () => {
    const hub = github({ copying: true });
    expect(await make(hub)).toEqual({ state: 'creating', name: 'org-vic', id: 101 });
    hub.repos.get('org-vic')!.files = new Map(Object.entries(TEMPLATE_FILES));
    expect(await make(hub)).toEqual({ state: 'ready', name: 'org-vic', id: 101 });
    expect(hub.repos.size).toBe(1);
  });

  it('answers creating when the branch moved meanwhile, losing nothing', async () => {
    const hub = github();
    hub.broken.set(`PATCH ${R}/org-vic/git/refs/heads/main`, { status: 422 });
    expect((await make(hub)).state).toBe('creating');
    hub.broken.clear();
    expect((await make(hub)).state).toBe('ready');
  });

  it('never touches a repository that is not ours', async () => {
    const hub = github();
    const stranger = (over: Partial<Repo>): Repo => ({
      id: 7,
      private: true,
      template: 'nwos-workspace-template',
      topics: [],
      files: new Map(Object.entries(TEMPLATE_FILES)),
      commits: ['c0'],
      ...over,
    });
    hub.repos.set('org-acme', stranger({ template: null }));
    expect(await refusal(make(hub, 'org-acme'))).toBe(
      'org-acme exists and was not made from the template: it is left untouched',
    );
    hub.repos.set('org-other', stranger({ template: 'another-template' }));
    expect(await refusal(make(hub, 'org-other'))).toMatch(/was not made from the template/);
    hub.repos.set('org-open', stranger({ private: false }));
    expect(await refusal(make(hub, 'org-open'))).toBe(
      'org-open is not private: it is left untouched',
    );
    for (const repo of hub.repos.values()) {
      expect(repo.commits).toEqual(['c0']);
      expect(repo.topics).toEqual([]);
    }
    // A name taken by a repository the App cannot even see.
    hub.broken.set(`POST ${R}/nwos-workspace-template/generate`, { status: 422 });
    expect(await refusal(make(hub, 'org-hidden'))).toBe(
      'the name org-hidden is taken in GitHub by a repository that is not ours',
    );
  });

  it('refuses a name or a title out of shape before asking GitHub anything', async () => {
    const hub = github();
    for (const name of ['vic', 'org-', 'org-VIC', 'org-a/b', 'nwos-workspace-template']) {
      expect(await refusal(make(hub, name))).toMatch(/must be org-/);
    }
    const self = { ...env, template: 'org-template' };
    expect(
      await refusal(
        provisionRepository({ env: self, fetchImpl: hub.fetchImpl, now: NOW }, 'org-template', 'T'),
      ),
    ).toMatch(/must be org-/);
    expect(await refusal(make(hub, 'org-vic', ' <> '))).toBe(
      'the organization has no name that can be written',
    );
    expect(hub.calls).toEqual([]);
  });

  it('stops, changing nothing, when the template does not declare its licence', async () => {
    const hub = github();
    const seed = (files: Record<string, string>) => {
      hub.repos.set('org-vic', {
        id: 9,
        private: true,
        template: 'nwos-workspace-template',
        topics: [],
        files: new Map(Object.entries(files)),
        commits: ['c0'],
      });
    };
    seed({ 'REUSE.toml': 'version = 1', 'LICENSE.client': 'x' });
    expect(await refusal(make(hub))).toBe(
      'the template does not declare its licence files: nothing was changed',
    );
    seed({ 'REUSE.toml': REUSE });
    expect(await refusal(make(hub))).toBe('the template lacks LICENSE.client: nothing was changed');
    seed({ 'README.md': 'x' });
    expect(await refusal(make(hub))).toBe(
      'org-vic has neither the template’s contract nor a LICENSE',
    );
    expect(hub.repos.get('org-vic')!.commits).toEqual(['c0']);
  });

  it('puts every failure of GitHub’s in words, with what was being done', async () => {
    const cases: readonly [string, { status: number; json?: unknown }, RegExp | string][] = [
      [`GET ${R}/org-vic`, { status: 500 }, 'GitHub answered 500 to: read org-vic'],
      [
        `POST ${R}/nwos-workspace-template/generate`,
        { status: 403 },
        'GitHub answered 403 to: make org-vic from the template',
      ],
      [
        `POST ${R}/nwos-workspace-template/generate`,
        { status: 201, json: { id: 'x' } },
        'GitHub described org-vic in a shape that cannot be read',
      ],
      [`PUT ${R}/org-vic/topics`, { status: 404 }, 'GitHub answered 404 to: mark org-vic'],
      [
        `GET ${R}/org-vic/git/ref/heads/main`,
        { status: 500 },
        'GitHub answered 500 to: read the branch of org-vic',
      ],
      [
        `GET ${R}/org-vic/git/commits/c0`,
        { status: 200, json: {} },
        'the last commit of org-vic has no tree',
      ],
      [
        `GET ${R}/org-vic/git/trees/t0?recursive=1`,
        { status: 200, json: { tree: [], truncated: true } },
        'GitHub listed the repository in a shape that cannot be read',
      ],
      [
        `GET ${R}/org-vic/git/trees/t0?recursive=1`,
        { status: 200, json: { tree: 'no' } },
        'GitHub listed the repository in a shape that cannot be read',
      ],
      [
        `GET ${R}/org-vic/git/blobs/sha:REUSE.toml`,
        { status: 200, json: { content: 7 } },
        'REUSE.toml of org-vic cannot be read',
      ],
      [
        `GET ${R}/org-vic/git/blobs/sha:README.md`,
        { status: 200, json: { content: '***' } },
        'README.md of org-vic cannot be read',
      ],
      [
        `POST ${R}/org-vic/git/trees`,
        { status: 422 },
        'GitHub answered 422 to: write the files of org-vic',
      ],
      [
        `POST ${R}/org-vic/git/commits`,
        { status: 500 },
        'GitHub answered 500 to: commit the files of org-vic',
      ],
      [
        `PATCH ${R}/org-vic/git/refs/heads/main`,
        { status: 403 },
        'GitHub answered 403 to: publish the files of org-vic',
      ],
    ];
    for (const [call, fault, words] of cases) {
      const hub = github();
      hub.broken.set(call, fault);
      expect(await refusal(make(hub)), call).toEqual(words);
    }
  });

  it('carries GitHub’s status on the error', async () => {
    const hub = github();
    hub.broken.set(`PUT ${R}/org-vic/topics`, { status: 403 });
    await expect(make(hub)).rejects.toMatchObject({ name: 'OrgRepoError', status: 403 });
  });
});
