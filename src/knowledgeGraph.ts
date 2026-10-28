import type {
  Note,
  GraphNode,
  GraphEdge,
  KnowledgeGraph,
  NoteConnections,
  RelatedNoteEntry,
  SemanticNoteEntry,
  EmbeddingMap,
} from './types';
import {
  cosineSimilarity,
  computeLocalSemanticEmbedding,
  computeFacetSimilarity,
  DEFAULT_SIMILARITY_THRESHOLD,
  STOPWORDS,
  stemWord,
} from './embeddings';

export interface ExtractedMetadata {
  /** Unique wiki-link targets (preserving original casing of first occurrence) */
  wikiLinks: string[];
  /** Unique normalized lowercase tag names (without leading '#') */
  tags: string[];
}

const FENCED_CODE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`\n]+`/g;
const WIKILINK_RE = /\[\[([^[\]|]+?)(?:\|([^[\]]+?))?\]\]/g;
const TAG_RE = /(?:^|[\s(])#([a-zA-Z][a-zA-Z0-9_-]*(?:\/[a-zA-Z0-9_-]+)*)/g;

export function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extracts primary entity name from a note title, e.g. "Bakersfield, Ca" -> "Bakersfield",
 * "Korn (band)" -> "Korn".
 */
export function getPrimaryTitleEntity(title: string): string {
  return title
    .split(/[,(\-–—]/)[0]
    .trim();
}

/**
 * Extracts [[wiki-links]] and #tags from Markdown content,
 * ignoring fenced and inline code blocks.
 */
export function extractLinksAndTags(content: string): ExtractedMetadata {
  const cleaned = content
    .replace(FENCED_CODE_RE, ' ')
    .replace(INLINE_CODE_RE, ' ');

  const wikiMap = new Map<string, string>();
  for (const match of cleaned.matchAll(WIKILINK_RE)) {
    const rawTarget = match[1].trim();
    if (!rawTarget) continue;
    const key = normalizeKey(rawTarget);
    if (!wikiMap.has(key)) {
      wikiMap.set(key, rawTarget);
    }
  }

  const tagSet = new Set<string>();
  for (const match of cleaned.matchAll(TAG_RE)) {
    const rawTag = match[1].trim().toLowerCase();
    if (rawTag) {
      tagSet.add(rawTag);
    }
  }

  return {
    wikiLinks: Array.from(wikiMap.values()),
    tags: Array.from(tagSet),
  };
}

/**
 * Finds other notes whose title (or primary title entity before comma/parenthesis,
 * e.g. "Bakersfield" from "Bakersfield, Ca") is mentioned directly in `note.content`
 * as a whole word/phrase (even without [[brackets]]).
 */
export function findPlainTextNoteMentions(
  note: Note,
  allNotes: Note[]
): Note[] {
  const cleaned = note.content
    .replace(FENCED_CODE_RE, ' ')
    .replace(INLINE_CODE_RE, ' ');
  if (!cleaned.trim()) return [];

  const mentioned: Note[] = [];
  for (const candidate of allNotes) {
    if (candidate.id === note.id) continue;
    const fullTitle = candidate.title.trim();
    if (fullTitle.length < 2) continue;

    const primaryEntity = getPrimaryTitleEntity(fullTitle);
    const termsToCheck = [fullTitle];
    if (
      primaryEntity.length >= 3 &&
      primaryEntity.toLowerCase() !== fullTitle.toLowerCase()
    ) {
      termsToCheck.push(primaryEntity);
    }

    const isMatched = termsToCheck.some((term) => {
      const pattern = new RegExp(
        `(?:^|[^a-zA-Z0-9_])(${escapeRegExp(term)})(?=$|[^a-zA-Z0-9_])`,
        'i'
      );
      return pattern.test(cleaned);
    });

    if (isMatched) {
      mentioned.push(candidate);
    }
  }
  return mentioned;
}

/**
 * Extracts meaningful multi-word keyphrases (e.g., "nu metal") AND canonical
 * single-word domain concepts/entities (e.g., "bass", "music", "california")
 * shared by at least 2 notes in plain text, excluding existing note titles and explicit links/tags.
 */
export function extractSharedAutoConcepts(
  notes: Note[],
  excludedKeys: Set<string>,
  maxConcepts = 10
): Map<string, { label: string; noteIds: Set<string> }> {
  const phraseNotes = new Map<
    string,
    { label: string; noteIds: Set<string>; isMultiWord: boolean }
  >();

  for (const note of notes) {
    const cleaned = note.content
      .replace(FENCED_CODE_RE, ' ')
      .replace(INLINE_CODE_RE, ' ')
      .replace(WIKILINK_RE, ' ')
      .replace(TAG_RE, ' ');

    const clauses = cleaned.split(/[.,;:!?()[\]{}"'\n]+/);
    for (const clause of clauses) {
      const words = clause
        .trim()
        .split(/\s+/)
        .map((w) => w.replace(/[^a-zA-Z0-9-]/g, ''))
        .filter(
          (w) =>
            w.length >= 2 &&
            !STOPWORDS.has(w.toLowerCase()) &&
            !/^\d+$/.test(w)
        );

      // 1. Multi-word keyphrases (bigrams)
      for (let i = 0; i + 1 < words.length; i++) {
        const w1 = words[i].toLowerCase();
        const w2 = words[i + 1].toLowerCase();
        if (STOPWORDS.has(w1) || STOPWORDS.has(w2)) continue;
        const label = `${w1} ${w2}`;
        const key = normalizeKey(label);
        if (key.length < 5 || excludedKeys.has(key)) continue;

        let entry = phraseNotes.get(key);
        if (!entry) {
          entry = { label, noteIds: new Set(), isMultiWord: true };
          phraseNotes.set(key, entry);
        }
        entry.noteIds.add(note.id);
      }

      // 2. Canonical single-word concepts/entities (stems of length >= 4)
      for (const word of words) {
        const canonical = stemWord(word);
        if (
          canonical.length < 4 ||
          STOPWORDS.has(canonical) ||
          excludedKeys.has(canonical)
        ) {
          continue;
        }
        let entry = phraseNotes.get(canonical);
        if (!entry) {
          entry = {
            label: canonical,
            noteIds: new Set(),
            isMultiWord: false,
          };
          phraseNotes.set(canonical, entry);
        }
        entry.noteIds.add(note.id);
      }
    }
  }

  // Keep only concepts shared across >= 2 notes
  const sharedEntries = Array.from(phraseNotes.entries()).filter(
    ([, val]) => val.noteIds.size >= 2
  );

  // Filter out single-word concepts (or overlapping phrases) that are already covered
  // by a higher-priority multi-word concept on the exact same set of notes
  const multiWordConcepts = sharedEntries.filter(([, val]) => val.isMultiWord);
  const deduplicated = sharedEntries.filter(([key, val]) => {
    if (!val.isMultiWord) {
      const wordsInMulti = multiWordConcepts.some(([mKey, mVal]) => {
        const mWords = mKey.split(' ');
        if (!mWords.includes(key)) return false;
        // Check if every note in val.noteIds is already connected by mVal
        for (const nid of val.noteIds) {
          if (!mVal.noteIds.has(nid)) return false;
        }
        return true;
      });
      if (wordsInMulti) return false;
    }
    return true;
  });

  // Prioritize multi-word concepts and higher note coverage
  deduplicated.sort((a, b) => {
    if (b[1].noteIds.size !== a[1].noteIds.size) {
      return b[1].noteIds.size - a[1].noteIds.size;
    }
    if (a[1].isMultiWord !== b[1].isMultiWord) {
      return a[1].isMultiWord ? -1 : 1;
    }
    return a[0].localeCompare(b[0]);
  });

  const result = new Map<string, { label: string; noteIds: Set<string> }>();
  for (const [k, v] of deduplicated.slice(0, maxConcepts)) {
    result.set(k, { label: v.label, noteIds: v.noteIds });
  }
  return result;
}

/**
 * Builds the heterogeneous knowledge graph containing:
 * - 'note' nodes for each Note
 * - 'concept' nodes for unresolved [[Concept]] wiki-links AND shared plain-text keyphrases/concepts
 * - 'tag' nodes for #tags
 * - 'wikilink' edges for [[Note Title]] links AND plain-text mentions of another note's title
 * - 'semantic' edges between notes whose embedding/facet similarity >= similarityThreshold
 */
export function buildKnowledgeGraph(
  notes: Note[],
  embeddings: EmbeddingMap = {},
  similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD
): KnowledgeGraph {
  const nodesMap = new Map<string, GraphNode>();
  const edgesMap = new Map<string, GraphEdge>();
  const excludedConceptKeys = new Set<string>();

  // Map normalized non-empty note title -> Note
  const titleToNote = new Map<string, Note>();
  for (const note of notes) {
    const nodeId = `note:${note.id}`;
    nodesMap.set(nodeId, {
      id: nodeId,
      type: 'note',
      label: note.title.trim() || 'Untitled',
      noteId: note.id,
      degree: 0,
    });

    const normTitle = normalizeKey(note.title);
    if (normTitle) {
      excludedConceptKeys.add(normTitle);
      excludedConceptKeys.add(stemWord(normTitle));
      const primary = normalizeKey(getPrimaryTitleEntity(note.title));
      if (primary) {
        excludedConceptKeys.add(primary);
        excludedConceptKeys.add(stemWord(primary));
      }
      if (!titleToNote.has(normTitle)) {
        titleToNote.set(normTitle, note);
      }
    }
  }

  for (const note of notes) {
    const sourceId = `note:${note.id}`;
    const { wikiLinks, tags } = extractLinksAndTags(note.content);

    for (const targetLabel of wikiLinks) {
      const normTarget = normalizeKey(targetLabel);
      excludedConceptKeys.add(normTarget);
      excludedConceptKeys.add(stemWord(normTarget));
      const targetNote = titleToNote.get(normTarget);

      if (targetNote) {
        if (targetNote.id === note.id) continue; // skip self-link
        const targetId = `note:${targetNote.id}`;
        const edgeId = `wikilink:${sourceId}->${targetId}`;
        if (!edgesMap.has(edgeId)) {
          edgesMap.set(edgeId, {
            id: edgeId,
            source: sourceId,
            target: targetId,
            kind: 'wikilink',
          });
        }
      } else {
        const conceptId = `concept:${normTarget}`;
        if (!nodesMap.has(conceptId)) {
          nodesMap.set(conceptId, {
            id: conceptId,
            type: 'concept',
            label: targetLabel,
            degree: 0,
          });
        }
        const edgeId = `concept:${sourceId}->${conceptId}`;
        if (!edgesMap.has(edgeId)) {
          edgesMap.set(edgeId, {
            id: edgeId,
            source: sourceId,
            target: conceptId,
            kind: 'concept',
          });
        }
      }
    }

    // Automatic plain-text mentions of other notes' titles (or primary title entities)
    const mentionedNotes = findPlainTextNoteMentions(note, notes);
    for (const targetNote of mentionedNotes) {
      const targetId = `note:${targetNote.id}`;
      const edgeId = `wikilink:${sourceId}->${targetId}`;
      if (!edgesMap.has(edgeId)) {
        edgesMap.set(edgeId, {
          id: edgeId,
          source: sourceId,
          target: targetId,
          kind: 'wikilink',
        });
      }
    }

    for (const tag of tags) {
      excludedConceptKeys.add(tag);
      excludedConceptKeys.add(stemWord(tag));
      const tagId = `tag:${tag}`;
      if (!nodesMap.has(tagId)) {
        nodesMap.set(tagId, {
          id: tagId,
          type: 'tag',
          label: `#${tag}`,
          degree: 0,
        });
      }
      const edgeId = `tag:${sourceId}->${tagId}`;
      if (!edgesMap.has(edgeId)) {
        edgesMap.set(edgeId, {
          id: edgeId,
          source: sourceId,
          target: tagId,
          kind: 'tag',
        });
      }
    }
  }

  // Automatic shared concept nodes extracted from plain text across >= 2 notes
  const autoConcepts = extractSharedAutoConcepts(notes, excludedConceptKeys);
  for (const [conceptKey, { label, noteIds }] of autoConcepts.entries()) {
    const conceptId = `concept:${conceptKey}`;
    if (!nodesMap.has(conceptId)) {
      nodesMap.set(conceptId, {
        id: conceptId,
        type: 'concept',
        label,
        degree: 0,
      });
    }
    for (const noteId of noteIds) {
      const sourceId = `note:${noteId}`;
      const edgeId = `concept:${sourceId}->${conceptId}`;
      if (!edgesMap.has(edgeId)) {
        edgesMap.set(edgeId, {
          id: edgeId,
          source: sourceId,
          target: conceptId,
          kind: 'concept',
        });
      }
    }
  }

  // Precompute instant local semantic vectors
  const localVectors = new Map<string, number[]>();
  for (const note of notes) {
    const customVec = embeddings[note.id];
    if (!customVec || customVec.length >= 256) {
      const text = `${note.title}\n${note.content}`.trim();
      if (text) {
        localVectors.set(note.id, computeLocalSemanticEmbedding(text));
      }
    }
  }

  // Add semantic similarity edges from neural + local + facet embeddings
  for (let i = 0; i < notes.length; i++) {
    const idA = notes[i].id;
    const vecA = embeddings[idA];
    const locA = localVectors.get(idA);
    for (let j = i + 1; j < notes.length; j++) {
      const idB = notes[j].id;
      const vecB = embeddings[idB];
      const locB = localVectors.get(idB);

      const neuralSim =
        vecA && vecB && vecA.length > 0 && vecA.length === vecB.length
          ? cosineSimilarity(vecA, vecB)
          : 0;
      const localSim =
        locA && locB && locA.length > 0 ? cosineSimilarity(locA, locB) : 0;
      const facetSim =
        locA && locB ? computeFacetSimilarity(notes[i], notes[j]) : 0;
      const sim = Math.max(neuralSim, localSim, facetSim);

      if (sim >= similarityThreshold) {
        const sourceId = `note:${idA}`;
        const targetId = `note:${idB}`;
        const edgeId = `semantic:${sourceId}<->${targetId}`;
        edgesMap.set(edgeId, {
          id: edgeId,
          source: sourceId,
          target: targetId,
          kind: 'semantic',
          weight: sim,
        });
      }
    }
  }

  const edges = Array.from(edgesMap.values());
  for (const edge of edges) {
    const src = nodesMap.get(edge.source);
    const tgt = nodesMap.get(edge.target);
    if (src) src.degree += 1;
    if (tgt) tgt.degree += 1;
  }

  return {
    nodes: Array.from(nodesMap.values()),
    edges,
  };
}

/**
 * Computes outgoing links, unresolved concepts, tags, backlinks,
 * topic-related notes, and semantically similar notes (via embeddings) for a note.
 */
export function getNoteConnections(
  noteId: string,
  notes: Note[],
  embeddings: EmbeddingMap = {},
  similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD
): NoteConnections {
  const currentNote = notes.find((n) => n.id === noteId);
  if (!currentNote) {
    return {
      outgoingNotes: [],
      unresolvedConcepts: [],
      tags: [],
      backlinks: [],
      relatedNotes: [],
      semanticNotes: [],
    };
  }

  const titleToNote = new Map<string, Note>();
  const excludedConceptKeys = new Set<string>();
  for (const note of notes) {
    const normTitle = normalizeKey(note.title);
    if (normTitle) {
      excludedConceptKeys.add(normTitle);
      excludedConceptKeys.add(stemWord(normTitle));
      const primary = normalizeKey(getPrimaryTitleEntity(note.title));
      if (primary) {
        excludedConceptKeys.add(primary);
        excludedConceptKeys.add(stemWord(primary));
      }
      if (!titleToNote.has(normTitle)) {
        titleToNote.set(normTitle, note);
      }
    }
  }

  const { wikiLinks, tags } = extractLinksAndTags(currentNote.content);
  const outgoingMap = new Map<string, Note>();
  const unresolvedConcepts: string[] = [];

  for (const link of wikiLinks) {
    const normLink = normalizeKey(link);
    excludedConceptKeys.add(normLink);
    excludedConceptKeys.add(stemWord(normLink));
    const matched = titleToNote.get(normLink);
    if (matched) {
      if (matched.id !== currentNote.id) {
        outgoingMap.set(matched.id, matched);
      }
    } else {
      unresolvedConcepts.push(link);
    }
  }

  // Plain-text mentions of other notes' titles
  for (const mentioned of findPlainTextNoteMentions(currentNote, notes)) {
    outgoingMap.set(mentioned.id, mentioned);
  }

  const outgoingNotes = Array.from(outgoingMap.values());
  for (const tag of tags) {
    excludedConceptKeys.add(tag);
    excludedConceptKeys.add(stemWord(tag));
  }

  // Also include shared auto-concepts that currentNote participates in
  const autoConcepts = extractSharedAutoConcepts(notes, excludedConceptKeys);
  const myAutoConcepts = new Map<string, string>();
  for (const [key, { label, noteIds }] of autoConcepts.entries()) {
    if (noteIds.has(currentNote.id)) {
      myAutoConcepts.set(key, label);
      if (!unresolvedConcepts.some((c) => normalizeKey(c) === key)) {
        unresolvedConcepts.push(label);
      }
    }
  }

  const currentNormTitle = normalizeKey(currentNote.title);
  const backlinks: Note[] = [];

  const myConceptKeys = new Set(unresolvedConcepts.map(normalizeKey));
  const myOutgoingKeys = new Set(outgoingNotes.map((n) => normalizeKey(n.title)));
  const myTagKeys = new Set(tags);

  const relatedNotes: RelatedNoteEntry[] = [];
  const semanticNotes: SemanticNoteEntry[] = [];
  const myVector = embeddings[currentNote.id];
  const myLocalVector =
    !myVector || myVector.length >= 256
      ? computeLocalSemanticEmbedding(
          `${currentNote.title}\n${currentNote.content}`.trim()
        )
      : [];

  for (const other of notes) {
    if (other.id === currentNote.id) continue;
    const otherExtracted = extractLinksAndTags(other.content);
    const otherLinkKeys = otherExtracted.wikiLinks.map(normalizeKey);
    const otherMentions = findPlainTextNoteMentions(other, notes);

    // Check if 'other' links to or mentions currentNote
    if (
      (currentNormTitle && otherLinkKeys.includes(currentNormTitle)) ||
      otherMentions.some((m) => m.id === currentNote.id)
    ) {
      backlinks.push(other);
    }

    // Check shared topics (#tags, [[Concept]], or auto-extracted shared concepts)
    const sharedTopics: string[] = [];
    for (const tag of otherExtracted.tags) {
      if (myTagKeys.has(tag)) {
        sharedTopics.push(`#${tag}`);
      }
    }
    for (const rawLink of otherExtracted.wikiLinks) {
      const k = normalizeKey(rawLink);
      if (myConceptKeys.has(k) || myOutgoingKeys.has(k)) {
        sharedTopics.push(`[[${rawLink}]]`);
      }
    }
    for (const [autoKey, autoLabel] of myAutoConcepts.entries()) {
      const entry = autoConcepts.get(autoKey);
      if (entry?.noteIds.has(other.id)) {
        sharedTopics.push(`[[${autoLabel}]]`);
      }
    }

    if (sharedTopics.length > 0) {
      relatedNotes.push({ note: other, sharedTopics });
    }

    // Check embedding cosine similarity (combining neural + local + facet similarity)
    const otherVector = embeddings[other.id];
    const neuralSim =
      myVector &&
      otherVector &&
      myVector.length > 0 &&
      myVector.length === otherVector.length
        ? cosineSimilarity(myVector, otherVector)
        : 0;
    const otherLocalVector =
      myLocalVector.length > 0 && (!otherVector || otherVector.length >= 256)
        ? computeLocalSemanticEmbedding(
            `${other.title}\n${other.content}`.trim()
          )
        : [];
    const localSim =
      myLocalVector.length > 0 && otherLocalVector.length > 0
        ? cosineSimilarity(myLocalVector, otherLocalVector)
        : 0;
    const facetSim =
      myLocalVector.length > 0 && otherLocalVector.length > 0
        ? computeFacetSimilarity(currentNote, other)
        : 0;
    const similarity = Math.max(neuralSim, localSim, facetSim);

    if (similarity >= similarityThreshold) {
      semanticNotes.push({ note: other, similarity });
    }
  }

  relatedNotes.sort((a, b) => b.sharedTopics.length - a.sharedTopics.length);
  semanticNotes.sort((a, b) => b.similarity - a.similarity);

  return {
    outgoingNotes,
    unresolvedConcepts,
    tags,
    backlinks,
    relatedNotes,
    semanticNotes,
  };
}

export interface PositionedGraphNode extends GraphNode {
  x: number;
  y: number;
}

/**
 * Pure deterministic force-directed layout algorithm for the knowledge graph.
 */
export function computeForceLayout(
  graph: KnowledgeGraph,
  width = 800,
  height = 560,
  iterations = 120
): PositionedGraphNode[] {
  const { nodes, edges } = graph;
  const count = nodes.length;
  if (count === 0) return [];

  const cx = width / 2;
  const cy = height / 2;

  // Initialize deterministic spiral layout
  const pos = nodes.map((node, i) => {
    if (count === 1) {
      return { ...node, x: cx, y: cy, vx: 0, vy: 0 };
    }
    const angle = i * 2.399963229728653; // Golden angle
    const radius = Math.min(width, height) * 0.12 * Math.sqrt(i + 1);
    return {
      ...node,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    };
  });

  const indexById = new Map<string, number>();
  pos.forEach((n, idx) => indexById.set(n.id, idx));

  const repulsionStrength = 4800;
  const springLength = 125;
  const springStrength = 0.045;
  const centerGravity = 0.012;
  const padding = 48;

  for (let step = 0; step < iterations; step++) {
    const cooling = 1 - step / (iterations * 1.15);

    // 1. All-pairs Coulomb repulsion
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const dx = pos[i].x - pos[j].x;
        const dy = pos[i].y - pos[j].y;
        const distSq = Math.max(dx * dx + dy * dy, 64);
        const dist = Math.sqrt(distSq);
        const force = (repulsionStrength / distSq) * cooling;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        pos[i].vx += fx;
        pos[i].vy += fy;
        pos[j].vx -= fx;
        pos[j].vy -= fy;
      }
    }

    // 2. Hooke spring attraction along edges
    for (const edge of edges) {
      const sIdx = indexById.get(edge.source);
      const tIdx = indexById.get(edge.target);
      if (sIdx === undefined || tIdx === undefined) continue;
      const source = pos[sIdx];
      const target = pos[tIdx];
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const displacement = dist - springLength;
      const force = displacement * springStrength * cooling;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    }

    // 3. Center gravity + velocity integration
    for (let i = 0; i < count; i++) {
      const n = pos[i];
      n.vx += (cx - n.x) * centerGravity * cooling;
      n.vy += (cy - n.y) * centerGravity * cooling;

      n.x += Math.max(-18, Math.min(18, n.vx));
      n.y += Math.max(-18, Math.min(18, n.vy));

      n.vx *= 0.65;
      n.vy *= 0.65;

      n.x = Math.max(padding, Math.min(width - padding, n.x));
      n.y = Math.max(padding, Math.min(height - padding, n.y));
    }
  }

  return pos.map(({ vx: _vx, vy: _vy, ...rest }) => rest);
}
