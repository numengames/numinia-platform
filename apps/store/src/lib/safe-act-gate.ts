/**
 * «Dueño de comunidad como Safe» (MIS-266): a community the till says a
 * Safe multisig leads (`settings.safe`, read from the till) may do its big
 * acts (OWNER_ACTS, STD-052) only with a valid signature OF THE SAFE over
 * the very act. The check is the one of the fresh signature (ORG-008,
 * lib/fresh-signature.ts): the token the server issued names the Safe's
 * address and chain, and `verifyWalletSignature` asks the Safe itself
 * (ERC-1271, or ERC-6492 before it is deployed) through thirdweb's RPC on
 * that chain. A single owner's key is not the Safe: below the threshold the
 * Safe answers no, and the act does not run.
 *
 * Pure apart from the injected check: the caller passes the deps and reads
 * the Safe from the till. A community with no Safe is 'open': the rules of
 * the two owners apply as before.
 */

import { checkFresh, readFreshToken, type FreshDeps, type FreshProof } from './fresh-signature';

/** A Safe that leads a community: its address (lower-case 0x…) and its chain. */
export interface SafeSeat {
  readonly address: string;
  readonly chainId: number;
}

/**
 * What the gate says: 'open' (no Safe leads, nothing to check), 'ok' (the
 * Safe signed this act, in time), or a refusal: no proof sent, the proof is
 * late, or the proof is not the Safe's signature over this act on this chain.
 */
export type SafeActVerdict = 'open' | 'ok' | 'missing' | 'expired' | 'mismatch';

/** Whether a big act of a community led by `safe` may run with `proof`. Fail closed. */
export async function checkSafeAct(
  deps: FreshDeps,
  safe: SafeSeat | null,
  act: unknown,
  proof: FreshProof | null,
): Promise<SafeActVerdict> {
  if (safe === null) return 'open';
  if (proof === null) return 'missing';
  // The token must name the Safe's chain: a signature on another chain is no signature of this Safe here.
  const claims = await readFreshToken(deps.secret, proof.token);
  if (claims === null || claims.chainId !== safe.chainId) return 'mismatch';
  // checkFresh: our MAC, the clock, the act's digest, the signer (the Safe) and the Safe's own answer.
  return checkFresh(deps, safe.address, act, proof);
}
