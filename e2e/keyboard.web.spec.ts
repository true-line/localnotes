import { test, expect } from '@playwright/test';

// Keyboard/focus smoke path over the palette, delete dialog, and agent drawer.

test('palette, delete dialog, and agent drawer keyboard and focus behavior', async ({
  page,
}) => {
  await page.goto('/');
  // Shortcuts are inert until the app finishes loading its vault.
  await expect(page.getByRole('button', { name: 'New note (Cmd+N)' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+n');
  await page.getByRole('textbox', { name: 'Note title' }).fill('Keyboard note');
  await page.getByRole('textbox', { name: 'Note content' }).fill('focus checks');

  // Palette opens with its search focused and selects the note by title.
  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  const search = page.getByRole('combobox', { name: 'Search notes and commands' });
  await expect(search).toBeFocused();
  await search.fill('Keyboard note');
  await page.keyboard.press('Enter');
  await expect(palette).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(
    'Keyboard note'
  );

  // Delete dialog focuses Cancel (safe default) and Escape dismisses it.
  await page.getByRole('button', { name: 'Delete note', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete note?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(
    'Keyboard note'
  );

  // Agent drawer opens with the composer focused; Escape closes it.
  await page.keyboard.press('ControlOrMeta+j');
  const chat = page.getByRole('complementary', { name: 'Agent chat' });
  await expect(chat).toBeVisible();
  await expect(chat.getByRole('textbox', { name: 'Message the agent' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(chat).toHaveCount(0);
});
