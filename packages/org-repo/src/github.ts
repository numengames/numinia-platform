/**
 * The GitHub App's pen: a signed App JWT (RS256, WebCrypto), the short-lived
 * installation token it buys, and one function that speaks to the REST API.
 * A failure is an `OrgRepoError` whose words are safe to show and to store:
 * the method, the path asked and the status — never a token, never a body.
 */

import { fromBase64, toBase64 } from '@numinia/state';
import type { OrgRepoEnv } from './config.js';

const API = 'https://api.github.com';

/** What went wrong, in words safe for a panel and a database row. */
export class OrgRepoError extends Error {
  constructor(
    readonly words: string,
    /** GitHub's status, or 0 when the failure was not an answer of GitHub's. */
    readonly status = 0,
  ) {
    super(words);
    this.name = 'OrgRepoError';
  }
}

const base64url = (bytes: Uint8Array): string =>
  toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** The App's JWT: valid from a minute ago (clock drift) for nine more. */
export async function appJwt(env: OrgRepoEnv, now: Date): Promise<string> {
  const der = fromBase64(env.privateKey.replace(/-----[A-Z ]+-----/g, '')) ?? new Uint8Array();
  const seconds = Math.floor(now.getTime() / 1000);
  const head = base64url(utf8(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const body = base64url(
    utf8(JSON.stringify({ iat: seconds - 60, exp: seconds + 540, iss: env.appId })),
  );
  try {
    const key = await crypto.subtle.importKey(
      'pkcs8',
      der,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, utf8(`${head}.${body}`));
    return `${head}.${body}.${base64url(new Uint8Array(signature))}`;
  } catch {
    throw new OrgRepoError('the GitHub App key could not be read: it must be an RSA key in PKCS#8');
  }
}

/** An answer of GitHub's: its status and its JSON (null when it sent none). */
export interface GitHubAnswer {
  readonly status: number;
  readonly json: unknown;
}

/** Asks GitHub; any status comes back as an answer, only a dead network throws. */
export async function ask(
  fetchImpl: typeof fetch,
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<GitHubAnswer> {
  let response: Response;
  try {
    response = await fetchImpl(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'numinia-org-repo',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new OrgRepoError(`GitHub did not answer (${method} ${path})`);
  }
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // No body, or not JSON: the status is the answer.
  }
  return { status: response.status, json };
}

/** The answer when its status is one of `statuses`, else the failure in words. */
export function expect(
  answer: GitHubAnswer,
  statuses: readonly number[],
  what: string,
): GitHubAnswer {
  if (!statuses.includes(answer.status)) {
    throw new OrgRepoError(`GitHub answered ${answer.status} to: ${what}`, answer.status);
  }
  return answer;
}

/** A field of a JSON answer, or undefined: GitHub's answers are read as untrusted. */
export function field(json: unknown, ...path: readonly string[]): unknown {
  let value = json;
  for (const key of path) {
    if (typeof value !== 'object' || value === null) return undefined;
    value = (value as Readonly<Record<string, unknown>>)[key];
  }
  return value;
}

/** What a narrowed token may do: one repository, and only these permissions. */
export interface TokenScope {
  readonly repository: string;
  readonly permissions: Readonly<Record<string, 'read' | 'write'>>;
}

/**
 * A one-hour installation token. With a `scope`, GitHub cuts it down to one
 * repository and the permissions named (it never widens); without one it is
 * the installation's whole reach, which making a repository needs.
 */
export async function installationToken(
  env: OrgRepoEnv,
  fetchImpl: typeof fetch,
  now: Date,
  scope?: TokenScope,
): Promise<string> {
  const answer = expect(
    await ask(
      fetchImpl,
      await appJwt(env, now),
      'POST',
      `/app/installations/${env.installationId}/access_tokens`,
      scope === undefined
        ? {}
        : { repositories: [scope.repository], permissions: scope.permissions },
    ),
    [201],
    'a token for the GitHub App',
  );
  const token = field(answer.json, 'token');
  if (typeof token !== 'string' || token === '') {
    throw new OrgRepoError('GitHub gave no token for the GitHub App');
  }
  return token;
}
