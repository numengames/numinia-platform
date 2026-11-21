/**
 * Which addresses a browser may be sent to for a world: https, and — only
 * for a self-hosted install whose engine runs on the same machine
 * (lib/local-worlds.ts) — plain http to the machine's own loopback. Pure
 * and env-free, so an island can import it; the server only ever builds a
 * loopback address when its own configuration asks for one.
 */

/** The start of a loopback origin: `http://127.0.0.1`, `http://localhost` or `http://[::1]`, with an optional port. */
export const LOOPBACK_ORIGIN_SOURCE = String.raw`http://(?:127\.0\.0\.1|localhost|\[::1\])(?::[0-9]{1,5})?`;

const LOOPBACK_ADDRESS = new RegExp(`^${LOOPBACK_ORIGIN_SOURCE}(?:/[^\\s]*)?$`);

/** An address a browser may be sent to: https, or http to this machine's own loopback. */
export const isWorldAddress = (value: unknown): value is string =>
  typeof value === 'string' && (/^https:\/\/[^\s]+$/.test(value) || LOOPBACK_ADDRESS.test(value));
