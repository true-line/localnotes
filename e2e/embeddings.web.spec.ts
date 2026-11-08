import { test, expect, type Page, type Request } from '@playwright/test';

// MiniLM integration in a real browser: genuine model download, real network
// fallback, and a cached subsequent startup. The canary string proves note
// content never appears in any network request.

const CANARY = 'NEBULA_CANARY_731';
const NEURAL_DIM = 384; // all-MiniLM-L6-v2 mean-pooled vector
const LOCAL_DIM = 256; // deterministic local fallback embedding

async function createNote(page: Page, title: string, content: string) {
  await page.getByRole('button', { name: 'New note (Cmd+N)' }).click();
  await page.getByRole('textbox', { name: 'Note title' }).fill(title);
  await page.getByRole('textbox', { name: 'Note content' }).fill(content);
}

async function readEmbeddingDims(page: Page): Promise<number[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('localnotes');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const entries = await new Promise<Array<{ vector: number[] }>>(
      (resolve, reject) => {
        const request = db
          .transaction('embeddings', 'readonly')
          .objectStore('embeddings')
          .getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }
    );
    db.close();
    return entries.map((entry) => entry.vector.length);
  });
}

function isModelHost(url: string): boolean {
  const hostname = new URL(url).hostname;
  return hostname === 'huggingface.co' || hostname.endsWith('.huggingface.co');
}

async function blockModelNetwork(page: Page): Promise<void> {
  await page.route('**/*', (route) => {
    if (isModelHost(route.request().url())) return route.abort();
    return route.continue();
  });
}

test('model download, cached offline restart, and zero note-content egress', async ({
  page,
}) => {
  test.setTimeout(240_000); // real ~23 MB weight download plus WASM inference
  const requests: Request[] = [];
  page.on('request', (request) => requests.push(request));

  await page.goto('/');
  await createNote(page, 'Canary note', `Sensitive text ${CANARY} stays on device`);
  await expect
    .poll(() => readEmbeddingDims(page), { timeout: 180_000 })
    .toEqual([NEURAL_DIM]);

  // Subsequent startup with the model network unreachable: the cached weights
  // must serve re-embedding without a single model-host request.
  await blockModelNetwork(page);
  let modelRequestsAfterCache = 0;
  page.on('request', (request) => {
    if (isModelHost(request.url())) modelRequestsAfterCache += 1;
  });
  await page.reload();
  await page.getByRole('option', { name: /Canary note/ }).click();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(
    'Canary note'
  );
  await page
    .getByRole('textbox', { name: 'Note content' })
    .fill(`Sensitive text ${CANARY} stays on device, edited offline`);
  await expect
    .poll(() => readEmbeddingDims(page), { timeout: 120_000 })
    .toEqual([NEURAL_DIM]);
  expect(modelRequestsAfterCache).toBe(0);

  for (const request of requests) {
    expect(request.url()).not.toContain(CANARY);
    expect(request.postData() ?? '').not.toContain(CANARY);
  }
});

test('unavailable model network falls back to local embeddings', async ({ page }) => {
  await blockModelNetwork(page);
  await page.goto('/');
  await createNote(page, 'Offline note', 'Local semantic indexing still works offline');
  await expect
    .poll(() => readEmbeddingDims(page), { timeout: 60_000 })
    .toEqual([LOCAL_DIM]);
  // The note remains fully usable: search finds it through the palette.
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search notes and commands' }).fill('Offline');
  await expect(
    page
      .getByRole('dialog', { name: 'Command palette' })
      .getByRole('option', { name: /Offline note/ })
  ).toBeVisible();
});
