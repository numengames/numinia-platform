/**
 * «Each organization's repository» (2026-11-20): the link between an
 * organization and its private repository, kept in migration 0027's
 * `organization_repositories`. The till calls GitHub for nothing:
 * numinia.com makes the repository and tells the till what became of it.
 *
 * - `organizationRepository`: the link, to any member and the house, and
 *   whether the asker may change it.
 * - `linkRepository`: only whoever holds `administrator` — the house, while
 *   it is the house that opens communities. The rule of what a link may
 *   become is the pure part's (`refusedChange`): a transferred repository is
 *   final, and a name changes only after an error.
 *
 * Every argument is read as untrusted; a refusal is an answer with problems
 * in words, never a throw.
 */

import { readAccountId, readWallet } from '../lib/accounts';
import {
  REPOSITORY_PROBLEMS,
  REPOSITORY_STATES,
  readRepositoryLink,
  refusedChange,
  type RepositoryLink,
  type RepositoryState,
} from '../lib/organization-repository';
import { ORG_PROBLEMS, readHouse } from '../lib/organizations';
import { PROBLEMS, enter, houseRead, lacking, refuse, type Refusal } from './accounts';
import { column, instant, text, type Row, type TillDatabase } from './repository';

/** The link as the till keeps it: with the moment it last changed. */
interface StoredRepository extends RepositoryLink {
  readonly updatedAt: string;
}

interface RepositoryView {
  readonly ok: true;
  readonly accountId: string;
  /** Null while no repository was ever asked for this organization. */
  readonly repository: StoredRepository | null;
  /** The asker may link, retry or record a transfer (`administrator`). */
  readonly mayEdit: boolean;
}

export type RepositoryAnswer = RepositoryView | Refusal;

const SELECT_REPOSITORY = `
  SELECT name, state, problem, updated_at FROM organization_repositories WHERE account_id = ?1`;

/** Written only while the row still reads as it was read (`?6`, its `updated_at`, or null for none). */
const UPSERT_REPOSITORY = `
  INSERT INTO organization_repositories (account_id, name, state, problem, updated_at)
  SELECT ?1, ?2, ?3, ?4, ?5
   WHERE coalesce(
     (SELECT updated_at FROM organization_repositories WHERE account_id = ?1), ''
   ) = coalesce(?6, '')
  ON CONFLICT (account_id) DO UPDATE
     SET name = excluded.name, state = excluded.state, problem = excluded.problem,
         updated_at = excluded.updated_at`;

const STATES: ReadonlySet<string> = new Set(REPOSITORY_STATES);

/** A stored row back into a link; a throw on a row the schema does not promise. */
function storedOf(row: Row): StoredRepository {
  const state = text(row, 'state');
  if (!STATES.has(state)) throw new TypeError(`till database: unknown repository state ${state}`);
  const problem = column(row, 'problem');
  return {
    name: text(row, 'name'),
    state: state as RepositoryState,
    problem: problem === null ? null : text(row, 'problem'),
    updatedAt: instant(row, 'updated_at'),
  };
}

async function repositoryOf(db: TillDatabase, accountId: string): Promise<StoredRepository | null> {
  const row = await db.prepare(SELECT_REPOSITORY).bind(accountId).first<Row>();
  return row === null ? null : storedOf(row);
}

/** Reads the arguments both methods take, or the refusal of what it cannot read. */
function readAsker(
  sentWallet: unknown,
  sentAccount: unknown,
  sentHouse: unknown,
): { readonly wallet: string; readonly accountId: string; readonly house: boolean } | Refusal {
  const wallet = readWallet(sentWallet);
  const accountId = readAccountId(sentAccount);
  const house = readHouse(sentHouse);
  if (wallet === undefined || accountId === undefined || house === undefined) {
    return refuse(
      ...(wallet === undefined ? [PROBLEMS.wallet] : []),
      ...(accountId === undefined ? [PROBLEMS.accountId] : []),
      ...(house === undefined ? [ORG_PROBLEMS.house] : []),
    );
  }
  return { wallet, accountId, house };
}

/** The organization's repository and its state, to a member or the house. */
export async function organizationRepository(
  db: TillDatabase,
  sentWallet: unknown,
  sentAccount: unknown,
  sentHouse: unknown,
  now: Date,
): Promise<RepositoryAnswer> {
  const asker = readAsker(sentWallet, sentAccount, sentHouse);
  if ('problems' in asker) return asker;
  const entered = await enter(db, asker.wallet, asker.accountId, asker.house);
  if ('problems' in entered) return entered;
  await houseRead(entered, db, now, 'organization-repository');
  return {
    ok: true,
    accountId: asker.accountId,
    repository: await repositoryOf(db, asker.accountId),
    mayEdit: entered.acting.access.permissions.has('administrator'),
  };
}

/**
 * Records what became of the organization's repository: being made, ready,
 * failed (with the problem in words) or transferred. Sending again the link
 * that is kept changes nothing but its moment, so a repeated creation links
 * and never duplicates.
 */
export async function linkRepository(
  db: TillDatabase,
  sentWallet: unknown,
  sentAccount: unknown,
  sentLink: unknown,
  sentHouse: unknown,
  now: Date,
): Promise<RepositoryAnswer> {
  const asker = readAsker(sentWallet, sentAccount, sentHouse);
  if ('problems' in asker) return asker;
  const link = readRepositoryLink(sentLink);
  if (Array.isArray(link)) return refuse(...(link as readonly string[]));
  const next = link as RepositoryLink;
  const entered = await enter(db, asker.wallet, asker.accountId, asker.house);
  if ('problems' in entered) return entered;
  const lacks = lacking(entered, 'administrator');
  if (lacks !== null) return lacks;
  const current = await repositoryOf(db, asker.accountId);
  const refused = refusedChange(current, next);
  if (refused !== null) return refuse(refused);
  const updatedAt = now.toISOString();
  let written: number;
  try {
    const result = await db
      .prepare(UPSERT_REPOSITORY)
      .bind(
        asker.accountId,
        next.name,
        next.state,
        next.problem,
        updatedAt,
        current?.updatedAt ?? null,
      )
      .run();
    written = result.meta.changes;
  } catch {
    // The unique index on the name: another organization holds that repository.
    return refuse(REPOSITORY_PROBLEMS.taken);
  }
  // Someone changed the link between the read and the write.
  if (written !== 1) return refuse(PROBLEMS.meanwhile);
  return {
    ok: true,
    accountId: asker.accountId,
    repository: { ...next, updatedAt },
    mayEdit: true,
  };
}
