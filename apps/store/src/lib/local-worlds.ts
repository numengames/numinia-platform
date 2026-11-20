/**
 * A self-hosted install's own worlds: where the machine's local engine and
 * local fleet door are, instead of the public ones.
 *
 * Every world the site reaches is read at `https://<its domain>/` and the
 * fleet's machines at `https://<alias>.numinia.com/fleet/v1/`. An install
 * that runs everything on one PC (the local twin of numinia.com) has no such
 * addresses. Two optional Worker variables point them at the loopback:
 *
 *   LOCAL_WORLD_ORIGINS  `domain=origin, domain=origin` — the world whose
 *                        fleet `domain` is `simposio.numinia.localhost` is
 *                        served at `http://127.0.0.1:8871`.
 *   LOCAL_FLEET_URL      `http://127.0.0.1:4325` — the fleet's doors are read
 *                        at `<url>/<alias>/fleet/v1/…`, and the book of
 *                        worlds run by hand (public domains) is left out.
 *
 * Loopback only (`127.0.0.1`, `localhost`, `[::1]`, plain http, no path, no
 * credentials): anything else is ignored, as if the variable were not set —
 * a typo never sends a request, or a person, to another machine. Pure: the
 * caller hands in its env (lib/runtime-env.ts).
 */

import { LOOPBACK_ORIGIN_SOURCE } from './world-address';

type Env = Readonly<Record<string, string | undefined>>;

const LOOPBACK_ORIGIN = new RegExp(`^${LOOPBACK_ORIGIN_SOURCE}$`);
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/** A loopback origin without its closing slash, or null when the text is anything else. */
export function loopbackOrigin(value: string | undefined): string | null {
  const text = (value ?? '').trim().replace(/\/$/, '');
  return LOOPBACK_ORIGIN.test(text) ? text : null;
}

/** The domains that are served on this machine, each with the loopback origin of its engine. */
export function localWorldOrigins(env: Env): ReadonlyMap<string, string> {
  const origins = new Map<string, string>();
  for (const pair of (env['LOCAL_WORLD_ORIGINS'] ?? '').split(',')) {
    const cut = pair.indexOf('=');
    const host = pair.slice(0, cut).trim().toLowerCase();
    const origin = loopbackOrigin(pair.slice(cut + 1));
    if (cut > 0 && HOST.test(host) && origin !== null) origins.set(host, origin);
  }
  return origins;
}

/** Where a world is served, without a closing slash: its public `https://<host>`, or the loopback one this install gave it. */
export function worldOrigin(host: string, env: Env): string {
  return localWorldOrigins(env).get(host.toLowerCase()) ?? `https://${host}`;
}

/** Where the local fleet's doors are, or null for the public fleet. */
export function localFleetBase(env: Env): string | null {
  return loopbackOrigin(env['LOCAL_FLEET_URL']);
}
