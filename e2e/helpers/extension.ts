import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DIST_DIR = path.resolve(import.meta.dirname, '../../dist');

/**
 * Chromium derives an unpacked extension's ID from its absolute path:
 * first 16 bytes of the SHA-256, each nibble mapped onto a–p.
 */
export function unpackedExtensionId(extensionDir: string): string {
  const hash = createHash('sha256').update(path.resolve(extensionDir)).digest();
  let id = '';
  for (const byte of hash.subarray(0, 16)) {
    id += String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15));
  }
  return id;
}

export interface ExtensionSession {
  context: BrowserContext;
  /** The extension's new-tab page (chrome_url_overrides.newtab). */
  page: Page;
  extensionId: string;
  userDataDir: string;
  close: () => Promise<void>;
}

/**
 * Opens a genuine new tab through CDP so Chromium applies the extension's
 * chrome_url_overrides.newtab. Playwright's own newPage() targets about:blank,
 * which never triggers the override.
 */
export async function openOverriddenNewTab(context: BrowserContext): Promise<Page> {
  const newPagePromise = context.waitForEvent('page');
  const cdp = await context.newCDPSession(context.pages()[0]);
  await cdp.send('Target.createTarget', { url: 'chrome://newtab' });
  const page = await newPagePromise;
  await page.waitForLoadState('domcontentloaded');
  return page;
}

export async function launchExtension(
  options: { extraArgs?: string[]; userDataDir?: string; viaNewTab?: boolean } = {}
): Promise<ExtensionSession> {
  const userDataDir =
    options.userDataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'localnotes-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${DIST_DIR}`,
      `--load-extension=${DIST_DIR}`,
      '--no-first-run',
      ...(options.extraArgs ?? []),
    ],
  });
  // Navigating directly to the extension page avoids the native new-tab
  // override bubble, which otherwise queues behind (and blocks) permission
  // prompts. Only the override test itself opens a real new tab.
  const page =
    options.viaNewTab === false
      ? context.pages()[0]
      : await openOverriddenNewTab(context);
  if (options.viaNewTab === false) {
    await page.goto(`chrome-extension://${unpackedExtensionId(DIST_DIR)}/index.html`);
    await page.waitForLoadState('domcontentloaded');
  }
  const match = page.url().match(/^chrome-extension:\/\/([a-z]+)\//);
  if (!match) {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw new Error(`extension page did not load (url: ${page.url()})`);
  }
  return {
    context,
    page,
    extensionId: match[1],
    userDataDir,
    close: async () => {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}
