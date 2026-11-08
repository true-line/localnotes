import { test, expect } from '@playwright/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { launchExtension } from './helpers/extension';

// Real optional-host-permission behavior in Chromium. The endpoint deliberately
// sends NO CORS headers, so an extension-page fetch only succeeds once the
// host permission is actually granted — denial and grant are both observed as
// real network behavior, not mocks.

let server: http.Server;
let origin: string;

test.beforeEach(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'e2e-model' }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});

test('no host permissions at install and endpoint access denied without a grant', async () => {
  const session = await launchExtension({ viaNewTab: false });
  try {
    const { page } = session;
    const state = await page.evaluate(async (base) => {
      const hasPermission =
        (await chrome?.permissions?.contains({ origins: [`${base}/*`] })) ?? false;
      let fetchOk = true;
      try {
        await fetch(`${base}/models`);
      } catch {
        fetchOk = false;
      }
      return { hasPermission, fetchOk };
    }, origin);
    expect(state.hasPermission).toBe(false);
    expect(state.fetchOk).toBe(false);
  } finally {
    await session.close();
  }
});

// Chromium's native permission bubble is not drivable by browser automation:
// on stock Chromium (CI included) it waits for a human click, and no supported
// switch auto-accepts extension optional-host prompts. This test therefore runs
// only interactively: E2E_INTERACTIVE_PROMPTS=1 npx playwright test --project=extension
// and click Allow (or Deny for the denial variant) when the bubble appears.
test('granting optional host access through the app enables the endpoint', async () => {
  test.skip(
    process.env.E2E_INTERACTIVE_PROMPTS !== '1',
    'Native permission prompt needs a human; run with E2E_INTERACTIVE_PROMPTS=1.'
  );
  test.setTimeout(180_000); // time to read and click the native prompt
  const session = await launchExtension({ viaNewTab: false });
  try {
    const { page } = session;
    await expect(page.getByRole('button', { name: 'New note (Cmd+N)' })).toBeVisible();
    await page.keyboard.press('ControlOrMeta+j');
    const chat = page.getByRole('complementary', { name: 'Agent chat' });
    await chat.getByLabel('Agent', { exact: true }).selectOption('openai');
    await chat.getByText('Remote provider settings').click();
    await chat.getByLabel('Base URL').fill(`${origin}/v1`);
    await chat.getByRole('button', { name: 'Grant network access' }).click();
    await expect(page.getByRole('status')).toHaveText(
      `Access granted for ${origin}/*`,
      { timeout: 120_000 }
    );

    const state = await page.evaluate(async (base) => {
      const hasPermission =
        (await chrome?.permissions?.contains({ origins: [`${base}/*`] })) ?? false;
      const models = await fetch(`${base}/models`)
        .then((response) => response.json())
        .catch(() => null);
      return { hasPermission, models };
    }, origin);
    expect(state.hasPermission).toBe(true);
    expect(state.models).toEqual({ data: [{ id: 'e2e-model' }] });
  } finally {
    await session.close();
  }
});

test('denying optional host access through the app keeps the endpoint blocked', async () => {
  test.skip(
    process.env.E2E_INTERACTIVE_PROMPTS !== '1',
    'Native permission prompt needs a human; run with E2E_INTERACTIVE_PROMPTS=1.'
  );
  test.setTimeout(180_000);
  const session = await launchExtension({ viaNewTab: false });
  try {
    const { page } = session;
    await expect(page.getByRole('button', { name: 'New note (Cmd+N)' })).toBeVisible();
    await page.keyboard.press('ControlOrMeta+j');
    const chat = page.getByRole('complementary', { name: 'Agent chat' });
    await chat.getByLabel('Agent', { exact: true }).selectOption('openai');
    await chat.getByText('Remote provider settings').click();
    await chat.getByLabel('Base URL').fill(`${origin}/v1`);
    await chat.getByRole('button', { name: 'Grant network access' }).click();
    // Click Deny in the native bubble when it appears.
    await expect(page.getByRole('status')).toHaveText(
      `Access not granted for ${origin}/*`,
      { timeout: 120_000 }
    );

    const state = await page.evaluate(async (base) => {
      const hasPermission =
        (await chrome?.permissions?.contains({ origins: [`${base}/*`] })) ?? false;
      let fetchOk = true;
      try {
        await fetch(`${base}/models`);
      } catch {
        fetchOk = false;
      }
      return { hasPermission, fetchOk };
    }, origin);
    expect(state.hasPermission).toBe(false);
    expect(state.fetchOk).toBe(false);
  } finally {
    await session.close();
  }
});
