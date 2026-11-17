/**
 * v3 «La ciudad y tú»: the city's rail on the left, you at the page's top
 * right (a sticky band with your face; its menu holds what the right rail
 * did), the rail's fold and tooltips, the menu beside its button, and the
 * phone's bottom bar with the «Tú» sheet — against the built site. The e2e
 * server has no auth secrets, so a session is played by the browser.
 */

import { expect, test, type Page } from '@playwright/test';

const box = async (page: Page, selector: string) => {
  const rect = await page.locator(selector).first().boundingBox();
  if (!rect) throw new Error(`${selector} has no box`);
  return rect;
};

/** A person who is in (the face and its whole menu show). */
const signedIn = async (page: Page): Promise<void> => {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      status: 200,
      json: { address: '0x42e6000000000000000000000000000000ca26', rank: 'nomad' },
    }),
  );
};

test.describe('desktop', () => {
  test('1600: the city rail on the left, you at the top right; no right rail, the page takes the width', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await signedIn(page);
    await page.goto('/es/communities/');
    const city = await box(page, 'aside.rail-ciudad');
    expect(city.x).toBe(0);
    expect(city.width).toBe(256);
    await expect(page.locator('aside.rail-tu')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-rail-you', /.*/);
    const band = await box(page, '.cabeza-tu');
    expect(band.x + band.width).toBe(1600);
    expect(band.x).toBe(256);
    expect(band.height).toBeGreaterThanOrEqual(56);
    const main = await box(page, 'main#contenido');
    expect(main.x + main.width).toBe(1600);
    expect(band.y + band.height).toBeLessThanOrEqual(main.y + 1);
    // The face sits at the band's right end.
    const face = await box(page, '[data-metric="chrome-account"]');
    expect(face.x + face.width).toBeLessThanOrEqual(1600 - 24);
    expect(face.x).toBeGreaterThan(1600 - 200);
    // The place you are on takes the fill icon and aria-current.
    const current = page.locator('.rail-ciudad [data-metric="nav-communities"]');
    await expect(current).toHaveAttribute('aria-current', 'page');
    await expect(current.locator('use')).toHaveAttribute('href', '#i-users-three-fill');
  });

  test('your band stays at the top while the page scrolls', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 500 });
    await page.goto('/es/');
    await page.evaluate(() => window.scrollTo(0, 400));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    const band = await box(page, '.cabeza-tu');
    expect(band.y).toBeGreaterThanOrEqual(0);
    expect(band.y).toBeLessThanOrEqual(2);
    await expect(page.locator('[data-metric="you-menu"]')).toBeInViewport();
  });

  test('the city rail’s counters sit right after their words', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/es/');
    const item = page.locator('.rail-ciudad [data-metric="nav-communities"]');
    const word = await item.locator('.rail-t').boundingBox();
    const count = await item.locator('.rail-n').boundingBox();
    expect(count!.x - (word!.x + word!.width)).toBeGreaterThanOrEqual(0);
    expect(count!.x - (word!.x + word!.width)).toBeLessThanOrEqual(12);
  });

  test('1280: the city rail opens and keeps its fold; yours has none', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/es/');
    await expect(page.locator('html')).toHaveAttribute('data-rail-city', 'expanded');
    await expect(page.locator('[data-rail-fold="you"], [data-metric="you-collapse"]')).toHaveCount(
      0,
    );
    await page.locator('[data-metric="nav-collapse"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-rail-city', 'collapsed');
    await expect(page.locator('[data-metric="nav-collapse"]')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(await page.evaluate(() => localStorage.getItem('numinia-sidebar'))).toContain(
      'city=collapsed',
    );
    // The page takes the width the rail gave back; your band follows it.
    expect((await box(page, 'aside.rail-ciudad')).width).toBe(72);
    const band = await box(page, '.cabeza-tu');
    expect(band.x).toBe(72);
    expect(band.x + band.width).toBe(1280);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-rail-city', 'collapsed');
  });

  test('folded, a place shows its name on hover and on focus; Escape hides it (WCAG 1.4.13)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto('/es/');
    await expect(page.locator('html')).toHaveAttribute('data-rail-city', 'collapsed');
    const tip = page.locator('#rail-tip');
    await page.locator('.rail-ciudad [data-metric="nav-worlds"]').hover();
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText('Mundos');
    await page.keyboard.press('Escape');
    await expect(tip).toBeHidden();
    // Your face names itself the same way, under its button (the band is at the top).
    await page.locator('[data-metric="you-menu"]').focus();
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText('Tu menú');
    const tipBox = await tip.boundingBox();
    const face = await box(page, '[data-metric="you-menu"]');
    expect(tipBox!.y).toBeGreaterThanOrEqual(face.y + face.height - 1);
    expect(tipBox!.x).toBeGreaterThanOrEqual(0);
    expect(tipBox!.x + tipBox!.width).toBeLessThanOrEqual(1000);
  });

  test('open, tooltip still shows alongside the words', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/es/');
    await expect(page.locator('html')).toHaveAttribute('data-rail-city', 'expanded');
    await page.locator('.rail-ciudad [data-metric="nav-worlds"]').hover();
    const tip = page.locator('#rail-tip');
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText('Mundos');
  });

  test('your face shows «Tu menú» under it on hover, Escape hides it, a click gives way to the menu', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/es/');
    const tip = page.locator('#rail-tip');
    const face = page.locator('[data-metric="you-menu"]');
    await face.hover();
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText('Tu menú');
    const tipBox = await tip.boundingBox();
    const faceBox = await box(page, '[data-metric="you-menu"]');
    expect(tipBox!.y).toBeGreaterThanOrEqual(faceBox.y + faceBox.height - 1);
    expect(tipBox!.x + tipBox!.width).toBeLessThanOrEqual(1600);
    await page.keyboard.press('Escape');
    await expect(tip).toBeHidden();
    await face.hover({ position: { x: 5, y: 5 } });
    await expect(tip).toBeVisible();
    await face.click();
    await expect(page.locator('#menu-cara')).toBeVisible();
    await expect(tip).toBeHidden();
  });

  test('signed out, the face opens a short menu: the door, the settings, the appearance, the language', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/es/');
    await expect(page.locator('a.tu-entrar')).toBeVisible();
    await expect(page.locator('a.tu-entrar')).toHaveText('Entrar');
    await page.locator('[data-metric="you-menu"]').click();
    const menu = page.locator('#menu-cara');
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-metric="you-menu-sign-in"]')).toBeVisible();
    await expect(menu.locator('[data-metric="chrome-account-settings"]')).toBeVisible();
    await expect(menu.locator('[data-metric="chrome-mode-system"]')).toBeVisible();
    await expect(menu.locator('[data-metric="lang-ja"]')).toBeVisible();
    // What is yours, and «Crear», are for people who are in.
    await expect(menu.locator('[data-metric="you-notices"]')).toBeHidden();
    await expect(menu.locator('[data-metric="you-create-community"]')).toBeHidden();
    await expect(menu.locator('[data-metric="chrome-sign-out"]')).toBeHidden();
  });

  test('signed in, the face opens one menu with your places and «Crear» (real destinations only); Escape gives the focus back', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await signedIn(page);
    await page.goto('/es/');
    const button = page.locator('[data-metric="chrome-account"]');
    await expect(button).toBeVisible();
    await expect(page.locator('[data-metric="you-menu"]')).toBeHidden();
    await expect(page.locator('a.tu-entrar')).toBeHidden();
    await button.click();
    const menu = page.locator('#menu-cara');
    await expect(menu).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    // Everything the right rail held.
    const places = await menu
      .locator(
        'a[data-metric^="you-"]:not([data-metric^="you-create-"], [data-metric^="you-menu"])',
      )
      .evaluateAll((links) => links.map((link) => link.getAttribute('data-metric')));
    expect(places).toEqual([
      'you-notices',
      'you-your-communities',
      'you-agenda',
      'you-worlds',
      'you-balance',
      'you-loot',
    ]);
    const create = menu.locator('a[data-metric^="you-create-"]');
    await expect(create).toHaveCount(3);
    await expect(create.first()).toHaveAttribute('href', '/es/how-it-works/#open');
    await expect(create.nth(1)).toHaveAttribute('href', '/es/crear/encuentro/');
    await expect(create.nth(2)).toHaveAttribute('href', '/es/lap/admin/worlds/');
    await expect(menu).not.toContainText('Pronto');
    // Icon first, then the word, as in the city's rail.
    const notices = menu.locator('[data-metric="you-notices"]');
    const icon = await notices.locator('svg').first().boundingBox();
    const row = await notices.boundingBox();
    expect(icon!.x - row!.x).toBeLessThanOrEqual(24);
    // The menu hangs under the face, inside the window, and fits it.
    const menuBox = await menu.boundingBox();
    const faceBox = await button.boundingBox();
    expect(menuBox!.y).toBeGreaterThanOrEqual(faceBox!.y + faceBox!.height - 1);
    expect(menuBox!.x).toBeGreaterThanOrEqual(0);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(1600);
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(900);
    // Ajustes, then the way out.
    await expect(menu.locator('[data-metric="chrome-account-settings"]')).toBeVisible();
    await expect(menu.locator('[data-metric="chrome-sign-out"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(button).toBeFocused();
  });

  test('«/» opens the search from anywhere but a field', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/es/');
    await page.keyboard.press('/');
    await page.waitForURL('**/es/communities/');
  });

  test('t_7c4d3d1e: «Entrar al mundo» opens at your top right once a world has people', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.route('**/api/live', (route) =>
      route.fulfill({ status: 200, json: { inside: { vic: 3 } } }),
    );
    await page.goto('/es/');
    // One door row per world with a home (TRGCON's too); only the one with people shows.
    const door = page.locator('[data-metric="you-live-world"][data-world-door="vic"]');
    await expect(door).toBeVisible();
    await expect(door).toHaveText('Entrar al mundo');
    await expect(door).toHaveAttribute('href', 'https://vic.numinia.com/');
    await expect(door).toHaveAttribute('target', '_blank');
  });

  test('t_7c4d3d1e: nobody inside, no door at your top right (the fixture answers zero)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/es/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-metric="you-live-world"]:visible')).toHaveCount(0);
  });

  test('the appearance is a segmented control that remembers', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/es/');
    await page.locator('[data-metric="you-menu"]').click();
    await page.locator('[data-metric="chrome-mode-day"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-modo', 'diurno');
    await expect(page.locator('[data-metric="chrome-mode-day"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-modo', 'diurno');
  });

  test('a phone on its side keeps the city rail as an icon edge, and your face at the top right', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto('/es/');
    await expect(page.locator('html')).toHaveAttribute('data-rail-city', 'collapsed');
    await expect(page.locator('html')).not.toHaveAttribute('data-rail-you', /.*/);
    await expect(page.locator('[data-metric="you-menu"]')).toBeVisible();
    await expect(page.locator('nav.barra-movil')).toBeHidden();
    expect((await box(page, 'aside.rail-ciudad')).width).toBe(72);
  });
});

test.describe('phone', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('the rail and your band give way to a header and a bottom bar of four places and «Tú»', async ({
    page,
  }) => {
    await page.goto('/es/communities/');
    await expect(page.locator('aside.rail-ciudad')).toBeHidden();
    await expect(page.locator('.cabeza-tu')).toBeHidden();
    // The Bazar is hidden (BAZAAR_VISIBLE): the header keeps only the search.
    await expect(page.locator('header.borde-movil [data-metric="phone-bazaar"]')).toHaveCount(0);
    const tabs = page.locator('nav.barra-movil a, nav.barra-movil button');
    await expect(tabs).toHaveCount(5);
    for (const tab of await tabs.all()) {
      const rect = await tab.boundingBox();
      expect(rect!.height).toBeGreaterThanOrEqual(44);
      expect(rect!.width).toBeGreaterThanOrEqual(44);
    }
    await expect(page.locator('[data-metric="tab-communities"]')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('«Tú» opens the sheet above the bar, focus goes in, Escape brings it back', async ({
    page,
  }) => {
    await page.goto('/es/');
    const you = page.locator('[data-metric="tab-you"]');
    await you.click();
    const sheet = page.locator('#hoja-tu');
    await expect(sheet).toBeVisible();
    await expect(you).toHaveAttribute('aria-expanded', 'true');
    // Focus goes into the sheet; signed out, the door is there.
    expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await expect(page.locator('[data-metric="sheet-sign-in"]')).toBeVisible();
    const sheetBox = await sheet.boundingBox();
    const bar = await box(page, 'nav.barra-movil');
    expect(sheetBox!.y + sheetBox!.height).toBeLessThanOrEqual(bar.y + 1);
    await expect(page.locator('[data-metric="sheet-create-community"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(you).toBeFocused();
  });

  test('the sheet speaks every language', async ({ page }) => {
    for (const [path, word] of [
      ['/', 'Notices'],
      ['/pt-br/', 'Avisos'],
      ['/ja/', 'お知らせ'],
      ['/ko/', '알림'],
    ] as const) {
      await page.goto(path);
      await page.locator('[data-metric="tab-you"]').click();
      await expect(page.locator('#hoja-tu [data-metric="sheet-notices"]')).toContainText(word);
      await page.keyboard.press('Escape');
    }
  });
});
