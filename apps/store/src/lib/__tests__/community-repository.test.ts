/**
 * «Each organization's repository» at the store's door and in the fixture
 * desk: the house has a community's private repository made and the link
 * kept. A repeated call never makes a second one; a failure of GitHub's is a
 * state with its words, retried by asking again; a transferred repository is
 * final. The house alone asks (the session decides, never the request).
 */

import { OrgRepoError } from '@numinia/org-repo';
import { describe, expect, it, vi } from 'vitest';
import deskSeed from '../../../fixtures/accounts/desk.json';
import { DESK_METHODS, type AccountDesk, type Asker, type DeskRepositoryAnswer } from '../accounts';
import { createAccountsFixtureDesk, type AccountsSeed } from '../accounts-fixture';
import { boundAccounts } from '../accounts-source';
import type { Community } from '../communities';
import { answerCommunityRepository, type Provision } from '../community-repository';

const NOW = new Date('2026-11-20T12:00:00.000Z');
const HOUSE: Asker = { wallet: `0x${'99'.repeat(20)}`, house: true };
const PLAIN: Asker = { wallet: `0x${'ab'.repeat(20)}`, house: false };
const TARUGO = 'acc_team_la_tarugo';
const TARUGO_ADMIN = `0x${'0'.repeat(38)}e5`;
const TARUGO_PLAIN = `0x${'0'.repeat(38)}f6`;

const register = [
  { id: 'reset', name: 'Reset' },
  { id: 'vic', name: 'València Innovation Capital' },
] as unknown as readonly Community[];

const quiet = vi.fn();
const fresh = (): AccountDesk =>
  createAccountsFixtureDesk(deskSeed as unknown as AccountsSeed, () => NOW);
const post = (body: unknown, type = 'application/json'): Request =>
  new Request('https://numinia.test/api/admin/community-repository', {
    method: 'POST',
    headers: { 'content-type': type },
    body: JSON.stringify(body),
  });
const json = async (response: Response): Promise<Record<string, unknown>> =>
  (await response.json()) as Record<string, unknown>;
const made =
  (state: 'creating' | 'ready'): Provision =>
  async (name) => ({ state, name, id: 7 });
const ask = (
  desk: AccountDesk | null,
  provision: Provision | null,
  body: unknown = { community: 'vic' },
  asker: Asker | null = HOUSE,
) => answerCommunityRepository(desk, asker, register, post(body), provision, quiet);
const link = (answer: DeskRepositoryAnswer) => {
  if (!answer.ok) throw new Error(answer.problems.join());
  return answer;
};

describe('POST /api/admin/community-repository', () => {
  it('answers the house alone, before reading the body', async () => {
    const provision = vi.fn(made('ready'));
    for (const asker of [null, PLAIN]) {
      const response = await ask(fresh(), provision, { community: 'vic' }, asker);
      expect(response.status).toBe(403);
    }
    expect(provision).not.toHaveBeenCalled();
  });

  it('refuses a body out of shape and a community the register lacks', async () => {
    expect((await ask(fresh(), made('ready'), { community: 'vic', x: 1 })).status).toBe(400);
    expect((await ask(fresh(), made('ready'), { community: 'nobody' })).status).toBe(404);
    const typed = await answerCommunityRepository(
      fresh(),
      HOUSE,
      register,
      post({ community: 'vic' }, 'text/plain'),
      made('ready'),
      quiet,
    );
    expect(typed.status).toBe(415);
  });

  it('says 503 without a till, with an older one, and while the GitHub App is not configured', async () => {
    expect((await ask(null, made('ready'))).status).toBe(503);
    const old = boundAccounts(
      Object.fromEntries(
        DESK_METHODS.filter(
          (method) => method !== 'organizationRepository' && method !== 'linkRepository',
        ).map((method) => [
          method,
          vi.fn(async () => ({ ok: true, account: { id: 'acc_t_1', name: 'VIC' } })),
        ]),
      ),
    );
    expect(await json(await ask(old, made('ready')))).toEqual({ error: 'not-bound' });
    const unconfigured = await ask(fresh(), null);
    expect(unconfigured.status).toBe(503);
    expect(await json(unconfigured)).toEqual({ error: 'not-configured' });
  });

  it('reaches a bound till that has the two methods', async () => {
    const none = { ok: true, accountId: 'acc_t_1', repository: null, mayEdit: true };
    const binding = Object.fromEntries(
      DESK_METHODS.map((method) => [method, vi.fn(async () => none)]),
    );
    const bound = boundAccounts(binding);
    expect(await bound?.organizationRepository(HOUSE.wallet, 'acc_t_1', true)).toEqual(none);
    expect(await bound?.linkRepository(HOUSE.wallet, 'acc_t_1', {}, true)).toEqual(none);
    expect(binding['organizationRepository']).toHaveBeenCalledWith(HOUSE.wallet, 'acc_t_1', true);
    expect(binding['linkRepository']).toHaveBeenCalledWith(HOUSE.wallet, 'acc_t_1', {}, true);
  });

  it('opens the account, makes org-<community> and keeps it ready', async () => {
    const desk = fresh();
    const provision = vi.fn(made('ready'));
    const response = await ask(desk, provision);
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body).toMatchObject({
      ok: true,
      account: { name: 'València Innovation Capital' },
      repository: { name: 'org-vic', state: 'ready', problem: null, updatedAt: NOW.toISOString() },
    });
    expect(provision).toHaveBeenCalledExactlyOnceWith('org-vic', 'València Innovation Capital');
    const account = (body['account'] as { id: string }).id;
    expect(link(await desk.organizationRepository(HOUSE.wallet, account, true))).toMatchObject({
      repository: { name: 'org-vic', state: 'ready' },
      mayEdit: true,
    });
  });

  it('never makes a second one: a repository that is ready is answered as kept', async () => {
    const desk = fresh();
    await ask(desk, made('ready'));
    const again = vi.fn(made('ready'));
    expect(await json(await ask(desk, again))).toMatchObject({
      repository: { name: 'org-vic', state: 'ready' },
    });
    expect(again).not.toHaveBeenCalled();
    // Kept even while the App is not configured.
    expect((await ask(desk, null)).status).toBe(200);
  });

  it('advances a repository still being made by asking again', async () => {
    const desk = fresh();
    expect(await json(await ask(desk, made('creating')))).toMatchObject({
      repository: { name: 'org-vic', state: 'creating' },
    });
    const next = vi.fn(made('ready'));
    expect(await json(await ask(desk, next))).toMatchObject({ repository: { state: 'ready' } });
    expect(next).toHaveBeenCalledExactlyOnceWith('org-vic', 'València Innovation Capital');
  });

  it('keeps a failure of GitHub’s as a state with its words, and retries it', async () => {
    const desk = fresh();
    const log = vi.fn();
    const failing: Provision = async () => {
      throw new OrgRepoError(`GitHub answered 403 to: make org-vic ${'x'.repeat(300)}`, 403);
    };
    const failed = await answerCommunityRepository(
      desk,
      HOUSE,
      register,
      post({ community: 'vic' }),
      failing,
      log,
    );
    expect(failed.status).toBe(200);
    const body = await json(failed);
    const repository = body['repository'] as { state: string; problem: string };
    expect(repository.state).toBe('error');
    expect(repository.problem).toMatch(/^GitHub answered 403 to: make org-vic x+$/);
    expect(repository.problem).toHaveLength(200);
    expect(log).toHaveBeenCalledWith({
      level: 'error',
      kind: 'community-repository',
      rule: 'github',
      status: 403,
    });

    // Anything else that breaks is worded here, never echoed.
    const broken: Provision = async () => {
      throw new TypeError('secret detail');
    };
    const other = vi.fn();
    const thrown = await json(
      await answerCommunityRepository(
        desk,
        HOUSE,
        register,
        post({ community: 'vic' }),
        broken,
        other,
      ),
    );
    expect(thrown).toMatchObject({
      repository: { state: 'error', problem: 'the repository could not be made' },
    });
    expect(other).toHaveBeenCalledWith({
      level: 'error',
      kind: 'community-repository',
      rule: 'threw',
      status: 0,
    });

    expect(await json(await ask(desk, made('ready')))).toMatchObject({
      repository: { name: 'org-vic', state: 'ready', problem: null },
    });
  });

  it('leaves a transferred repository alone', async () => {
    const desk = fresh();
    const first = await json(await ask(desk, made('ready')));
    const account = (first['account'] as { id: string }).id;
    link(
      await desk.linkRepository(
        HOUSE.wallet,
        account,
        { name: 'org-vic', state: 'transferred' },
        true,
      ),
    );
    const provision = vi.fn(made('ready'));
    expect(await json(await ask(desk, provision))).toMatchObject({
      repository: { state: 'transferred' },
    });
    expect(provision).not.toHaveBeenCalled();
  });

  it('passes on a till’s refusal and a till’s failure at each step', async () => {
    const account = { ok: true, account: { id: 'acc_t_1', name: 'VIC' } };
    const none = { ok: true, accountId: 'acc_t_1', repository: null, mayEdit: true };
    const no = (problem: string) => ({ ok: false, problems: [problem] });
    const desk = (answers: readonly unknown[]): AccountDesk =>
      ({
        ensureCommunityTeam: vi.fn(async () => answers[0]),
        organizationRepository: vi.fn(async () => answers[1]),
        linkRepository: vi.fn(async () => answers[2]),
      }) as unknown as AccountDesk;
    const cases: readonly [readonly unknown[], number][] = [
      [[no('only the house opens a community')], 403],
      [[{ odd: true }], 502],
      [[account, no('this needs administrator, which the owners hold')], 403],
      [[account, { odd: true }], 502],
      [[account, none, no('repository.name must be 1 to 100 characters')], 400],
      [[account, none, { odd: true }], 502],
    ];
    for (const [answers, status] of cases) {
      expect((await ask(desk(answers), made('ready'))).status, JSON.stringify(answers)).toBe(
        status,
      );
    }
  });
});

describe('the fixture desk keeps the link as the till does', () => {
  const ready = { name: 'org-la-tarugo', state: 'ready' };

  it('shows none until one is linked, to a member', async () => {
    const desk = fresh();
    expect(link(await desk.organizationRepository(TARUGO_PLAIN, TARUGO))).toMatchObject({
      repository: null,
      mayEdit: false,
    });
    expect((await desk.organizationRepository(PLAIN.wallet, TARUGO)).ok).toBe(false);
  });

  it('lets only an administrator link, and reads the link as untrusted', async () => {
    const desk = fresh();
    expect(await desk.linkRepository(TARUGO_PLAIN, TARUGO, ready)).toMatchObject({
      ok: false,
      problems: [expect.stringContaining('needs administrator')],
    });
    expect((await desk.linkRepository(PLAIN.wallet, TARUGO, ready)).ok).toBe(false);
    for (const bad of [
      null,
      [],
      'org-x',
      { name: 'Org', state: 'ready' },
      { name: 3, state: 'ready' },
      { name: 'org-x', state: 'done' },
      { name: 'org-x', state: 'ready', problem: 'why' },
      { name: 'org-x', state: 'error' },
      { name: 'org-x', state: 'error', problem: ' ' },
      { name: 'org-x', state: 'error', problem: 'x'.repeat(201) },
      { name: 'org-x', state: 'error', problem: 7 },
    ]) {
      expect(await desk.linkRepository(TARUGO_ADMIN, TARUGO, bad), JSON.stringify(bad)).toEqual({
        ok: false,
        problems: ['repository must be an object with a name, a state and, on an error, a problem'],
      });
    }
    expect(link(await desk.linkRepository(TARUGO_ADMIN, TARUGO, ready))).toMatchObject({
      repository: { ...ready, problem: null, updatedAt: NOW.toISOString() },
      mayEdit: true,
    });
    expect(
      link(await desk.linkRepository(TARUGO_ADMIN, TARUGO, { ...ready, problem: null })).repository,
    ).toMatchObject(ready);
  });

  it('keeps the name unless the making failed, and a transferred link for good', async () => {
    const desk = fresh();
    const other = { name: 'org-other', state: 'ready' };
    link(
      await desk.linkRepository(TARUGO_ADMIN, TARUGO, { name: 'org-la-tarugo', state: 'creating' }),
    );
    expect(await desk.linkRepository(TARUGO_ADMIN, TARUGO, other)).toMatchObject({
      problems: ['the repository is linked already: its name changes only after an error'],
    });
    link(
      await desk.linkRepository(TARUGO_ADMIN, TARUGO, {
        name: 'org-la-tarugo',
        state: 'error',
        problem: ' GitHub answered 500 ',
      }),
    );
    expect(link(await desk.organizationRepository(TARUGO_ADMIN, TARUGO)).repository).toMatchObject({
      state: 'error',
      problem: 'GitHub answered 500',
    });
    link(await desk.linkRepository(TARUGO_ADMIN, TARUGO, other));
    link(
      await desk.linkRepository(TARUGO_ADMIN, TARUGO, { name: 'org-other', state: 'transferred' }),
    );
    expect(await desk.linkRepository(TARUGO_ADMIN, TARUGO, other)).toMatchObject({
      problems: [
        'the repository was transferred: it is the organization’s own and its link is final',
      ],
    });
  });
});
