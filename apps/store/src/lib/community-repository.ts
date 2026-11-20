/**
 * «Each organization's repository» (2026-11-20), the store's door: the house
 * has numinia.com make a community's private repository in GitHub — from the
 * organization template, with the licence reserved in the community's name —
 * and the till keep the link and what became of it.
 *
 * One POST is one short push: it opens the community's account if it must,
 * makes or finds the repository (`@numinia/org-repo`, safe to repeat) and
 * records `creating`, `ready` or `error` with the problem in words. While
 * GitHub is still copying the template the answer is `creating`; asking
 * again is how it advances, and how a failure is retried. Nothing waits
 * past a request's life.
 *
 * The till holds no GitHub key and calls GitHub for nothing; the App's key
 * is a secret of this Worker alone. Who asks is the session's (an Oracle's),
 * never the request's. Server only.
 */

import { OrgRepoError, repositoryNameOf, type Provisioned } from '@numinia/org-repo';
import { z } from 'zod';
import type { AccountDesk, Asker } from './accounts';
import type { Community } from './communities';
import { readCommunityBody } from './community-teams';
import { logEvent } from './telemetry';
import { answer, ask, bodyOf, forbidden, lowercase, notBound, type Log } from './worlds-homes';

/** Makes or finds the repository `name` for the organization called `title`; throws `OrgRepoError`. */
export type Provision = (name: string, title: string) => Promise<Provisioned>;

/** The till keeps at most this many characters of what went wrong. */
const PROBLEM_MAX = 200;

const refusal = z.object({ ok: z.literal(false), problems: z.array(z.string()) });
const ensured = z.union([
  z.object({ ok: z.literal(true), account: z.object({ id: z.string(), name: z.string() }) }),
  refusal,
]);
const linked = z.union([
  z.object({
    ok: z.literal(true),
    accountId: z.string(),
    repository: z
      .object({
        name: z.string(),
        state: z.enum(['creating', 'ready', 'error', 'transferred']),
        problem: z.string().nullable(),
        updatedAt: z.string(),
      })
      .nullable(),
    mayEdit: z.boolean(),
  }),
  refusal,
]);

/** The till's refusal in the route's words: 403 when it is about the house or a permission, else 400. */
function refused(problems: readonly string[]): Response {
  const status = problems.some((problem) => /\bhouse\b|\bneeds\b/.test(problem)) ? 403 : 400;
  return answer({ error: 'refused', problems }, status);
}

/** What became of the making, as the till records it. */
async function make(
  provision: Provision,
  name: string,
  title: string,
  log: Log,
): Promise<{ state: 'creating' | 'ready' } | { state: 'error'; problem: string }> {
  try {
    return { state: (await provision(name, title)).state };
  } catch (error) {
    const words = error instanceof OrgRepoError ? error.words : 'the repository could not be made';
    log({
      level: 'error',
      kind: 'community-repository',
      rule: error instanceof OrgRepoError ? 'github' : 'threw',
      status: error instanceof OrgRepoError ? error.status : 0,
    });
    return { state: 'error', problem: words.slice(0, PROBLEM_MAX).trim() };
  }
}

/**
 * POST /api/admin/community-repository, JSON `{ community }` (an id of the
 * register): `{ ok: true, account, repository: { name, state, problem,
 * updatedAt } }`. 403 for any session but the house's before the body is
 * read; 400 for a body out of shape or a till's refusal; 404 for a community
 * the register lacks; 503 without a till, with an older one, or while the
 * GitHub App is not configured (`not-configured`); 502 when the till fails.
 * A failure of GitHub's is not an error of this route: it is the state
 * `error`, kept, with its problem — ask again to retry.
 */
export async function answerCommunityRepository(
  desk: AccountDesk | null,
  asker: Asker | null,
  register: readonly Community[],
  request: Request,
  provision: Provision | null,
  log: Log = logEvent,
): Promise<Response> {
  if (asker === null || !asker.house) return forbidden();
  const body = await bodyOf(request);
  if (!body.ok) return body.response;
  const read = readCommunityBody(body.json);
  if (read === null) return answer({ error: 'body: { community }' }, 400);
  const community = register.find((entry) => entry.id === read.community);
  const name = repositoryNameOf(read.community);
  if (community === undefined || name === null) return answer({ error: 'no-community' }, 404);
  if (desk === null) return notBound();
  const wallet = lowercase(asker);

  const opened = await ask(
    log,
    'ensureCommunityTeam',
    () => desk.ensureCommunityTeam(wallet, true, community.id, community.name),
    ensured,
  );
  if (!opened.ok) return opened.response;
  if ('problems' in opened.value) return refused(opened.value.problems);
  const account = { id: opened.value.account.id, name: opened.value.account.name };

  const kept = await ask(
    log,
    'organizationRepository',
    () => desk.organizationRepository(wallet, account.id, true),
    linked,
  );
  if (!kept.ok) return kept.response;
  if ('problems' in kept.value) return refused(kept.value.problems);
  const current = kept.value.repository;
  // Transferred is final, and a repository already the community's own needs no making.
  if (current !== null && (current.state === 'transferred' || current.state === 'ready')) {
    return answer({ ok: true, account, repository: current });
  }
  if (provision === null) return answer({ error: 'not-configured' }, 503);

  // The name the till already keeps wins: a repository being made keeps its name.
  const wanted = current !== null && current.state === 'creating' ? current.name : name;
  const made = await make(provision, wanted, community.name, log);
  const recorded = await ask(
    log,
    'linkRepository',
    () => desk.linkRepository(wallet, account.id, { name: wanted, ...made }, true),
    linked,
  );
  if (!recorded.ok) return recorded.response;
  if ('problems' in recorded.value) return refused(recorded.value.problems);
  return answer({ ok: true, account, repository: recorded.value.repository });
}
