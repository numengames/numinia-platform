import { describe, expect, it, vi } from 'vitest';
import { createThirdwebClient } from 'thirdweb';
import { verifyEOASignature } from 'thirdweb/auth';
import { privateKeyToAccount } from 'thirdweb/wallets';
import { toBase64Url } from '@numinia/auth';
import { checkSafeAct, type SafeSeat } from '../safe-act-gate';
import {
  FRESH_TTL_MS,
  actDigest,
  freshMessage,
  issueFreshToken,
  type FreshClaims,
  type FreshDeps,
} from '../fresh-signature';
import { FRESH_SIGNATURE_WORDS } from '../../i18n/fresh-signature';
import { readSettings } from '../accounts';

const SECRET = 'q'.repeat(40);
const NOW = Date.parse('2026-10-30T18:00:00.000Z');
const SAFE: SafeSeat = { address: `0x${'5a'.repeat(20)}`, chainId: 84532 };
const OTHER_SAFE: SafeSeat = { address: `0x${'6b'.repeat(20)}`, chainId: 84532 };
// A big act of an organization led by a Safe: giving it the owners' own act.
const ACT = { action: 'remove-member', accountId: 'acc', wallet: `0x${'cd'.repeat(20)}` };
const OTHER_ACT = { action: 'remove-member', accountId: 'acc', wallet: `0x${'ef'.repeat(20)}` };

/** A key of its own for one owner of the Safe: never one written down. */
function ownerKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const privateKey = `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  return privateKeyToAccount({ client: createThirdwebClient({ clientId: 'test' }), privateKey });
}

/** The Safe's own answer, as the chain gives it: only its address, on its chain, with the threshold met. */
const safeSaysYes = vi.fn(
  async ({
    address,
    chainId,
    signature,
  }: {
    address: string;
    chainId: number | null;
    signature: string;
  }) => address === SAFE.address && chainId === SAFE.chainId && signature === 'threshold-met',
);

function deps(overrides: Partial<FreshDeps> = {}): FreshDeps {
  return { secret: SECRET, verify: safeSaysYes, now: () => NOW, ...overrides };
}

/** A token the Safe's lines are issued in, for `act`, on `chainId`, naming `wallet`. */
async function tokenFor(
  wallet: string,
  chainId: number | null,
  act: unknown = ACT,
  expiresAt = NOW + FRESH_TTL_MS,
): Promise<{ token: string; message: string }> {
  const message = freshMessage(FRESH_SIGNATURE_WORDS['en'], 'en', expiresAt, {
    kind: 'give',
    organization: 'Comunidad',
    role: 'owner',
    permissions: ['administrator'],
    who: '0xcd…cd',
  });
  const claims: FreshClaims = {
    wallet,
    act: await actDigest(act),
    message,
    chainId,
    expiresAt,
  };
  return { token: await issueFreshToken(SECRET, claims), message };
}

describe('a community led by a Safe: its big acts', () => {
  it('is open when no Safe leads the community: the two owners keep their own rules', async () => {
    safeSaysYes.mockClear();
    expect(await checkSafeAct(deps(), null, ACT, null)).toBe('open');
    expect(safeSaysYes).not.toHaveBeenCalled();
  });

  it('refuses a big act with no proof at all', async () => {
    expect(await checkSafeAct(deps(), SAFE, ACT, null)).toBe('missing');
  });

  it('runs the big act when the Safe signed this very act, in time, on its chain', async () => {
    safeSaysYes.mockClear();
    const { token } = await tokenFor(SAFE.address, SAFE.chainId);
    const verdict = await checkSafeAct(deps(), SAFE, ACT, { token, signature: 'threshold-met' });
    expect(verdict).toBe('ok');
    expect(safeSaysYes).toHaveBeenCalledWith(
      expect.objectContaining({ address: SAFE.address, chainId: SAFE.chainId }),
    );
  });

  it('does not run the big act on one owner’s signature below the threshold', async () => {
    // The owner signs with its own key; the Safe is not that key, so the EOA check refuses it.
    const owner = ownerKey();
    const { token, message } = await tokenFor(SAFE.address, SAFE.chainId);
    const signature = await owner.signMessage({ message });
    const single = deps({
      verify: ({ message: text, signature: sig, address }) =>
        verifyEOASignature({ message: text, signature: sig, address }),
    });
    expect(await checkSafeAct(single, SAFE, ACT, { token, signature })).toBe('mismatch');
  });

  it('refuses a Safe signature that does not reach the Safe’s chain or address', async () => {
    const onOtherChain = await tokenFor(SAFE.address, 1);
    expect(
      await checkSafeAct(deps(), SAFE, ACT, {
        token: onOtherChain.token,
        signature: 'threshold-met',
      }),
    ).toBe('mismatch');
    const otherSafe = await tokenFor(OTHER_SAFE.address, SAFE.chainId);
    expect(
      await checkSafeAct(deps(), SAFE, ACT, { token: otherSafe.token, signature: 'threshold-met' }),
    ).toBe('mismatch');
  });

  it('refuses a proof for another act, a late proof, and a token not ours', async () => {
    const { token } = await tokenFor(SAFE.address, SAFE.chainId, OTHER_ACT);
    expect(await checkSafeAct(deps(), SAFE, ACT, { token, signature: 'threshold-met' })).toBe(
      'mismatch',
    );
    const late = await tokenFor(SAFE.address, SAFE.chainId, ACT, NOW - 1);
    expect(
      await checkSafeAct(deps(), SAFE, ACT, { token: late.token, signature: 'threshold-met' }),
    ).toBe('expired');
    const forged = `f1.${toBase64Url(new TextEncoder().encode('{}'))}.AAAA`;
    expect(
      await checkSafeAct(deps(), SAFE, ACT, { token: forged, signature: 'threshold-met' }),
    ).toBe('mismatch');
  });
});

describe('the Safe read from the till’s settings', () => {
  const settings = (safe: unknown) => ({
    settings: {
      accountId: 'acc',
      off: [],
      vocabulary: 'mixed',
      mayEdit: true,
      aiAgent: { enabled: true, model: 'm', trialCapCents: 1, spentCents: 0 },
      ...(safe === undefined ? {} : { safe }),
    },
  });

  it('is null when the till sends none, or null: the two owners', () => {
    expect(readSettings(settings(undefined))).toMatchObject({ ok: true, safe: null });
    expect(readSettings(settings(null))).toMatchObject({ ok: true, safe: null });
  });

  it('is the Safe’s address and chain when the till sends one', () => {
    expect(readSettings(settings({ address: SAFE.address, chainId: SAFE.chainId }))).toMatchObject({
      ok: true,
      safe: SAFE,
    });
  });

  it('refuses the whole answer when the Safe is not a Safe', () => {
    expect(readSettings(settings('0x5a'))).toBeNull();
    expect(readSettings(settings({ address: '0xABC', chainId: 84532 }))).toBeNull();
    expect(readSettings(settings({ address: SAFE.address, chainId: 0 }))).toBeNull();
    expect(readSettings(settings({ address: SAFE.address, chainId: 1.5 }))).toBeNull();
  });
});
