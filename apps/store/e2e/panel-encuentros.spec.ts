/**
 * «Encuentros» in the organization panel (v3, carril 5), in a real browser
 * against the built site. The e2e server has no auth secrets, so the session
 * and the till's list of accounts are played by the browser (`page.route`),
 * as in panel-agentes.spec.ts; the encounters are the register's own, made
 * into the page when the site was built — what is under test is that each
 * organization finds its community's encounters: by the account in the
 * community's `team:` (Numen Games), by the one the house opens for it
 * (COMMIT, the id derived as lib/community-teams.ts derives it), and an
 * organization with no community page is told so. Plus the rail, the five
 * locales, the phone and axe.
 *
 * With SHOTS_DIR set, the screens are also saved as screenshots there.
 */

import { createHash } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const ME = '0x42e6000000000000000000000000000000ca26';

/** lib/community-teams.ts `communityAccountId`, in Node. */
const derived = (communityId: string) =>
  `acc_t_${createHash('sha256').update(`numinia-till community ${communityId}`).digest('hex').slice(0, 32)}`;

const GAMES = {
  id: 'acc_t_2e2dd18c880ba974da1512dc7cde2431',
  kind: 'team',
  name: 'Numen Games',
  role: 'owner',
  balanceCents: 0,
};
const COMMIT = {
  id: derived('commit-conf'),
  kind: 'team',
  name: 'COMMIT',
  role: 'admin',
  balanceCents: 0,
};
const LONE = { id: 'acc_t_lone', kind: 'team', name: 'Sin página', role: 'owner', balanceCents: 0 };

async function signedIn(page: Page): Promise<void> {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({ status: 200, json: { address: ME, rank: 'nomad' } }),
  );
  await page.route('**/api/saldo', (route) =>
    route.fulfill({ json: { accounts: [GAMES, COMMIT, LONE] } }),
  );
}

/**
 * What the panel lists for a community, read from the page: the figure in
 * each heading («Próximos · N», «Ya celebrados · M») and the rows under it.
 * Which encounter is upcoming and which held moves with the clock (the build
 * settles an upcoming one whose end passed), so the specs compare the page
 * with itself and with the community's own calendar, never with a hand-kept
 * list of ids.
 */
async function lists(page: Page, id: string) {
  return page.locator(`[data-gatherings="${id}"]`).evaluate((section) => {
    const out: { heading: string; count: number; ids: string[] }[] = [];
    for (const node of Array.from(section.children)) {
      if (node.matches('h2.encuentros-h2')) {
        const heading = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
        out.push({ heading, count: Number(heading.split('·').pop()?.trim()), ids: [] });
      } else if (out.length > 0 && node.matches('ul')) {
        out[out.length - 1]!.ids = Array.from(node.querySelectorAll('[data-gathering]')).map(
          (row) => row.getAttribute('data-gathering') ?? '',
        );
      }
    }
    return { upcoming: out[0]!, held: out[1]! };
  });
}

/** The community's calendar feed: each encounter's id and first day, in feed order. */
async function starts(page: Page, community: string): Promise<Map<string, string>> {
  const response = await page.request.get(`/communities/${community}/calendar.ics`);
  const found = new Map<string, string>();
  for (const event of (await response.text()).split('BEGIN:VEVENT').slice(1)) {
    const id = /UID:(.+?)@/.exec(event)?.[1];
    const day = /DTSTART[^:]*:(\d{8})/.exec(event)?.[1];
    if (id && day) found.set(id, day);
  }
  return found;
}

// The Numinia anniversary ended on 2026-11-03: held for good, whatever today is.
const ANNIVERSARY = 'numinia-anniversary-2026';

const panel = (page: Page) => page.locator('[data-org-panel]');

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
}

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['SHOTS_DIR'];
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

test.describe('the panel’s «Encuentros»', () => {
  test('is a link in the rail now, and leads to its own page with the organization kept', async ({
    page,
  }) => {
    await signedIn(page);
    await open(page, `/es/panel/?org=${GAMES.id}`);
    const link = page.locator('[data-org-rail] a[data-metric="panel-nav-gatherings"]');
    await expect(link).toHaveText('Encuentros');
    await expect(link).toHaveAttribute('href', `/es/panel/encuentros/?org=${GAMES.id}`);
    await link.click();
    await expect(page).toHaveURL(`/es/panel/encuentros/?org=${GAMES.id}`);
    await expect(page.locator('h1')).toHaveText('Encuentros');
    await expect(page.locator('[data-org-rail] a[aria-current="page"]')).toHaveAttribute(
      'data-metric',
      'panel-nav-gatherings',
    );
  });

  test('lists the community’s upcoming encounters, nearest first, with the ways to its page and its calendar', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signedIn(page);
    await open(page, `/es/panel/encuentros/?org=${GAMES.id}`);
    const list = page.locator('[data-gatherings="numen-games"]');
    await expect(list).toContainText('Su comunidad');
    await expect(list).toContainText('Numen Games');
    await expect(list.locator('[data-metric="panel-gatherings-community"]')).toHaveAttribute(
      'href',
      '/es/communities/numen-games/',
    );
    await expect(list.locator('[data-metric="panel-gatherings-subscribe"]')).toHaveAttribute(
      'href',
      '/communities/numen-games/calendar.ics',
    );
    const { upcoming, held } = await lists(page, 'numen-games');
    // The figure in each heading is the rows under it.
    expect(upcoming.heading).toMatch(/^Próximos · \d+$/);
    expect(held.heading).toMatch(/^Ya celebrados · \d+$/);
    expect(upcoming.count).toBe(upcoming.ids.length);
    expect(held.count).toBe(held.ids.length);
    // Each encounter is in exactly one list; the anniversary is over for good.
    expect(upcoming.ids).not.toContain(ANNIVERSARY);
    expect(held.ids).toContain(ANNIVERSARY);
    expect(new Set([...upcoming.ids, ...held.ids]).size).toBe(
      upcoming.ids.length + held.ids.length,
    );
    const anniversary = list.locator(`[data-gathering="${ANNIVERSARY}"]`);
    await expect(anniversary.locator('a')).toHaveAttribute('href', `/es/rituals/${ANNIVERSARY}/`);
    await expect(anniversary).toContainText('El Aniversario de Numinia');
    await expect(anniversary).toContainText('2026');
    // Upcoming nearest first, by the community's own calendar.
    const days = await starts(page, 'numen-games');
    const dayList = upcoming.ids.map((id) => days.get(id) ?? '');
    expect(dayList.every((day) => day !== '')).toBe(true);
    expect(dayList).toEqual([...dayList].sort());
    // An empty list says so, not an empty box.
    await expect(list.locator('[data-gatherings-empty]')).toHaveCount(
      (upcoming.count === 0 ? 1 : 0) + (held.count === 0 ? 1 : 0),
    );
    await shot(page, 'panel-encuentros-desktop');
  });

  test('finds a community by the account the house opens for it, and lists what it already held', async ({
    page,
  }) => {
    await signedIn(page);
    await open(page, `/es/panel/encuentros/?org=${COMMIT.id}`);
    const list = page.locator('[data-gatherings="commit-conf"]');
    await expect(list).toContainText('Próximos · 0');
    await expect(list.locator('[data-gatherings-empty]').first()).toHaveText(
      'Todavía no hay ninguno publicado.',
    );
    await expect(list).toContainText('Ya celebrados · 1');
    await expect(list.locator('[data-gathering="commit-conf-2026"] a')).toHaveAttribute(
      'href',
      '/es/rituals/commit-conf-2026/',
    );
  });

  test('an organization with no page in Communities is told so, with no list', async ({ page }) => {
    await signedIn(page);
    await open(page, `/es/panel/encuentros/?org=${LONE.id}`);
    await expect(page.locator('[data-gatherings-none]')).toContainText(
      'Esta organización no tiene todavía página en Comunidades',
    );
    await expect(page.locator('[data-gathering]')).toHaveCount(0);
  });

  for (const [prefix, title, upcoming] of [
    ['', 'Gatherings', 'Coming · '],
    ['/ja', '集まり', 'これから · '],
    ['/ko', '모임', '다가오는 모임 · '],
    ['/pt-br', 'Encontros', 'Próximos · '],
  ] as const) {
    test(`speaks ${prefix || '/en'}`, async ({ page }) => {
      await signedIn(page);
      await open(page, `${prefix}/panel/encuentros/?org=${GAMES.id}`);
      await expect(page.locator('h1')).toHaveText(title);
      const { upcoming: coming } = await lists(page, 'numen-games');
      expect(coming.heading.startsWith(upcoming)).toBe(true);
      expect(coming.count).toBe(coming.ids.length);
      await expect(page.locator(`[data-gathering="${ANNIVERSARY}"] a`)).toHaveAttribute(
        'href',
        `${prefix}/rituals/${ANNIVERSARY}/`,
      );
    });
  }

  test('fits a phone, and axe finds nothing', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signedIn(page);
    await open(page, `/es/panel/encuentros/?org=${GAMES.id}`);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
    await shot(page, 'panel-encuentros-mobile');
    const results = await new AxeBuilder({ page }).include('[data-org-content]').analyze();
    expect(results.violations).toEqual([]);
  });

  test('on a wide screen axe finds nothing either, for the page with no community', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signedIn(page);
    await open(page, `/es/panel/encuentros/?org=${LONE.id}`);
    await shot(page, 'panel-encuentros-sin-comunidad-desktop');
    const results = await new AxeBuilder({ page }).include('[data-org-content]').analyze();
    expect(results.violations).toEqual([]);
  });
});
