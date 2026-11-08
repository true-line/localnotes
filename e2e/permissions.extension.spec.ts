import { test, expect } from '@playwright/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { launchExtension } from './helpers/extension';

// Real optional-host-permission behavior in Chromium. The endpoint deliberately
// sends NO CORS headers, so an extension-page fetch only succeeds once the
// host permission is actually granted — denial and grant are both observed as
// real network behavior, not mocks. (Chromium's native prompt cannot be driven
// by automation; under Playwright the request resolves through the real
// chrome.permissions API either way.)

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

test('granting optional host access enables real endpoint access', async () => {
  // Chromium's native permission bubble is not drivable by browser automation.
  // --deny-permission-prompts auto-resolves the prompt through Chromium's own
  // permission path (for extension optional-host requests that resolution is a
  // grant), so the real chrome.permissions.request completes without hanging.
  const session = await launchExtension({
    extraArgs: ['--deny-permission-prompts'],
    viaNewTab: false,
  });
  try {
    const { page } = session;
    const state = await page.evaluate(async (base) => {
      const granted =
        (await chrome?.permissions?.request({ origins: [`${base}/*`] })) ?? false;
      const hasPermission =
        (await chrome?.permissions?.contains({ origins: [`${base}/*`] })) ?? false;
      const models = await fetch(`${base}/models`)
        .then((response) => response.json())
        .catch(() => null);
      return { granted, hasPermission, models };
    }, origin);
    expect(state.granted).toBe(true);
    expect(state.hasPermission).toBe(true);
    expect(state.models).toEqual({ data: [{ id: 'e2e-model' }] });
  } finally {
    await session.close();
  }
});
