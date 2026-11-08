import { test, expect } from '@playwright/test';
import { startOpenAIContractServer } from './helpers/openaiServer';

// Contract test against a live OpenAI-compatible endpoint: streaming SSE,
// tool-schema advertising, and a multi-round tool-call loop driven through
// the real app UI (no provider mocks).

test('streams a multi-round tool-call conversation against a local endpoint', async ({
  page,
}) => {
  const server = await startOpenAIContractServer();
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'New note (Cmd+N)' }).click();
    await page.getByRole('textbox', { name: 'Note title' }).fill('Grocery list');
    await page.getByRole('textbox', { name: 'Note content' }).fill('Buy milk and eggs');

    await page.keyboard.press('ControlOrMeta+j');
    const chat = page.getByRole('complementary', { name: 'Agent chat' });
    await expect(chat).toBeVisible();

    await chat.getByLabel('Agent', { exact: true }).selectOption('openai');
    await chat.getByText('Remote provider settings').click();
    await chat.getByLabel('Base URL').fill(server.baseUrl);
    await chat.getByLabel('Model', { exact: true }).fill('e2e-model');
    await chat.getByRole('button', { name: 'Save', exact: true }).click();

    await chat.getByRole('textbox', { name: 'Message the agent' }).fill('Where is milk?');
    await chat.getByRole('button', { name: 'Send message' }).click();

    // Both tool rounds render their results in the transcript.
    await expect(chat.locator('.agent-chat__tool summary').nth(0)).toContainText(
      'notes.search'
    );
    await expect(chat.locator('.agent-chat__tool summary').nth(1)).toContainText(
      'notes.recent'
    );
    await expect(chat.locator('.agent-chat__msg--assistant').last()).toContainText(
      'Milk is on your grocery list.'
    );

    // The endpoint saw three streaming rounds, tool schemas throughout, and
    // both tool results fed back as tool messages.
    expect(server.requests).toHaveLength(3);
    for (const request of server.requests) {
      expect(request.body.stream).toBe(true);
      expect(request.body.model).toBe('e2e-model');
      expect(request.body.tools?.length).toBeGreaterThan(0);
    }
    const finalMessages = server.requests[2].body.messages ?? [];
    expect(finalMessages.filter((m) => m.role === 'tool')).toHaveLength(2);
    const lastMessage = finalMessages[finalMessages.length - 1];
    expect(lastMessage?.role).toBe('tool');
    expect(lastMessage?.tool_call_id).toBe('call-recent');
    expect(
      finalMessages.find((m) => m.role === 'tool' && m.tool_call_id === 'call-search')
        ?.content
    ).toContain('Grocery list');
  } finally {
    await server.close();
  }
});
