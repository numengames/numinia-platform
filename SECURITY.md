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

## Content-Security-Policy

The policy is written twice, in `apps/store/public/_headers` for the static
pages and in `apps/store/src/middleware.ts` for the pages the Worker answers;
`features/security-walls.feature` holds the two copies to the same text.

No directive allows inline code. `script-src` is `'self'` plus the SHA-256 of
each inline script the site ships (MIS-269). The build
(`scripts/csp-script-hashes.mjs`) reads those scripts from the final output,
writes the list into `_headers` and into `/csp-script-hashes.json`, and the
Worker reads that file for the pages it renders itself. The list comes from
the build, never from a response, so a script injected into a page is not
on it. If the Worker cannot read the file it falls back to `'unsafe-inline'`
for scripts and logs `csp-script-hashes-unavailable`; a build that cannot seal
the list fails instead of deploying.

`style-src` is `'self'` plus the SHA-256 of the one `<style>` block the pages
carry, the island runtime's `display: contents` rule. The markup has no
`style=""` attributes (a hash does not cover attributes), so a style injected
into a page is refused. The feature builds the site and fails if a built page
carries a `<style>` the policy does not list, which is what an Astro upgrade
that changes that rule would do.

`connect-src` is `'self' blob:` on every page except the ones where a wallet
signs (a script cannot send data to an outside host with `fetch`), and the
policy keeps `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`,
`form-action 'self'` and `frame-ancestors 'none'`.

The pages where a wallet signs (`/lap/session/`, `/lap/admin/worlds/`,
`/panel/miembros/`, `/panel/roles/`, in every locale) also open `connect-src`
to `https:` and `wss:`, because the user chooses their wallet's RPC host.

## Reporting a vulnerability

Report privately through GitHub's *Report a vulnerability* on this
repository. Do not open a public issue.
