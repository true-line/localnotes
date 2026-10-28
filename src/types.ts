export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export type GraphNodeType = 'note' | 'concept' | 'tag';

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  noteId?: string;
  degree: number;
}

export type GraphEdgeKind = 'wikilink' | 'concept' | 'tag' | 'semantic';

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
  weight?: number;
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface RelatedNoteEntry {
  note: Note;
  sharedTopics: string[];
}

export interface SemanticNoteEntry {
  note: Note;
  similarity: number;
}

export interface NoteConnections {
  outgoingNotes: Note[];
  unresolvedConcepts: string[];
  tags: string[];
  backlinks: Note[];
  relatedNotes: RelatedNoteEntry[];
  semanticNotes: SemanticNoteEntry[];
}

export type EmbeddingMap = Record<string, number[]>;

export type EmbeddingStatus =
  | 'idle'
  | 'loading-model'
  | 'indexing'
  | 'ready'
  | 'error';


