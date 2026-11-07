# Security Policy

## Commitments

- **Fail closed.** Missing configuration crashes at boot naming the
  variable; no auth path degrades to unverified trust.
- **No PII in telemetry.** Wallet addresses are never analytics props;
  referrers are reduced to hosts; undeclared props are rejected at runtime.
- **No secrets in git.** A secret scanner runs on every commit and `.env*`
  is ignored. If one lands: rotate first, then rewrite history before any
  push.
- **Validated boundaries.** External data (env, data-repo JSON, request
  bodies) passes Zod validation; URL classification parses hostnames.
- **Supply chain.** `npm ci` only; strong copyleft and the ConsenSys
  MetaMask SDK blocked from `dist/` by the licence gate; actions pinned.

## Known limitations (residual risk)

The site's Content-Security-Policy (`apps/store/public/_headers` for static
pages, `apps/store/src/middleware.ts` for the pages the Worker answers) is not
as strict as it could be. One directive still allows inline code:

- `style-src 'unsafe-inline'` — about forty inline `style=""` attributes
  remain in the markup, and a hash does not cover attributes. A style injected
  into a page would not be stopped by the policy; it cannot run code, which
  limits what it can do.

Inline **scripts** are not a residual risk any more (MIS-269): `script-src` is
`'self'` plus the SHA-256 of each inline script the site ships. The build
(`scripts/csp-script-hashes.mjs`) reads those scripts from the final output,
writes the list into `_headers` and into `/csp-script-hashes.json`, and the
Worker reads that file for the pages it renders itself. The list comes from
the build, never from a response, so a script injected into a page is not
on it. If the Worker cannot read the file it falls back to `'unsafe-inline'`
and logs `csp-script-hashes-unavailable`; a build that cannot seal the list
fails instead of deploying.

What holds the risk down meanwhile, and is checked by
`features/security-walls.feature`: `connect-src` is `'self' blob:` on every
page except the ones where a wallet signs (a script cannot send data to an
outside host with `fetch`), `default-src 'self'`, `object-src 'none'`,
`base-uri 'self'`, `form-action 'self'` and `frame-ancestors 'none'`.

The pages where a wallet signs (`/lap/session/`, `/lap/admin/worlds/`,
`/panel/miembros/`, `/panel/roles/`, in every locale) also open `connect-src`
to `https:` and `wss:`, because the user chooses their wallet's RPC host.

Closing the inline-style allowance needs a rewrite of the inline styles; it is
tracked apart from MIS-269. When it is removed, delete its line here: the same
feature fails if the note and the policy disagree.

## Reporting a vulnerability

Report privately through GitHub's *Report a vulnerability* on this
repository. Do not open a public issue.
