/**
 * The SIWE domain must be the host the citizen's browser shows, or wallets
 * flag the signature request as phishing — this is what broke login on
 * numinia.com while the domain was hardcoded to numinia.store. The domain
 * follows the request Host, but only through an allowlist: an arbitrary
 * Host header must never reach the message a wallet asks a human to sign.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('THIRDWEB_SECRET_KEY', 'x'.repeat(40));
  vi.stubEnv('AUTH_SESSION_SECRET', 'y'.repeat(40));
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveAuthDomain', () => {
  it('returns every public production host verbatim', async () => {
    const { resolveAuthDomain } = await import('../auth/server');
    for (const host of ['numinia.com', 'www.numinia.com', 'numinia.store', 'www.numinia.store']) {
      expect(resolveAuthDomain(host, false)).toBe(host);
    }
  });

  it('allows local hosts in dev only', async () => {
    const { resolveAuthDomain, AuthDomainError } = await import('../auth/server');
    expect(resolveAuthDomain('localhost:4321', true)).toBe('localhost:4321');
    expect(resolveAuthDomain('127.0.0.1:4321', true)).toBe('127.0.0.1:4321');
    expect(() => resolveAuthDomain('localhost:4321', false)).toThrow(AuthDomainError);
    expect(() => resolveAuthDomain('127.0.0.1:4321', false)).toThrow(AuthDomainError);
  });

  it('allows loopback hosts in a non-dev build when the loopback flag is on', async () => {
    const { resolveAuthDomain } = await import('../auth/server');
    for (const host of ['127.0.0.1:4321', 'localhost:4321', '127.0.0.1', 'localhost']) {
      expect(resolveAuthDomain(host, false, true)).toBe(host);
    }
  });

  it('still rejects loopback hosts in a non-dev build when the flag is off', async () => {
    const { resolveAuthDomain, AuthDomainError } = await import('../auth/server');
    expect(() => resolveAuthDomain('127.0.0.1:4321', false, false)).toThrow(AuthDomainError);
    expect(() => resolveAuthDomain('localhost:4321', false, false)).toThrow(AuthDomainError);
  });

  it('keeps every other host out even with the loopback flag on', async () => {
    const { resolveAuthDomain, AuthDomainError } = await import('../auth/server');
    for (const host of [
      'evil.com',
      '127.0.0.1.evil.com',
      'evil.com:4321',
      'foo.localhost:4321',
      '127.0.0.2:4321',
      '',
    ]) {
      expect(() => resolveAuthDomain(host, false, true)).toThrow(AuthDomainError);
    }
  });

  it('reads the flag from the runtime env: only the exact string "true" turns it on', async () => {
    const { loopbackAuthEnabled } = await import('../auth/server');
    expect(loopbackAuthEnabled()).toBe(false);
    for (const value of ['1', 'TRUE', 'yes', '']) {
      vi.stubEnv('AUTH_LOOPBACK_HOSTS', value);
      expect(loopbackAuthEnabled()).toBe(false);
    }
    vi.stubEnv('AUTH_LOOPBACK_HOSTS', 'true');
    expect(loopbackAuthEnabled()).toBe(true);
  });

  it('resolves loopback from the env flag by default, in a non-dev call', async () => {
    const { resolveAuthDomain, AuthDomainError } = await import('../auth/server');
    expect(() => resolveAuthDomain('127.0.0.1:4321', false)).toThrow(AuthDomainError);
    vi.stubEnv('AUTH_LOOPBACK_HOSTS', 'true');
    expect(resolveAuthDomain('127.0.0.1:4321', false)).toBe('127.0.0.1:4321');
  });

  it('fails closed on any host outside the allowlist', async () => {
    const { resolveAuthDomain, AuthDomainError } = await import('../auth/server');
    for (const host of [
      'evil.example',
      'numinia.com.evil.io', // suffix spoof
      'foo.numinia.com', // unknown subdomain
      'numinia.com:8443', // unexpected port
      '',
    ]) {
      expect(() => resolveAuthDomain(host, false)).toThrow(AuthDomainError);
      expect(() => resolveAuthDomain(host, true)).toThrow(AuthDomainError);
    }
  });

  it('names the rejected host in the error, for honest 400s', async () => {
    const { resolveAuthDomain } = await import('../auth/server');
    expect(() => resolveAuthDomain('evil.example', false)).toThrow(/evil\.example/);
  });
});
