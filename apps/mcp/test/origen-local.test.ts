/**
 * The relay on loopback (a self-hosted copy of numinia.com, the local twin).
 * `RELAY_LOOPBACK_ORIGIN` is a runtime var, accepted only when it is a bare
 * origin whose host is 127.0.0.1 or localhost; absent, malformed or any
 * other host, the relay is exactly https://mcp.numinia.com. With it, the
 * issuer, the resource, the audience of every token and the way back from
 * the consent are that origin, and `STORE_ORIGIN` may be a loopback http
 * origin too. The whole OAuth flow runs here against a fake local store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLimitsForTests } from '../src/limites';
import { MCP_PATH, ORIGIN } from '../src/config';
import { relayOrigin, relayResource, storeOrigin, type Env } from '../src/env';
import { vueltaUrl } from '../src/handoff';
import { toBase64Url } from '../src/seal';
import worker, { HandOffDesk } from '../src/worker';
import { MemoryKv } from './memory-kv';

const LOCAL = 'http://127.0.0.1:4326';
const LOCAL_STORE = 'http://127.0.0.1:4321';
const CALLBACK = 'http://127.0.0.1:8123/callback';
const ORG = 'acc_team_numen_games';
const AGENT = 'claude-local';
const TOKEN = `ntk_${'Lq7'.repeat(14)}x`;

const ctx = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
} as unknown as ExecutionContext;

const base = (over: Partial<Env> = {}): Env => ({
  OAUTH_KV: new MemoryKv().asNamespace(),
  STORE_ORIGIN: LOCAL_STORE,
  RELAY_LOOPBACK_ORIGIN: LOCAL,
  ...over,
});

describe('relayOrigin', () => {
  it('is the production origin when the var is absent', () => {
    expect(relayOrigin({ OAUTH_KV: base().OAUTH_KV })).toBe(ORIGIN);
    expect(relayResource({ OAUTH_KV: base().OAUTH_KV })).toBe(`${ORIGIN}${MCP_PATH}`);
  });

  it.each([
    'http://127.0.0.1:4326',
    'http://127.0.0.1',
    'http://localhost:4326',
    'https://localhost:4326',
    'https://127.0.0.1:8443',
  ])('takes the loopback origin %s', (value) => {
    const env = base({ RELAY_LOOPBACK_ORIGIN: value });
    expect(relayOrigin(env)).toBe(value);
    expect(relayResource(env)).toBe(`${value}${MCP_PATH}`);
  });

  it.each([
    '',
    'nonsense',
    'https://evil.com',
    'https://mcp.numinia.com',
    'http://numinia.com',
    'http://127.0.0.1.evil.com',
    'http://127.0.0.2:4326',
    'http://foo.localhost:4326',
    'http://localhost.evil.com',
    'http://[::1]:4326',
    'http://0.0.0.0:4326',
    'http://127.0.0.1:4326/',
    'http://127.0.0.1:4326/mcp',
    'http://127.0.0.1:4326?x=1',
    'http://user@127.0.0.1:4326',
    'ftp://127.0.0.1:4326',
    'HTTP://127.0.0.1:4326',
  ])('ignores %j and stays the production origin', (value) => {
    const env = base({ RELAY_LOOPBACK_ORIGIN: value });
    expect(relayOrigin(env)).toBe(ORIGIN);
    expect(relayResource(env)).toBe(`${ORIGIN}${MCP_PATH}`);
  });
});

describe('storeOrigin', () => {
  it('still takes a bare https origin and refuses any other http one', () => {
    expect(storeOrigin(base({ STORE_ORIGIN: 'https://numinia.com' }))).toBe('https://numinia.com');
    for (const value of [
      'http://numinia.com',
      'http://evil.com:4321',
      'http://127.0.0.1.evil.com',
    ]) {
      expect(storeOrigin(base({ STORE_ORIGIN: value }))).toBeNull();
    }
  });

  it('takes a bare loopback http origin (the local twin), nothing more', () => {
    expect(storeOrigin(base({ STORE_ORIGIN: 'http://127.0.0.1:4321' }))).toBe(LOCAL_STORE);
    expect(storeOrigin(base({ STORE_ORIGIN: 'http://localhost:4321' }))).toBe(
      'http://localhost:4321',
    );
    for (const value of [
      'http://127.0.0.1:4321/',
      'http://127.0.0.1:4321/x',
      'http://user@127.0.0.1:4321',
      'http://127.0.0.2:4321',
      'http://[::1]:4321',
    ]) {
      expect(storeOrigin(base({ STORE_ORIGIN: value }))).toBeNull();
    }
  });
});

describe('the OAuth flow on loopback', () => {
  let env: Env;
  let storeCalls: string[];

  async function fakeStore(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(input instanceof Request ? input.url : String(input));
    storeCalls.push(url.href);
    const authorization = new Headers(init?.headers).get('Authorization');
    if (
      url.origin !== LOCAL_STORE ||
      url.pathname !== '/api/agents/me' ||
      authorization !== `Bearer ${TOKEN}`
    ) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    return Response.json({
      org: ORG,
      id: AGENT,
      name: 'Claude local',
      enabled: true,
      state: 'activa',
      eligible: true,
      permissions: ['enter-worlds'],
      worlds: [],
    });
  }

  beforeEach(() => {
    resetLimitsForTests();
    storeCalls = [];
    env = base();
    vi.stubGlobal('fetch', vi.fn(fakeStore));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const call = (path: string, init?: RequestInit, over: Env = env): Promise<Response> =>
    worker.fetch(new Request(`${LOCAL}${path}`, init), over, ctx);

  async function json(response: Response): Promise<Record<string, unknown>> {
    return (await response.json()) as Record<string, unknown>;
  }

  it('publishes the loopback origin as issuer, endpoints and resource', async () => {
    const server = await json(await call('/.well-known/oauth-authorization-server'));
    expect(server.issuer).toBe(LOCAL);
    expect(server.authorization_endpoint).toBe(`${LOCAL}/authorize`);
    expect(server.token_endpoint).toBe(`${LOCAL}/token`);
    expect(server.registration_endpoint).toBe(`${LOCAL}/register`);
    expect(server.protected_resources).toEqual([`${LOCAL}/mcp`]);

    const resource = await json(await call('/.well-known/oauth-protected-resource/mcp'));
    expect(resource.resource).toBe(`${LOCAL}/mcp`);
    expect(resource.authorization_servers).toEqual([LOCAL]);
  });

  it('serves the production origin to a request for it when the var is absent', async () => {
    const bare: Env = { OAUTH_KV: env.OAUTH_KV, STORE_ORIGIN: LOCAL_STORE };
    const response = await worker.fetch(
      new Request(`${ORIGIN}/.well-known/oauth-authorization-server`),
      bare,
      ctx,
    );
    expect((await json(response)).issuer).toBe(ORIGIN);
    const refused = await worker.fetch(
      new Request(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`),
      base({ RELAY_LOOPBACK_ORIGIN: 'https://evil.com' }),
      ctx,
    );
    expect((await json(refused)).resource).toBe(`${ORIGIN}/mcp`);
  });

  it('runs register → authorize → consent → hand-off → vuelta → token → tool call', async () => {
    const registered = await call('/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Local MCP client',
        redirect_uris: [CALLBACK],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    });
    expect(registered.status).toBe(201);
    const clientId = String((await json(registered)).client_id);

    const verifier = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: CALLBACK,
      scope: 'mundos',
      state: 's-1',
      code_challenge: toBase64Url(digest),
      code_challenge_method: 'S256',
      resource: `${LOCAL}/mcp`,
    });
    const authorize = await call(`/authorize?${query.toString()}`);
    expect(authorize.status).toBe(302);
    const consent = new URL(authorize.headers.get('Location') ?? '');
    // The consent page is the local site's, never numinia.com's.
    expect(`${consent.origin}${consent.pathname}`).toBe(`${LOCAL_STORE}/conectar-ia/`);
    const req = consent.searchParams.get('req') ?? '';
    const cookie = (authorize.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';

    const desk = new HandOffDesk(ctx, env);
    expect(await desk.ask(req)).toMatchObject({ ok: true, app: 'Local MCP client' });
    const kept = await desk.keep({
      req,
      accountId: ORG,
      agentId: AGENT,
      via: 'mcp:127.0.0.1',
      hear: false,
      token: TOKEN,
    });
    expect(kept).toEqual({ ok: true, next: `${LOCAL}/vuelta?req=${req}` });
    expect(vueltaUrl(LOCAL, req)).toBe(`${LOCAL}/vuelta?req=${req}`);

    const back = await call(`/vuelta?req=${req}`, { headers: { Cookie: cookie } });
    expect(back.status).toBe(302);
    const to = new URL(back.headers.get('Location') ?? '');
    expect(to.origin + to.pathname).toBe(CALLBACK);
    expect(to.searchParams.get('iss')).toBe(LOCAL);
    // The relay asked the local store, and only it.
    expect(storeCalls).toEqual([`${LOCAL_STORE}/api/agents/me?org=${ORG}&agent=${AGENT}`]);

    const issued = await call('/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: to.searchParams.get('code') ?? '',
        redirect_uri: CALLBACK,
        client_id: clientId,
        code_verifier: verifier,
        resource: `${LOCAL}/mcp`,
      }).toString(),
    });
    expect(issued.status).toBe(200);
    const tokens = await json(issued);

    const listed = await call('/mcp', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${String(tokens.access_token)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'quien_soy' },
      }),
    });
    expect(listed.status).toBe(200);
    const who = (await json(listed)) as { result: { structuredContent: Record<string, unknown> } };
    expect(who.result.structuredContent).toMatchObject({ id: `${ORG}.${AGENT}` });
  });

  it('answers a request without a token with the loopback resource metadata', async () => {
    const response = await call('/mcp', { method: 'POST', body: '{}' });
    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toContain(
      `resource_metadata="${LOCAL}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  it('binds a pasted panel token to the loopback resource', async () => {
    const response = await call('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    expect(response.status).toBe(200);
    // The same token against the production resource's origin is not this relay's.
    const elsewhere = await worker.fetch(
      new Request(`${ORIGIN}/mcp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      }),
      env,
      ctx,
    );
    expect(elsewhere.status).toBe(401);
  });
});
