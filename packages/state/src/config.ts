/**
 * State configuration — fail closed at boot. A missing variable crashes naming itself; no fallback.
 * The token is the crown jewel: fine-grained, scoped to the ONE state repo.
 */

import { z } from 'zod';

const DEFAULT_API_BASE = 'https://api.github.com';

/**
 * Optional API base, for a self-hosted copy that keeps its state in a local
 * git folder behind a GitHub-contents-compatible loopback server. Only a bare
 * http(s) origin on 127.0.0.1 or localhost is accepted: the token must never
 * be sent anywhere else.
 */
function isLoopbackOrigin(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost') &&
    url.username === '' &&
    url.password === '' &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === ''
  );
}

const schema = z.object({
  STATE_REPO_OWNER: z.string().min(1, 'STATE_REPO_OWNER must be set'),
  STATE_REPO_NAME: z.string().min(1, 'STATE_REPO_NAME must be set'),
  STATE_GITHUB_TOKEN: z.string().min(20, 'STATE_GITHUB_TOKEN looks too short to be real'),
  STATE_BRANCH: z.string().min(1).optional(),
  STATE_API_URL: z
    .string()
    .refine(
      isLoopbackOrigin,
      'STATE_API_URL must be an http(s) origin on 127.0.0.1 or localhost (no path, no credentials)',
    )
    .optional(),
});

export interface StateEnv {
  readonly owner: string;
  readonly repo: string;
  readonly token: string;
  readonly branch: string;
  /** Contents-API origin, no trailing slash: GitHub unless a local override is set. */
  readonly apiBase: string;
}

export class StateConfigError extends Error {
  constructor(issues: readonly string[]) {
    super(`Invalid state configuration:\n${issues.map((issue) => `  ${issue}`).join('\n')}`);
    this.name = 'StateConfigError';
  }
}

export function parseStateEnv(input: Readonly<Record<string, string | undefined>>): StateEnv {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new StateConfigError(
      parsed.error.issues.map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`),
    );
  }
  return {
    owner: parsed.data.STATE_REPO_OWNER,
    repo: parsed.data.STATE_REPO_NAME,
    token: parsed.data.STATE_GITHUB_TOKEN,
    branch: parsed.data.STATE_BRANCH ?? 'main',
    apiBase:
      parsed.data.STATE_API_URL === undefined
        ? DEFAULT_API_BASE
        : new URL(parsed.data.STATE_API_URL).origin,
  };
}
