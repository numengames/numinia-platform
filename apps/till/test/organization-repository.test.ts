/**
 * «Each organization's repository» (2026-11-20): migration 0027 on the D1
 * shim, the pure reading of the link numinia.com sends
 * (`src/lib/organization-repository.ts`) and the two functions that keep it
 * (`src/db/organization-repository.ts`): who may read and change the link,
 * that a repeated creation links and never duplicates, that an error can be
 * retried, and that a transferred repository is final.
 */

import { describe, expect, it } from 'vitest';
import { PROBLEMS } from '../src/db/accounts';
import {
  linkRepository,
  organizationRepository,
  type RepositoryAnswer,
} from '../src/db/organization-repository';
import {
  REPOSITORY_PROBLEMS,
  readRepositoryLink,
  refusedChange,
} from '../src/lib/organization-repository';
import { ORG_PROBLEMS } from '../src/lib/organizations';
import { AccountDesk } from '../src/worker';
import { migratedTill } from './sqlite-d1';

const wallet = (pair: string): string => `0x${pair.repeat(20)}`;
const PABLO = wallet('ab'); // founds the organization: an owner
const MARIA = wallet('cd'); // a member
const LEO = wallet('ee'); // an administrator, not an owner
const STRANGER = wallet('ef');
const HOUSE = wallet('99');
const ctx = {} as ExecutionContext;
const T0 = new Date('2026-11-20T12:00:00.000Z');
const T1 = new Date('2026-11-20T12:00:05.000Z');
const T2 = new Date('2026-11-20T12:01:00.000Z');

async function scene() {
  const shim = migratedTill();
  const desk = new AccountDesk(ctx, { TILL_DB: shim.db });
  const made = await desk.createTeam(PABLO, 'Numen');
  if (!made.ok) throw new Error(made.problems.join());
  const id = made.account.id;
  for (const [who, role] of [
    [MARIA, 'member'],
    [LEO, 'admin'],
  ] as const) {
    const added = await desk.setMember(PABLO, id, who, role);
    if (!added.ok) throw new Error(added.problems.join());
  }
  return { ...shim, desk, id };
}

const ok = (answer: RepositoryAnswer) => {
  if (!answer.ok) throw new Error(answer.problems.join());
  return answer;
};
const problems = (answer: RepositoryAnswer): readonly string[] => {
  if (answer.ok) throw new Error('expected a refusal');
  return answer.problems;
};
const creating = { name: 'org-numen', state: 'creating' };
const ready = { name: 'org-numen', state: 'ready' };
const failed = { name: 'org-numen', state: 'error', problem: 'GitHub answered 502' };
const transferred = { name: 'org-numen', state: 'transferred' };

describe('readRepositoryLink: the link numinia.com sends, read as untrusted', () => {
  it('reads a name and a state, and a problem only with an error', () => {
    expect(readRepositoryLink(creating)).toEqual({ ...creating, problem: null });
    expect(readRepositoryLink({ ...ready, problem: null })).toEqual({ ...ready, problem: null });
    expect(readRepositoryLink({ ...failed, problem: '  GitHub answered 502 ' })).toEqual(failed);
  });

  it('names every problem of what it cannot read', () => {
    for (const sent of [undefined, null, 'org-numen', 7, [creating]]) {
      expect(readRepositoryLink(sent)).toEqual([REPOSITORY_PROBLEMS.link]);
    }
    for (const name of [undefined, 7, '', '-numen', 'Org-Numen', 'org numen', 'a'.repeat(101)]) {
      expect(readRepositoryLink({ name, state: 'ready' })).toEqual([REPOSITORY_PROBLEMS.name]);
    }
    expect(readRepositoryLink({ name: 'a'.repeat(100), state: 'ready' })).toMatchObject({
      state: 'ready',
    });
    for (const state of [undefined, 'done', 7]) {
      expect(readRepositoryLink({ name: 'org-numen', state })).toEqual([REPOSITORY_PROBLEMS.state]);
    }
    for (const problem of [undefined, null, '', '   ', 7, 'x'.repeat(201)]) {
      expect(readRepositoryLink({ name: 'org-numen', state: 'error', problem })).toEqual([
        REPOSITORY_PROBLEMS.problem,
      ]);
    }
    expect(readRepositoryLink({ ...ready, problem: 'left over' })).toEqual([
      REPOSITORY_PROBLEMS.problem,
    ]);
    expect(readRepositoryLink({ name: '', state: 'gone', problem: 7 })).toEqual([
      REPOSITORY_PROBLEMS.name,
      REPOSITORY_PROBLEMS.state,
      REPOSITORY_PROBLEMS.problem,
    ]);
  });
});

describe('refusedChange: what a link may become', () => {
  const link = (name: string, state: 'creating' | 'ready' | 'error' | 'transferred') => ({
    name,
    state,
    problem: state === 'error' ? 'it failed' : null,
  });

  it('lets a first link in, and any state of the same name follow another', () => {
    expect(refusedChange(null, link('org-numen', 'creating'))).toBeNull();
    expect(refusedChange(link('org-numen', 'creating'), link('org-numen', 'ready'))).toBeNull();
    expect(refusedChange(link('org-numen', 'ready'), link('org-numen', 'ready'))).toBeNull();
    expect(refusedChange(link('org-numen', 'ready'), link('org-numen', 'transferred'))).toBeNull();
  });

  it('keeps the name unless the last try failed, and a transferred repository for good', () => {
    expect(refusedChange(link('org-numen', 'creating'), link('org-other', 'ready'))).toBe(
      REPOSITORY_PROBLEMS.renamed,
    );
    expect(refusedChange(link('org-numen', 'ready'), link('org-other', 'ready'))).toBe(
      REPOSITORY_PROBLEMS.renamed,
    );
    expect(refusedChange(link('org-numen', 'error'), link('org-other', 'creating'))).toBeNull();
    expect(refusedChange(link('org-numen', 'transferred'), link('org-numen', 'ready'))).toBe(
      REPOSITORY_PROBLEMS.transferred,
    );
  });
});

describe('migration 0027: one repository per organization, kept', () => {
  it('is a STRICT table keyed by organization', async () => {
    const { sqlite } = await scene();
    expect(
      sqlite
        .prepare(
          `SELECT name, type, "notnull", pk FROM pragma_table_info('organization_repositories') ORDER BY cid`,
        )
        .all()
        .map((row) => ({ ...row })),
    ).toEqual([
      { name: 'account_id', type: 'TEXT', notnull: 1, pk: 1 },
      { name: 'name', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'state', type: 'TEXT', notnull: 1, pk: 0 },
      { name: 'problem', type: 'TEXT', notnull: 0, pk: 0 },
      { name: 'updated_at', type: 'TEXT', notnull: 1, pk: 0 },
    ]);
  });

  it('refuses a row out of shape, and never deletes one or changes a transferred one', async () => {
    const { sqlite, id } = await scene();
    const insert = (
      account: string,
      name: string,
      state: string,
      problem: string | null,
      at: string,
    ) =>
      sqlite
        .prepare(
          'INSERT INTO organization_repositories (account_id, name, state, problem, updated_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(account, name, state, problem, at);
    const at = T0.toISOString();
    expect(() => insert('acc-nobody', 'org-numen', 'ready', null, at)).toThrow(/FOREIGN KEY/);
    expect(() => insert(id, '', 'ready', null, at)).toThrow(/CHECK/);
    expect(() => insert(id, '-numen', 'ready', null, at)).toThrow(/CHECK/);
    expect(() => insert(id, 'Org-Numen', 'ready', null, at)).toThrow(/CHECK/);
    expect(() => insert(id, 'a'.repeat(101), 'ready', null, at)).toThrow(/CHECK/);
    expect(() => insert(id, 'org-numen', 'done', null, at)).toThrow(/CHECK/);
    expect(() => insert(id, 'org-numen', 'error', null, at)).toThrow(/CHECK/);
    expect(() => insert(id, 'org-numen', 'error', ' padded ', at)).toThrow(/CHECK/);
    expect(() => insert(id, 'org-numen', 'ready', 'left over', at)).toThrow(/CHECK/);
    expect(() => insert(id, 'org-numen', 'ready', null, 'yesterday')).toThrow(/CHECK/);
    insert(id, 'org-numen', 'transferred', null, at);
    expect(() => sqlite.prepare('DELETE FROM organization_repositories').run()).toThrow(
      'the link to an organization’s repository is kept'.replace('’', "'"),
    );
    expect(() =>
      sqlite.prepare("UPDATE organization_repositories SET state = 'ready'").run(),
    ).toThrow('a transferred repository is no longer the house’s to change'.replace('’', "'"));
  });
});

describe('organizationRepository: the link, to a member or the house', () => {
  it('answers null before any repository, then the link, and who may change it', async () => {
    const s = await scene();
    expect(ok(await organizationRepository(s.db, MARIA, s.id, false, T0))).toEqual({
      ok: true,
      accountId: s.id,
      repository: null,
      mayEdit: false,
    });
    ok(await linkRepository(s.db, LEO, s.id, failed, false, T0));
    expect(ok(await organizationRepository(s.db, PABLO, s.id, false, T1))).toEqual({
      ok: true,
      accountId: s.id,
      repository: { ...failed, updatedAt: T0.toISOString() },
      mayEdit: true,
    });
    expect(ok(await organizationRepository(s.db, LEO, s.id, false, T1)).mayEdit).toBe(true);
  });

  it('lets the house read, and writes that it did', async () => {
    const s = await scene();
    expect(ok(await organizationRepository(s.db, HOUSE, s.id, true, T0)).mayEdit).toBe(true);
    expect(
      s.sqlite
        .prepare("SELECT detail FROM team_log WHERE act = 'house-read' ORDER BY seq DESC LIMIT 1")
        .get()?.['detail'],
    ).toBe(JSON.stringify({ what: 'organization-repository' }));
  });

  it('refuses a stranger and arguments out of shape', async () => {
    const s = await scene();
    expect(problems(await organizationRepository(s.db, STRANGER, s.id, false, T0))).toEqual([
      PROBLEMS.notMember,
    ]);
    expect(problems(await organizationRepository(s.db, 'me', 7, 'yes', T0))).toEqual([
      PROBLEMS.wallet,
      PROBLEMS.accountId,
      ORG_PROBLEMS.house,
    ]);
  });

  it('fails closed on a row the schema does not promise', async () => {
    const s = await scene();
    ok(await linkRepository(s.db, PABLO, s.id, ready, false, T0));
    s.sqlite.exec('PRAGMA ignore_check_constraints = ON');
    s.sqlite.prepare("UPDATE organization_repositories SET state = 'done'").run();
    await expect(organizationRepository(s.db, PABLO, s.id, false, T1)).rejects.toThrow(
      'unknown repository state done',
    );
  });
});

describe('linkRepository: numinia.com tells the till what became of the repository', () => {
  it('follows a repository from being made to ready, through the desk', async () => {
    const s = await scene();
    expect(ok(await s.desk.linkRepository(PABLO, s.id, creating)).repository).toMatchObject({
      ...creating,
      problem: null,
    });
    ok(await linkRepository(s.db, PABLO, s.id, ready, false, T1));
    expect(ok(await s.desk.organizationRepository(PABLO, s.id)).repository).toEqual({
      ...ready,
      problem: null,
      updatedAt: T1.toISOString(),
    });
  });

  it('links again without a second row when the creation is repeated', async () => {
    const s = await scene();
    ok(await linkRepository(s.db, PABLO, s.id, ready, false, T0));
    ok(await linkRepository(s.db, HOUSE, s.id, ready, true, T1));
    expect(
      s.sqlite.prepare('SELECT COUNT(*) AS n FROM organization_repositories').get()?.['n'],
    ).toBe(1);
  });

  it('keeps an error in words, and lets it be tried again under another name', async () => {
    const s = await scene();
    expect(ok(await linkRepository(s.db, LEO, s.id, failed, false, T0)).repository).toEqual({
      ...failed,
      updatedAt: T0.toISOString(),
    });
    const again = { name: 'org-numen-games', state: 'creating' };
    expect(ok(await linkRepository(s.db, LEO, s.id, again, false, T1)).repository).toEqual({
      ...again,
      problem: null,
      updatedAt: T1.toISOString(),
    });
  });

  it('keeps the name of a repository that is there, and a transferred one for good', async () => {
    const s = await scene();
    ok(await linkRepository(s.db, PABLO, s.id, ready, false, T0));
    expect(
      problems(
        await linkRepository(s.db, PABLO, s.id, { name: 'org-other', state: 'ready' }, false, T1),
      ),
    ).toEqual([REPOSITORY_PROBLEMS.renamed]);
    ok(await linkRepository(s.db, PABLO, s.id, transferred, false, T1));
    expect(problems(await linkRepository(s.db, PABLO, s.id, ready, false, T2))).toEqual([
      REPOSITORY_PROBLEMS.transferred,
    ]);
    expect(ok(await organizationRepository(s.db, PABLO, s.id, false, T2)).repository?.state).toBe(
      'transferred',
    );
  });

  it('never links one repository to two organizations', async () => {
    const s = await scene();
    const other = await s.desk.createTeam(PABLO, 'Otra');
    if (!other.ok) throw new Error(other.problems.join());
    ok(await linkRepository(s.db, PABLO, s.id, ready, false, T0));
    expect(problems(await linkRepository(s.db, PABLO, other.account.id, ready, false, T1))).toEqual(
      [REPOSITORY_PROBLEMS.taken],
    );
  });

  it('writes nothing when the link changed between the read and the write', async () => {
    const s = await scene();
    ok(await linkRepository(s.db, PABLO, s.id, creating, false, T0));
    const racing = {
      ...s.db,
      prepare: (query: string) => {
        if (query.includes('INSERT INTO organization_repositories')) {
          s.sqlite
            .prepare('UPDATE organization_repositories SET updated_at = ?')
            .run(T1.toISOString());
        }
        return s.db.prepare(query);
      },
      batch: s.db.batch.bind(s.db),
    } as typeof s.db;
    expect(problems(await linkRepository(racing, PABLO, s.id, ready, false, T2))).toEqual([
      PROBLEMS.meanwhile,
    ]);
    expect(ok(await organizationRepository(s.db, PABLO, s.id, false, T2)).repository?.state).toBe(
      'creating',
    );
  });

  it('is for whoever holds administrator, and reads every argument as untrusted', async () => {
    const s = await scene();
    expect(problems(await linkRepository(s.db, MARIA, s.id, ready, false, T0))[0]).toMatch(
      /^this needs administrator/,
    );
    expect(problems(await linkRepository(s.db, STRANGER, s.id, ready, false, T0))).toEqual([
      PROBLEMS.notMember,
    ]);
    expect(problems(await linkRepository(s.db, 'me', 7, ready, 'yes', T0))).toEqual([
      PROBLEMS.wallet,
      PROBLEMS.accountId,
      ORG_PROBLEMS.house,
    ]);
    expect(problems(await linkRepository(s.db, PABLO, s.id, { name: 'X' }, false, T0))).toEqual([
      REPOSITORY_PROBLEMS.name,
      REPOSITORY_PROBLEMS.state,
    ]);
    expect(
      s.sqlite.prepare('SELECT COUNT(*) AS n FROM organization_repositories').get()?.['n'],
    ).toBe(0);
  });
});
