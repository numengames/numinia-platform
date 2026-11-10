# Contributing

The rules live in [`numengames/numinia-archive`](https://github.com/numengames/numinia-archive)
(`AGENTS.md`, transition regime included). Here, only what is specific to
this code:

1. One pull request per cut, against `main`. No force pushes, no
   self-merge.
2. Every change under `apps/store/src/**` adds ONE release-note file in
   `apps/store/src/content/updates/` (`YYYY-MM-DD-HHMM-slug.md`, UTC) — CI
   refuses the merge otherwise. Nobody writes or bumps a version: the Nth
   note is the Nth release (details in [`AGENTS.md`](AGENTS.md)).
3. Run `npm run verify` before pushing; the gates that bite are listed in
   [`AGENTS.md`](AGENTS.md).
4. English in code, comments and commits. Conventional commits
   (`feat:`, `fix:`, `docs:`, `chore:`…).
5. Domain names come from the archive (`CAN-003`, `CAN-004` in
   numinia-nwos); the lower-case identifiers in `packages/domain` follow
   them.
