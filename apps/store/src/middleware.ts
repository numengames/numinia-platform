/**
 * Worker middleware (MISSION-021/025): every SSR response leaves with the
 * security walls up, every API request leaves a structured log line, and an
 * unhandled error becomes ONE honest 500 + one 'error' event instead of a
 * silent stack in the void. Static assets never reach this code.
 */

import { defineMiddleware } from 'astro:middleware';
import { applyScriptHashes, loadScriptHashes } from './lib/csp-inline';
import type { AssetFetcher } from './lib/csp-inline';
import { doorman } from './lib/rate-limit';
import { primeFromWorkerd, runtimeBinding } from './lib/runtime-env';
import { capMessage, logEvent } from './lib/telemetry';

/* MISSION-025 + security hardening (2026-10-18): the walls. Static pages get
   these via public/_headers (the assets layer serves them before the
   Worker); SSR responses get them here. The pages where a wallet signs keep
   a relaxed connect/frame set: wallet SDKs talk to vendor hosts and
   user-configured RPCs that no allowlist survives. Those are the login, the
   worlds room, where an Oracle signs each request to a fleet machine, and
   Saldo's members tab, where giving «Administrador» or «Gestionar roles» is
   signed again (STD-051 ORG-008).
   `script-src` lists the SHA-256 of each inline script instead of allowing
   all inline code (MIS-269). The list comes from the final build output
   (lib/csp-inline.ts): a first attempt hashed the sources and missed what
   the Cloudflare bundler emitted, and one wrong hash blocked the sign-in
   (2026-10-18). Here the placeholder is filled from /csp-script-hashes.json,
   the file the build leaves in the assets; if it cannot be read the policy
   falls back to 'unsafe-inline' and says so in the log, so a page never
   goes dark for a missing file.
   `style-src` allows the one inline <style> the pages carry (the island
   runtime's `display: contents`) by its hash and no style attribute: the
   markup has none. The feature builds the site and fails if a built page
   carries a <style> the policy does not list.
   `connect-src` drops the open `https:` too: the client never
   fetches an external host directly — every chain/CDN binary goes through
   the same-origin `/api/media` proxy (src/lib/media-proxy.ts) precisely so
   pages never need that allowance; `blob:` stays for three.js's
   GLB-embedded-texture fetches (connect-src governs fetch, not img-src —
   learned live, v0.38.1). The relaxed CSP_SESSION keeps `https:` because a
   wallet SDK's RPC host is the user's own choice, not ours to allowlist. */
const CSP_STRICT = [
  "default-src 'self'",
  "script-src 'self' {{INLINE_SCRIPT_HASHES}}",
  "style-src 'self' 'sha256-vv9IoKo7BSLbWcUHr3tNmfNVmm5L/9Cfn2H6LMk7/ow='",
  "img-src 'self' data: blob: https:",
  "media-src 'self' https:",
  "font-src 'self'",
  "connect-src 'self' blob:",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');
const CSP_SESSION =
  CSP_STRICT.replace("connect-src 'self' blob:", "connect-src 'self' blob: https: wss:") +
  '; frame-src https:';

function isSessionPath(pathname: string): boolean {
  // One door only: /spike/auth was retired with MIS-078 — the login lives in
  // the LAP, and a second copy of it was a second surface to keep AA. The
  // worlds room and the organization panel's people screens (Miembros and
  // Roles: giving «Administrador» asks the wallet to sign) sign with the same
  // wallet, so they get the same walls. Saldo's old members address only
  // sends on now, and keeps the strict ones.
  return /^\/(es\/|ja\/|ko\/|pt-br\/)?(lap\/(session|admin\/worlds)|panel\/(miembros|roles))/.test(
    pathname,
  );
}

export function securityHeaders(
  pathname: string,
  contentType: string | null,
  scriptHashes: readonly string[] | null = null,
): Record<string, string> {
  const headers: Record<string, string> = {
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  };
  if (contentType?.includes('text/html')) {
    headers['content-security-policy'] = applyScriptHashes(
      isSessionPath(pathname) ? CSP_SESSION : CSP_STRICT,
      scriptHashes,
    );
  }
  return headers;
}

/** The build's inline-script list, read once per isolate (a failed read is retried, never cached). */
let scriptHashes: readonly string[] | null = null;
let warnedNoHashes = false;
async function currentScriptHashes(origin: string): Promise<readonly string[] | null> {
  if (scriptHashes !== null) return scriptHashes;
  scriptHashes = await loadScriptHashes(
    runtimeBinding('ASSETS') as AssetFetcher | undefined,
    origin,
  );
  if (scriptHashes === null && !warnedNoHashes) {
    warnedNoHashes = true;
    logEvent({ level: 'warn', kind: 'csp-script-hashes-unavailable' });
  }
  return scriptHashes;
}

export const onRequest = defineMiddleware(async (context, next) => {
  // Cloudflare: vars and secrets only exist on cloudflare:workers' env —
  // the bundler freezes every process.env expression (lib/runtime-env.ts).
  await primeFromWorkerd();
  const started = Date.now();
  const { pathname } = context.url;
  const method = context.request.method;
  // MISSION-026: the doorman (lib/rate-limit.ts, its rules there too). The
  // relay's calls for an AI are counted per agent by their route instead.
  const verdict = doorman(method, pathname, context.request.headers);
  if (verdict !== null && !verdict.allowed) {
    logEvent({ level: 'warn', kind: 'throttled', path: pathname, rule: verdict.rule });
    return Response.json(
      { error: 'Too many requests — the doorman asks for a pause' },
      { status: 429, headers: { 'retry-after': String(verdict.retryAfterS) } },
    );
  }
  try {
    const response = await next();
    const contentType = response.headers.get('content-type');
    const hashes = contentType?.includes('text/html')
      ? await currentScriptHashes(context.url.origin)
      : null;
    for (const [name, value] of Object.entries(securityHeaders(pathname, contentType, hashes))) {
      response.headers.set(name, value);
    }
    if (pathname.startsWith('/api/')) {
      logEvent({
        level: 'info',
        kind: 'api',
        method: context.request.method,
        path: pathname,
        status: response.status,
        ms: Date.now() - started,
      });
    }
    return response;
  } catch (error) {
    logEvent({
      level: 'error',
      kind: 'unhandled',
      method: context.request.method,
      path: pathname,
      ms: Date.now() - started,
      message: capMessage(error instanceof Error ? error.message : String(error)),
      stack: capMessage(error instanceof Error ? (error.stack ?? '') : ''),
    });
    // §9.7 would demand cause+exit for humans; an API caller gets the honest
    // minimum and the cause lives in the log line above.
    return Response.json({ error: 'Internal error — logged' }, { status: 500 });
  }
});
