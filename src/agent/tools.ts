import type { Note, NoteConnections, SemanticNoteEntry } from '../types';
import type { AgentTool } from './types';

/**
 * The read-only facade tools are allowed to see. Built in App.tsx from
 * existing primitives — never the repository's mutation methods.
 */
export interface ToolContext {
  searchNotes(query: string, limit?: number): Note[];
  getNote(id: string): Note | null;
  recentNotes(limit?: number): Note[];
  connectionsFor(id: string): NoteConnections | null;
  similarFor(id: string, limit?: number): SemanticNoteEntry[];
}

/** Content excerpts in tool results are capped so a huge note cannot flood context. */
const EXCERPT_CHARS = 600;

function excerpt(note: Note, chars = EXCERPT_CHARS): string {
  const content = note.content.trim();
  return content.length > chars ? `${content.slice(0, chars)}…` : content;
}

const intLimit = (max: number) => ({
  type: 'integer',
  minimum: 1,
  maximum: max,
});

export function createTools(ctx: ToolContext): AgentTool[] {
  return [
    {
      name: 'notes.search',
      description:
        'Search all notes by keyword. Returns matching notes with id, title, and a content excerpt. Use before notes.read when unsure of the id.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1 },
          limit: intLimit(20),
        },
        required: ['query'],
        additionalProperties: false,
      },
      tier: 0,
      async execute(args) {
        const { query } = args as { query: string };
        const limit = (args.limit as number | undefined) ?? 10;
        const results = ctx.searchNotes(query, limit);
        if (results.length === 0) return { ok: true, content: 'No notes matched.' };
        const lines = results.map(
          (note, i) =>
            `${i + 1}. [id=${note.id}] ${note.title || 'Untitled'}\n   ${excerpt(note, 200) || '(empty note)'}`
        );
        return { ok: true, content: `${results.length} note(s) matched:\n${lines.join('\n')}` };
      },
    },
    {
      name: 'notes.read',
      description:
        'Read one note in full by id (ids come from notes.search / notes.recent / graph tools).',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', minLength: 1 } },
        required: ['id'],
        additionalProperties: false,
      },
      tier: 0,
      async execute(args) {
        const note = ctx.getNote((args as { id: string }).id);
        if (!note) return { ok: false, content: `No note with that id.` };
        return {
          ok: true,
          content: `# ${note.title || 'Untitled'}\n\n${note.content || '(empty note)'}`,
        };
      },
    },
    {
      name: 'notes.recent',
      description: 'List the most recently updated notes with ids and excerpts.',
      inputSchema: {
        type: 'object',
        properties: { limit: intLimit(20) },
        additionalProperties: false,
      },
      tier: 0,
      async execute(args) {
        const limit = (args.limit as number | undefined) ?? 10;
        const notes = ctx.recentNotes(limit);
        if (notes.length === 0) return { ok: true, content: 'The vault is empty.' };
        const lines = notes.map(
          (note) =>
            `- [id=${note.id}] ${note.title || 'Untitled'} — ${excerpt(note, 120) || '(empty)'}`
        );
        return { ok: true, content: `Most recent notes:\n${lines.join('\n')}` };
      },
    },
    {
      name: 'graph.connections',
      description:
        'Show a note\'s knowledge-graph connections: backlinks, outgoing links, shared concepts and tags.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', minLength: 1 } },
        required: ['id'],
        additionalProperties: false,
      },
      tier: 0,
      async execute(args) {
        const conn = ctx.connectionsFor((args as { id: string }).id);
        if (!conn) return { ok: false, content: 'No such note.' };
        const parts: string[] = [];
        if (conn.backlinks.length) {
          parts.push(
            `Backlinks (${conn.backlinks.length}): ${conn.backlinks.map((n) => n.title || 'Untitled').join(', ')}`
          );
        }
        if (conn.outgoingNotes.length) {
          parts.push(
            `Links out (${conn.outgoingNotes.length}): ${conn.outgoingNotes.map((n) => n.title || 'Untitled').join(', ')}`
          );
        }
        if (conn.unresolvedConcepts.length) {
          parts.push(`Concepts: ${conn.unresolvedConcepts.slice(0, 15).join(', ')}`);
        }
        if (conn.tags.length) parts.push(`Tags: ${conn.tags.join(', ')}`);
        if (!parts.length) return { ok: true, content: 'This note has no connections yet.' };
        return { ok: true, content: parts.join('\n') };
      },
    },
    {
      name: 'graph.similar',
      description:
        'Find semantically similar notes (embedding + facet similarity) for one note id.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 },
          limit: intLimit(10),
        },
        required: ['id'],
        additionalProperties: false,
      },
      tier: 0,
      async execute(args) {
        const limit = (args.limit as number | undefined) ?? 5;
        const similar = ctx.similarFor((args as { id: string }).id, limit);
        if (similar.length === 0) return { ok: true, content: 'No similar notes found.' };
        const lines = similar.map(
          (entry) =>
            `- [id=${entry.note.id}] ${entry.note.title || 'Untitled'} (similarity ${entry.similarity.toFixed(2)})`
        );
        return { ok: true, content: `Similar notes:\n${lines.join('\n')}` };
      },
    },
  ];
}
