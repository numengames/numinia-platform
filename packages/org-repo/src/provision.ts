/**
 * Makes an organization's private repository from the template and makes it
 * the organization's own: what is the template's alone is removed, the
 * reserved licence is written in the organization's name and the
 * placeholders are resolved — in ONE commit.
 *
 * `provisionRepository` is safe to call again and again: every step first
 * looks at what is already there, so a repeated creation links the same
 * repository and a failed one is simply tried again. Each call is a handful
 * of short requests; when GitHub has not finished copying the template it
 * answers `creating` and the caller asks again later.
 *
 * Which repositories it may touch is GitHub's doing, not a name check: the
 * App is installed on the template alone, so its token reaches only the
 * template and the repositories the App itself made. On top of that, a
 * repository found under the wanted name is linked only when GitHub says it
 * was generated from the template and is private.
 */

import { fromBase64 } from '@numinia/state';
import type { OrgRepoEnv } from './config.js';
import { OrgRepoError, ask, expect, field, installationToken } from './github.js';
import {
  installTree,
  parseMouldSpec,
  personalize,
  safeTitle,
  stripped,
  type MouldValues,
  type TreeEntry,
} from './mould.js';

/** The mark every organization's repository carries, for people reading GitHub. */
export const ORGANIZATION_TOPIC = 'numinia-organization';

/** The contract every template declares itself in. */
const CONTRACT = 'REUSE.toml';

/** Files whose placeholders are resolved, besides the licence. The `_template/` files keep theirs on purpose. */
const PERSONALIZED: readonly string[] = [
  'README.md',
  'CHANGELOG.md',
  'STATUS.md',
  'web/index.html',
  'canon/C-001-mission-vision-values.md',
  'canon/C-002-culture.md',
  'canon/C-003-org-structure.md',
  'canon/C-004-glossary.md',
];

const COMMUNITY_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** The repository's name for a community of the register (`org-<id>`), or null for an id out of shape. */
export function repositoryNameOf(communityId: string): string | null {
  return COMMUNITY_ID.test(communityId) ? `org-${communityId}` : null;
}

export interface Provisioned {
  /** `creating`: GitHub is still copying the template — ask again. `ready`: it is the organization's own. */
  readonly state: 'creating' | 'ready';
  readonly name: string;
  /** GitHub's own number for the repository: it survives a rename and a transfer. */
  readonly id: number;
}

export interface ProvisionDeps {
  readonly env: OrgRepoEnv;
  readonly fetchImpl: typeof fetch;
  readonly now: Date;
}

interface Found {
  readonly id: number;
  readonly branch: string;
}

/** What GitHub says of a repository, checked: ours to touch, or a refusal in words. */
function readRepository(json: unknown, env: OrgRepoEnv, name: string, made: boolean): Found {
  const id = field(json, 'id');
  const branch = field(json, 'default_branch');
  if (typeof id !== 'number' || typeof branch !== 'string' || branch === '') {
    throw new OrgRepoError(`GitHub described ${name} in a shape that cannot be read`);
  }
  if (field(json, 'private') !== true) {
    throw new OrgRepoError(`${name} is not private: it is left untouched`);
  }
  const template = field(json, 'template_repository', 'name');
  if (
    !made &&
    (typeof template !== 'string' || template.toLowerCase() !== env.template.toLowerCase())
  ) {
    throw new OrgRepoError(
      `${name} exists and was not made from the template: it is left untouched`,
    );
  }
  return { id, branch };
}

/** The repository under `name`: found, or generated from the template now. */
async function findOrGenerate(
  deps: ProvisionDeps,
  token: string,
  name: string,
  title: string,
): Promise<Found> {
  const { env, fetchImpl } = deps;
  const found = expect(
    await ask(fetchImpl, token, 'GET', `/repos/${env.owner}/${name}`),
    [200, 404],
    `read ${name}`,
  );
  if (found.status === 200) return readRepository(found.json, env, name, false);
  const generated = await ask(
    fetchImpl,
    token,
    'POST',
    `/repos/${env.owner}/${env.template}/generate`,
    {
      owner: env.owner,
      name,
      private: true,
      include_all_branches: false,
      description: `${title} on Numinia: its worlds, its calendar and its documents.`,
    },
  );
  if (generated.status === 422) {
    // The name is taken by a repository the App cannot see: not ours, never touched.
    throw new OrgRepoError(
      `the name ${name} is taken in GitHub by a repository that is not ours`,
      422,
    );
  }
  return readRepository(
    expect(generated, [201], `make ${name} from the template`).json,
    env,
    name,
    true,
  );
}

function readTree(json: unknown): TreeEntry[] {
  const tree = field(json, 'tree');
  if (!Array.isArray(tree) || field(json, 'truncated') === true) {
    throw new OrgRepoError('GitHub listed the repository in a shape that cannot be read');
  }
  return tree.flatMap((entry: unknown) => {
    const path = field(entry, 'path');
    const mode = field(entry, 'mode');
    const type = field(entry, 'type');
    const sha = field(entry, 'sha');
    return typeof path === 'string' &&
      typeof mode === 'string' &&
      typeof type === 'string' &&
      typeof sha === 'string'
      ? [{ path, mode, type, sha }]
      : [];
  });
}

/**
 * Makes (or finds) the repository `name` for the organization called
 * `organizationName`. Throws `OrgRepoError`, whose words are safe to show.
 */
export async function provisionRepository(
  deps: ProvisionDeps,
  name: string,
  organizationName: string,
): Promise<Provisioned> {
  const { env, fetchImpl, now } = deps;
  const title = safeTitle(organizationName);
  if (title === null) throw new OrgRepoError('the organization has no name that can be written');
  if (!/^org-[a-z0-9][a-z0-9-]{0,62}$/.test(name) || name === env.template.toLowerCase()) {
    throw new OrgRepoError('the repository name must be org- and the community’s id');
  }
  const token = await installationToken(env, fetchImpl, now);
  const repo = `/repos/${env.owner}/${name}`;
  const { id, branch } = await findOrGenerate(deps, token, name, title);

  expect(
    await ask(fetchImpl, token, 'PUT', `${repo}/topics`, { names: [ORGANIZATION_TOPIC] }),
    [200],
    `mark ${name}`,
  );

  // GitHub copies the template after it answers: until then there is no branch.
  const ref = expect(
    await ask(fetchImpl, token, 'GET', `${repo}/git/ref/heads/${branch}`),
    [200, 404, 409],
    `read the branch of ${name}`,
  );
  const head = field(ref.json, 'object', 'sha');
  if (ref.status !== 200 || typeof head !== 'string') return { state: 'creating', name, id };

  const commit = expect(
    await ask(fetchImpl, token, 'GET', `${repo}/git/commits/${head}`),
    [200],
    `read the last commit of ${name}`,
  );
  const treeSha = field(commit.json, 'tree', 'sha');
  if (typeof treeSha !== 'string') throw new OrgRepoError(`the last commit of ${name} has no tree`);
  const tree = readTree(
    expect(
      await ask(fetchImpl, token, 'GET', `${repo}/git/trees/${treeSha}?recursive=1`),
      [200],
      `list ${name}`,
    ).json,
  );
  const blob = (path: string): TreeEntry | undefined =>
    tree.find((entry) => entry.type === 'blob' && entry.path === path);

  const contract = blob(CONTRACT);
  if (contract === undefined) {
    // The contract is among what the install removes: without it, the install already happened.
    if (blob('LICENSE') !== undefined) return { state: 'ready', name, id };
    throw new OrgRepoError(`${name} has neither the template’s contract nor a LICENSE`);
  }

  const textOf = async (entry: TreeEntry): Promise<string> => {
    const answer = expect(
      await ask(fetchImpl, token, 'GET', `${repo}/git/blobs/${entry.sha}`),
      [200],
      `read ${entry.path} of ${name}`,
    );
    const content = field(answer.json, 'content');
    const bytes = typeof content === 'string' ? fromBase64(content) : null;
    if (bytes === null) throw new OrgRepoError(`${entry.path} of ${name} cannot be read`);
    return new TextDecoder().decode(bytes);
  };

  const spec = parseMouldSpec(await textOf(contract));
  if (spec === null) {
    throw new OrgRepoError('the template does not declare its licence files: nothing was changed');
  }
  const licence = blob(spec.renameFrom);
  if (licence === undefined) {
    throw new OrgRepoError(`the template lacks ${spec.renameFrom}: nothing was changed`);
  }
  const values: MouldValues = { title, slug: name, date: now.toISOString().slice(0, 10) };
  const rewritten = new Map<string, string>();
  rewritten.set(spec.renameFrom, personalize(await textOf(licence), values));
  for (const path of PERSONALIZED) {
    const entry = blob(path);
    if (entry === undefined || stripped(spec, path)) continue;
    rewritten.set(path, personalize(await textOf(entry), values));
  }

  const written = expect(
    await ask(fetchImpl, token, 'POST', `${repo}/git/trees`, {
      tree: installTree(tree, spec, rewritten),
    }),
    [201],
    `write the files of ${name}`,
  );
  const made = expect(
    await ask(fetchImpl, token, 'POST', `${repo}/git/commits`, {
      message: `Make this repository ${title}'s own\n\nRemoves what belongs to the template alone, writes the licence in the\norganization's name (all rights reserved until it decides otherwise) and\nresolves the template's placeholders. Made by numinia.com.`,
      tree: field(written.json, 'sha'),
      parents: [head],
    }),
    [201],
    `commit the files of ${name}`,
  );
  const moved = expect(
    await ask(fetchImpl, token, 'PATCH', `${repo}/git/refs/heads/${branch}`, {
      sha: field(made.json, 'sha'),
      force: false,
    }),
    // 422: someone moved the branch meanwhile — nothing is lost, the next call looks again.
    [200, 422],
    `publish the files of ${name}`,
  );
  return { state: moved.status === 200 ? 'ready' : 'creating', name, id };
}
