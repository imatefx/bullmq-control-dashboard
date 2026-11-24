import { expect, test } from '@playwright/test';
import { addConnectionViaUi, field, fillRedis, resetConfig } from './helpers';

test.beforeEach(async ({ playwright, baseURL }) => {
  await resetConfig(playwright, baseURL!);
});

test('requires authentication', async ({ playwright, baseURL }) => {
  const anon = await playwright.request.newContext({ baseURL, httpCredentials: undefined });
  const res = await anon.get('/');
  expect(res.status()).toBe(401);
  expect(res.headers()['www-authenticate']).toMatch(/^Basic/);
  await anon.dispose();
});

test('admin connects a Redis, enables queues and sees live counts', async ({ page }) => {
  await page.goto('/connections');
  await expect(page.getByText('No Redis connections yet')).toBeVisible();
  await expect(page.getByText('e2e-admin · admin')).toBeVisible();

  // Test the connection from the dialog before saving it.
  await page.getByRole('button', { name: 'Add connection' }).click();
  await page.getByPlaceholder('Production').fill('Local Redis');
  await fillRedis(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Test' }).click();
  await expect(page.getByText(/Connected · Redis 7\./)).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();

  // The card reports the sync: 3 queues discovered, none registered yet.
  await expect(page.getByText('Local Redis')).toBeVisible();
  await expect(page.getByText('ok · 0/3')).toBeVisible();

  // Queues page lists discovered queues, including the ':' one.
  await page.getByRole('link', { name: 'Queues' }).click();
  await expect(page.getByRole('heading', { name: 'Queues · Local Redis' })).toBeVisible();
  for (const name of ['emails', 'billing', '260:v1.bulkSync']) {
    await expect(page.getByRole('cell', { name, exact: true })).toBeVisible();
  }

  // The name cell gains a "live" badge, so match on the leading queue name.
  const queueRow = (name: string) =>
    page.getByRole('row').filter({ has: page.getByRole('cell', { name: new RegExp(`^${name.replace(/\./g, '\\.')}( |$)`) }) });
  const emails = queueRow('emails');
  await emails.getByRole('switch').last().click();
  await expect(emails.getByText('live')).toBeVisible();

  const bulk = queueRow('260:v1.bulkSync');
  await bulk.getByRole('switch').last().click();
  await expect(bulk.getByText('live')).toBeVisible();

  // Overview shows real job counts from Redis.
  await page.getByRole('link', { name: 'Overview' }).click();
  await expect(page.getByText('Live queues (2)')).toBeVisible();
  const overviewRow = page.getByRole('row').filter({ hasText: 'emails' });
  await expect(overviewRow.getByRole('cell').nth(3)).toHaveText('4'); // waiting
  await expect(page.getByRole('row').filter({ hasText: '260:v1.bulkSync' }).getByRole('cell').nth(3)).toHaveText('2');
});

test('the embedded bull-board shows enabled queues', async ({ page }) => {
  await addConnectionViaUi(page, 'Board Redis');
  const [conn] = await (await page.request.get('/api/connections')).json();
  await page.request.post(`/api/connections/${conn.id}/queues`, { data: { name: 'billing', enabled: true } });

  await page.goto('/board');
  const board = page.frameLocator('iframe');
  await expect(board.getByText('billing').first()).toBeVisible({ timeout: 15_000 });
});

test('a connection to an unreachable Redis shows an error instead of hanging', async ({ page }) => {
  await page.goto('/connections');
  await page.getByRole('button', { name: 'Add connection' }).click();
  await page.getByPlaceholder('Production').fill('Dead Redis');
  await field(page, 'Host').fill('127.0.0.1');
  await field(page, 'Port').fill('1');
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 20_000 });
  await expect(page.getByText('Dead Redis')).toBeVisible();
  await expect(page.getByText(/Redis did not respond within 10s/)).toBeVisible({ timeout: 20_000 });
});

test.describe('reader role', () => {
  test.use({ httpCredentials: { username: 'e2e-reader', password: 'e2e-reader-pw' } });

  test('can browse but has no write controls and is blocked by the API', async ({ page, browser, baseURL }) => {
    const admin = await browser.newContext({
      baseURL,
      httpCredentials: { username: 'e2e-admin', password: 'e2e-admin-pw' },
    });
    const adminPage = await admin.newPage();
    await addConnectionViaUi(adminPage, 'Shared Redis');
    await admin.close();

    await page.goto('/connections');
    await expect(page.getByText('e2e-reader · reader')).toBeVisible();
    await expect(page.getByText('Shared Redis')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add connection' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);

    await page.goto('/queues');
    await expect(page.getByRole('cell', { name: 'emails', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enable all' })).toHaveCount(0);

    const res = await page.request.post('/api/config/import', { data: { version: 1, connections: [] } });
    expect(res.status()).toBe(403);
  });
});
