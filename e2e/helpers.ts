import { expect, type Page, type PlaywrightWorkerArgs } from '@playwright/test';

export const redis = () => ({
  host: process.env.E2E_REDIS_HOST!,
  port: Number(process.env.E2E_REDIS_PORT),
  db: Number(process.env.E2E_REDIS_DB ?? 0),
});

/** Fill host/port/db for the test Redis in the open connection dialog. */
export async function fillRedis(page: Page) {
  await field(page, 'Host').fill(redis().host);
  await field(page, 'Port').fill(String(redis().port));
  await field(page, 'DB').fill(String(redis().db));
}

/** Field wrappers in the connection dialog are a <Label> followed by an <input>. */
export function field(page: Page, label: string) {
  return page
    .getByRole('dialog')
    .locator('div.space-y-1\\.5')
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator('input');
}

export async function addConnectionViaUi(page: Page, name: string) {
  await page.goto('/connections');
  await page.getByRole('button', { name: 'Add connection' }).click();
  await page.getByPlaceholder('Production').fill(name);
  await fillRedis(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

export const ADMIN = { username: 'e2e-admin', password: 'e2e-admin-pw' };

/** Remove every connection (as admin, whatever role the test uses) so each spec starts empty. */
export async function resetConfig(playwright: PlaywrightWorkerArgs['playwright'], baseURL: string) {
  const admin = await playwright.request.newContext({ baseURL, httpCredentials: ADMIN });
  const res = await admin.post('/api/config/import', { data: { version: 1, connections: [] } });
  expect(res.ok()).toBeTruthy();
  await admin.dispose();
}
