/**
 * «Each organization's repository» (2026-11-20): the house has numinia.com
 * make a community's private repository in GitHub and the till keep its
 * link. POST, JSON `{ community }` (an id of the register), answers `{ ok:
 * true, account: { id, name }, repository: { name, state, problem,
 * updatedAt } }`; asking again advances a repository still being made and
 * retries one that failed, and never makes a second one. An Oracle's session
 * alone is answered (403 for every other session before the body is read);
 * 404 for a community the register lacks; 400 for a body out of shape; no
 * till, an older one or a GitHub App not configured → 503; a till that
 * fails → 502.
 */

import { parseOrgRepoEnv, provisionRepository } from '@numinia/org-repo';
import type { APIRoute } from 'astro';
import { REGISTER } from '../../../components/communities/register';
import { accountsFrom } from '../../../lib/accounts-source';
import { SESSION_COOKIE } from '../../../lib/auth/server';
import { sessionAsker } from '../../../lib/auth/session-wallet';
import { answerCommunityRepository, type Provision } from '../../../lib/community-repository';
import { runtimeBinding, runtimeEnv } from '../../../lib/runtime-env';
import { logEvent } from '../../../lib/telemetry';

export const prerender = false;

// DATA_SOURCE is frozen at build, like Saldo's: CI and screenshots read the fixture desk.
const desk = () =>
  accountsFrom({ binding: runtimeBinding('TILL_ACCOUNTS'), dataSource: process.env.DATA_SOURCE });

/** The GitHub App's pen, or null while its variables or its key are missing: fail closed. */
function provision(): Provision | null {
  try {
    const env = parseOrgRepoEnv(runtimeEnv());
    return (name, title) =>
      provisionRepository({ env, fetchImpl: fetch, now: new Date() }, name, title);
  } catch {
    // Which variable is missing is the operator's to read in the config, never a value in a log.
    logEvent({ level: 'error', kind: 'community-repository', rule: 'not-configured' });
    return null;
  }
}

export const POST: APIRoute = async ({ cookies, request }) =>
  answerCommunityRepository(
    desk(),
    await sessionAsker(cookies.get(SESSION_COOKIE)?.value),
    REGISTER,
    request,
    provision(),
  );
