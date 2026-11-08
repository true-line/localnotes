import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchExtension, openOverriddenNewTab } from './helpers/extension';

// The packed MV3 extension in headful Chromium: new-tab override, real
// browser-storage CRUD across reloads, and JSON export/import.

test('new-tab override plus create/edit/reload/delete and export/import', async () => {
  const session = await launchExtension();
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localnotes-export-'));
  try {
    const { context, page } = session;
    expect(page.url()).toMatch(/^chrome-extension:\/\/[a-z]+\/index\.html$/);

    // Create.
    await page.getByRole('button', { name: 'New note (Cmd+N)' }).click();
    await page.getByRole('textbox', { name: 'Note title' }).fill('Extension note');
    await page
      .getByRole('textbox', { name: 'Note content' })
      .fill('Stored in real Chromium IndexedDB');

    // A second overridden new tab must see the same vault.
    const secondTab = await openOverriddenNewTab(context);
    await expect(secondTab.getByRole('option', { name: /Extension note/ })).toBeVisible();
    await secondTab.close();

    // Edit survives a reload.
    await page.reload();
    await page.getByRole('option', { name: /Extension note/ }).click();
    await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(
      'Extension note'
    );
    await page
      .getByRole('textbox', { name: 'Note content' })
      .fill('Edited after the first reload');
    // Autosave is debounced; wait for the write to reach IndexedDB before reloading.
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('localnotes');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const notes = await new Promise<Array<{ content: string }>>(
            (resolve, reject) => {
              const request = db
                .transaction('notes', 'readonly')
                .objectStore('notes')
                .getAll();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            }
          );
          db.close();
          return notes.map((note) => note.content);
        })
      )
      .toContain('Edited after the first reload');
    await page.reload();
    await page.getByRole('option', { name: /Extension note/ }).click();
    await expect(page.getByRole('textbox', { name: 'Note content' })).toHaveValue(
      'Edited after the first reload'
    );

    // Export produces a real JSON archive download.
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const download = await downloadPromise;
    const archivePath = path.join(exportDir, 'vault.json');
    await download.saveAs(archivePath);
    const archive = JSON.parse(fs.readFileSync(archivePath, 'utf8')) as {
      version: number;
      notes: Array<{ title: string; content: string }>;
    };
    expect(archive.notes.map((note) => note.title)).toContain('Extension note');

    // Delete with confirmation, then restore through a real file import.
    await page.getByRole('button', { name: 'Delete note', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Delete note?' })
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await expect(page.getByRole('option', { name: /Extension note/ })).toHaveCount(0);

    await page.getByTestId('import-file-input').setInputFiles(archivePath);
    await page.getByRole('option', { name: /Extension note/ }).click();
    await expect(page.getByRole('textbox', { name: 'Note content' })).toHaveValue(
      'Edited after the first reload'
    );
  } finally {
    await session.close();
    fs.rmSync(exportDir, { recursive: true, force: true });
  }
});
