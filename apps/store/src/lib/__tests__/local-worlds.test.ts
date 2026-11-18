/**
 * A self-hosted install's own worlds (lib/local-worlds.ts, lib/world-address.ts):
 * the loopback overrides parse strictly, anything that is not the machine's
 * own loopback is ignored, and with no variable set every address is the
 * public one. The libs that build or read a world's address are checked with
 * the variables set.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { doorUrl, readMachine } from '../fleet';
import { localFleetBase, localWorldOrigins, loopbackOrigin, worldOrigin } from '../local-worlds';
import { readWorldPage, enterWorld } from '../mundos';
import { passFromAddress } from '../world-door';
import { isWorldAddress } from '../world-address';
import { worldTakesIa, forgetWorldIa } from '../world-ia';
import { worldCards } from '../world-index';
import { guestUrl, passUrl } from '../world-pass-answer';
import { answerWorld } from '../worlds-homes';
import { forgetEngineRelease, parseFace, probeWorld, readFace } from '../worlds-source';

const TOKEN = 'aaa.bbb.ccc';
const ENV = { LOCAL_WORLD_ORIGINS: 'simposio.numinia.localhost=http://127.0.0.1:8871' };

afterEach(() => {
  vi.unstubAllEnvs();
  forgetEngineRelease();
  forgetWorldIa();
});

describe('loopbackOrigin', () => {
  it('takes the machine’s own loopback over plain http, with or without a port, and drops a closing slash', () => {
    expect(loopbackOrigin('http://127.0.0.1:8871')).toBe('http://127.0.0.1:8871');
    expect(loopbackOrigin(' http://localhost:4325/ ')).toBe('http://localhost:4325');
    expect(loopbackOrigin('http://[::1]:80')).toBe('http://[::1]:80');
    expect(loopbackOrigin('http://localhost')).toBe('http://localhost');
  });

  it('refuses anything else: another host, https, a path, credentials, a look-alike or nothing', () => {
    for (const bad of [
      undefined,
      '',
      'https://127.0.0.1:8871',
      'http://example.com',
      'http://127.0.0.1.evil.com',
      'http://127.0.0.1:8871/path',
      'http://user@127.0.0.1:8871',
      'http://localhost:99999999',
      'http://192.168.1.5:8871',
    ]) {
      expect(loopbackOrigin(bad)).toBeNull();
    }
  });
});

describe('localWorldOrigins and worldOrigin', () => {
  it('maps each listed domain to its loopback origin, in any case', () => {
    const map = localWorldOrigins({
      LOCAL_WORLD_ORIGINS:
        'Simposio.numinia.localhost=http://127.0.0.1:8871, otro.numinia.localhost = http://localhost:9000/',
    });
    expect([...map]).toEqual([
      ['simposio.numinia.localhost', 'http://127.0.0.1:8871'],
      ['otro.numinia.localhost', 'http://localhost:9000'],
    ]);
  });

  it('ignores a pair that is not a domain, has no origin or points off this machine', () => {
    const map = localWorldOrigins({
      LOCAL_WORLD_ORIGINS:
        'nodomain=http://127.0.0.1:1,=http://127.0.0.1:2,sin-igual,a.b.com=https://evil.com,ok.numen.games=http://127.0.0.1:3',
    });
    expect([...map]).toEqual([['ok.numen.games', 'http://127.0.0.1:3']]);
    expect(localWorldOrigins({}).size).toBe(0);
  });

  it('answers the public https origin unless the install says otherwise', () => {
    expect(worldOrigin('simposio.numinia.localhost', {})).toBe(
      'https://simposio.numinia.localhost',
    );
    expect(worldOrigin('bosque.numen.games', ENV)).toBe('https://bosque.numen.games');
    expect(worldOrigin('Simposio.numinia.localhost', ENV)).toBe('http://127.0.0.1:8871');
  });

  it('reads the local fleet’s base from LOCAL_FLEET_URL, loopback only', () => {
    expect(localFleetBase({})).toBeNull();
    expect(localFleetBase({ LOCAL_FLEET_URL: 'http://127.0.0.1:4325' })).toBe(
      'http://127.0.0.1:4325',
    );
    expect(localFleetBase({ LOCAL_FLEET_URL: 'https://open-1.numinia.com' })).toBeNull();
  });
});

describe('isWorldAddress', () => {
  it('lets a browser go to https or to this machine’s own loopback, and nowhere else', () => {
    expect(isWorldAddress('https://bosque.numen.games/')).toBe(true);
    expect(isWorldAddress('http://127.0.0.1:8871/')).toBe(true);
    expect(isWorldAddress(`http://localhost:8871/#pass=${TOKEN}`)).toBe(true);
    expect(isWorldAddress('http://[::1]:8871')).toBe(true);
    expect(isWorldAddress('http://bosque.numen.games/')).toBe(false);
    expect(isWorldAddress('http://127.0.0.1.evil.com/')).toBe(false);
    expect(isWorldAddress('javascript:alert(1)')).toBe(false);
    expect(isWorldAddress('https://a b')).toBe(false);
    expect(isWorldAddress(42)).toBe(false);
  });
});

describe('with the install’s variables set', () => {
  it('builds the guest address and the pass address at the loopback origin', () => {
    vi.stubEnv('LOCAL_WORLD_ORIGINS', ENV.LOCAL_WORLD_ORIGINS);
    expect(guestUrl('simposio.numinia.localhost')).toBe('http://127.0.0.1:8871/');
    expect(passUrl('simposio.numinia.localhost', TOKEN)).toBe(
      `http://127.0.0.1:8871/#pass=${TOKEN}`,
    );
    expect(guestUrl('bosque.numen.games')).toBe('https://bosque.numen.games/');
  });

  it('takes the pass out of a loopback address and still refuses a plain-http public one', () => {
    expect(passFromAddress(`http://127.0.0.1:8871/#pass=${TOKEN}`)).toBe(TOKEN);
    expect(passFromAddress(`https://bosque.numen.games/#pass=${TOKEN}`)).toBe(TOKEN);
    expect(passFromAddress(`http://bosque.numen.games/#pass=${TOKEN}`)).toBeNull();
    expect(passFromAddress('http://127.0.0.1:8871/')).toBeNull();
  });

  it('lets the browser follow a loopback address the page and the pass route give', async () => {
    const page = readWorldPage({
      worldId: 'simposio',
      home: null,
      manage: false,
      url: 'http://127.0.0.1:8871/',
    });
    expect(page?.url).toBe('http://127.0.0.1:8871/');
    const fetcher = vi.fn(async () =>
      Response.json({ url: `http://127.0.0.1:8871/#pass=${TOKEN}`, pass: true }),
    );
    expect(await enterWorld(fetcher, 'simposio', null)).toBe(
      `http://127.0.0.1:8871/#pass=${TOKEN}`,
    );
  });

  it('says where a world is served on its page data', async () => {
    vi.stubEnv('LOCAL_WORLD_ORIGINS', ENV.LOCAL_WORLD_ORIGINS);
    const desk = {
      homeOf: vi.fn(async () => ({ ok: true, home: null, manage: false })),
    } as unknown as Parameters<typeof answerWorld>[0];
    const out = await answerWorld(
      desk,
      null,
      'simposio',
      new Set(['simposio']),
      () => undefined,
      new Map([['simposio', 'simposio.numinia.localhost']]),
    );
    expect(await out.json()).toMatchObject({ url: 'http://127.0.0.1:8871/' });
  });

  it('asks a world’s status and page at its loopback origin, and keeps only a picture it serves itself', async () => {
    vi.stubEnv('LOCAL_WORLD_ORIGINS', ENV.LOCAL_WORLD_ORIGINS);
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      return String(url).endsWith('/status')
        ? Response.json({ uptime: 5, conectados: 2, agentes: 1 })
        : new Response('<html><meta property="og:title" content="Simposio"></html>');
    }) as unknown as typeof fetch;
    expect((await probeWorld(fetcher, 'simposio.numinia.localhost')).ok).toBe(true);
    expect(await readFace(fetcher, 'simposio.numinia.localhost')).toMatchObject({
      title: 'Simposio',
    });
    expect(urls).toEqual(['http://127.0.0.1:8871/status', 'http://127.0.0.1:8871/']);
    const html =
      '<meta property="og:title" content="T"><meta property="og:image" content="http://127.0.0.1:8871/a/x.webp">';
    expect(parseFace(html, 'simposio.numinia.localhost').image).toBe(
      'http://127.0.0.1:8871/a/x.webp',
    );
    expect(parseFace(html, 'otro.numinia.localhost').image).toBeNull();
  });

  it('asks whether a world takes the AI block at its loopback origin', async () => {
    vi.stubEnv('LOCAL_WORLD_ORIGINS', ENV.LOCAL_WORLD_ORIGINS);
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      return Response.json({ semver: '0.107.0' });
    }) as unknown as typeof fetch;
    expect(await worldTakesIa(fetcher, 'simposio.numinia.localhost')).toBe(true);
    expect(urls).toEqual(['http://127.0.0.1:8871/status']);
  });
});

describe('the fleet’s doors and the index', () => {
  it('reads a machine at the local fleet’s door when a base is given, and at its own name otherwise', async () => {
    expect(doorUrl('open-1', 'worlds')).toBe('https://open-1.numinia.com/fleet/v1/worlds');
    expect(doorUrl('open-1', 'worlds', 'http://127.0.0.1:4325')).toBe(
      'http://127.0.0.1:4325/open-1/fleet/v1/worlds',
    );
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      return Response.json({ worlds: [] });
    }) as unknown as typeof fetch;
    const view = await readMachine(fetcher, 'open-1', 1000, 'http://127.0.0.1:4325');
    expect(view).toMatchObject({ alias: 'open-1', open: true });
    expect(urls.sort()).toEqual([
      'http://127.0.0.1:4325/open-1/fleet/v1/log',
      'http://127.0.0.1:4325/open-1/fleet/v1/machine',
      'http://127.0.0.1:4325/open-1/fleet/v1/worlds',
    ]);
  });

  it('draws a card’s address and picture from the origin the install gives each world', () => {
    const cards = worldCards({
      fleet: [{ id: 'simposio', phase: 'running', domain: 'simposio.numinia.localhost' }],
      owners: new Map([['simposio', { accountId: 'acc_ai', accountName: 'Active Inference' }]]),
      communities: [
        { id: 'active-inference', name: 'Active Inference', founder: false, accounts: ['acc_ai'] },
      ],
      faces: {
        simposio: { title: 'Simposio', image: 'http://127.0.0.1:8871/a/x.webp' },
      },
      originOf: (domain) => worldOrigin(domain, ENV),
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      url: 'http://127.0.0.1:8871/',
      cover: 'http://127.0.0.1:8871/a/x.webp',
    });
  });
});
