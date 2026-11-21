/**
 * «Each organization's repository» (2026-11-20), the pure part: the link
 * numinia.com sends — the repository's name, its state and, on an error,
 * what went wrong — read as untrusted, and the rule of what a link may
 * become. Pure — no database, no call to GitHub. A malformed field is a
 * problem in words, never a throw.
 */

/** What became of an organization's repository; the order is the order of its life. */
export const REPOSITORY_STATES = ['creating', 'ready', 'error', 'transferred'] as const;
export type RepositoryState = (typeof REPOSITORY_STATES)[number];

/** The link as numinia.com sends it and as the till keeps it. */
export interface RepositoryLink {
  readonly name: string;
  readonly state: RepositoryState;
  /** What went wrong, in words: only with `error`. */
  readonly problem: string | null;
}

/** Lowercase letters, digits and hyphens, never leading with one: what the house names a repository. */
const REPOSITORY_NAME = /^[a-z0-9][a-z0-9-]{0,99}$/;

const PROBLEM_MAX = 200;

export const REPOSITORY_PROBLEMS = {
  link: 'repository must be an object with a name, a state and, on an error, a problem',
  name: 'repository.name must be 1 to 100 characters: lowercase letters, digits and hyphens, not starting with a hyphen',
  state: `repository.state must be one of ${REPOSITORY_STATES.join(', ')}`,
  problem: `repository.problem must be 1 to ${PROBLEM_MAX} characters with state error, and absent otherwise`,
  transferred: 'the repository was transferred: it is the organization’s own and its link is final',
  renamed: 'the repository is linked already: its name changes only after an error',
  taken: 'that repository is linked to another organization',
} as const;

const STATES: ReadonlySet<unknown> = new Set(REPOSITORY_STATES);

/** The link numinia.com sends, or the problems of what it cannot read (every one of them). */
export function readRepositoryLink(value: unknown): RepositoryLink | readonly string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [REPOSITORY_PROBLEMS.link];
  }
  const sent = value as Record<string, unknown>;
  const name = sent['name'];
  const state = sent['state'];
  const problem = sent['problem'] ?? null;
  const problems: string[] = [];
  if (typeof name !== 'string' || !REPOSITORY_NAME.test(name)) {
    problems.push(REPOSITORY_PROBLEMS.name);
  }
  if (!STATES.has(state)) problems.push(REPOSITORY_PROBLEMS.state);
  const words = typeof problem === 'string' ? problem.trim() : problem;
  const worded = typeof words === 'string' && words.length >= 1 && words.length <= PROBLEM_MAX;
  if (state === 'error' ? !worded : words !== null) problems.push(REPOSITORY_PROBLEMS.problem);
  if (problems.length > 0) return problems;
  return {
    name: name as string,
    state: state as RepositoryState,
    problem: state === 'error' ? (words as string) : null,
  };
}

/**
 * Why the link `current` may not become `next`, or null when it may. A
 * transferred repository is final; a repository being made or ready keeps
 * its name — only after an error may another name be tried.
 */
export function refusedChange(current: RepositoryLink | null, next: RepositoryLink): string | null {
  if (current === null) return null;
  if (current.state === 'transferred') return REPOSITORY_PROBLEMS.transferred;
  if (current.state !== 'error' && current.name !== next.name) return REPOSITORY_PROBLEMS.renamed;
  return null;
}
