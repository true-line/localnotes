import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  body: {
    model?: string;
    stream?: boolean;
    tools?: unknown[];
    messages?: Array<{ role: string; content: string | null; tool_call_id?: string }>;
  };
}

export interface OpenAIContractServer {
  /** Base URL including the /v1 suffix, as the provider expects it. */
  baseUrl: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

function sseChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function textDelta(content: string): string {
  return sseChunk({ choices: [{ delta: { content } }] });
}

function toolCallDelta(id: string, name: string, args: string, first: boolean): string {
  return sseChunk({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              ...(first ? { id } : {}),
              function: { ...(first ? { name } : {}), arguments: args },
            },
          ],
        },
      },
    ],
  });
}

/**
 * A local OpenAI-compatible chat-completions server with a scripted
 * multi-round tool-call conversation:
 *   round 1 (user message)      → streamed notes.search tool call
 *   round 2 (one tool result)   → streamed notes.recent tool call
 *   round 3 (two tool results)  → streamed final assistant text
 * CORS is enabled because the web app at a different origin must reach it,
 * exactly as a real LAN endpoint would need to allow the app origin.
 */
export async function startOpenAIContractServer(): Promise<OpenAIContractServer> {
  const requests: RecordedRequest[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type, authorization');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'e2e-model' }] }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        const body = JSON.parse(raw) as RecordedRequest['body'];
        requests.push({ body });
        const toolResults =
          body.messages?.filter((message) => message.role === 'tool').length ?? 0;

        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
        });
        const send = (chunk: string, delay: number) =>
          new Promise<void>((resolve) =>
            setTimeout(() => {
              res.write(chunk);
              resolve();
            }, delay)
          );

        void (async () => {
          if (toolResults === 0) {
            // Split the arguments across deltas to exercise accumulation.
            await send(toolCallDelta('call-search', 'notes.search', '{"query":', true), 0);
            await send(toolCallDelta('call-search', 'notes.search', '"milk"}', false), 20);
          } else if (toolResults === 1) {
            await send(toolCallDelta('call-recent', 'notes.recent', '{"limit":3}', true), 0);
          } else {
            await send(textDelta('Milk is on your '), 0);
            await send(textDelta('grocery list.'), 20);
          }
          res.end('data: [DONE]\n\n');
        })();
      });
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
  };
}
