import { test, expect } from '@playwright/test';

const APP_PROJECT = (name) => name.startsWith('app-');

test('responsive shell keeps controls on the right without horizontal overflow', async ({ page }, testInfo) => {
  test.skip(!APP_PROJECT(testInfo.project.name), 'uses the authenticated app fixture');
  for (const width of [360, 768, 1024, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/chats');
    await page.waitForSelector('#root > *');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);

    const notify = await page.getByRole('link', { name: /^Notifications/ }).boundingBox();
    const menu = await page.getByRole('button', { name: /menu|sidebar/i }).boundingBox();
    expect(notify).not.toBeNull();
    expect(menu).not.toBeNull();
    expect(menu.x).toBeGreaterThan(notify.x);

    if (width < 768) {
      const logo = await page.getByRole('link', { name: 'Conclave, home' }).boundingBox();
      expect(logo).not.toBeNull();
      expect(logo.x + logo.width).toBeLessThan(notify.x);
    }
  }
});

test('open room keeps its mobile room header and form pages remain capped', async ({ page }, testInfo) => {
  test.skip(!APP_PROJECT(testInfo.project.name), 'uses the authenticated app fixture');
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/chats/preview-room');
  await page.waitForSelector('#root > *');
  await expect(page.getByRole('link', { name: /back to chats/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Notifications/ })).toBeHidden();

  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.goto('/settings');
  const formContent = await page.locator('main > div > div').boundingBox();
  expect(formContent).not.toBeNull();
  expect(formContent.width).toBeLessThanOrEqual(672);
});

test('message actions open a thread panel with its reply action', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'app-desktop', 'the action menu is hover-revealed on desktop');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/chats/preview-room');
  await page.waitForSelector('#root > *');
  await page.getByRole('button', { name: 'Message actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Open thread' }).click();
  await expect(page.getByRole('complementary', { name: 'Message thread' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reply in thread' })).toBeVisible();
});
