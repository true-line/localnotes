import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import type {
  Note,
  GraphNodeType,
  GraphNode,
  EmbeddingMap,
  EmbeddingStatus,
  GraphEdgeKind,
} from '../types';
import {
  buildKnowledgeGraph,
  computeForceLayout,
  type PositionedGraphNode,
} from '../knowledgeGraph';
import { DEFAULT_SIMILARITY_THRESHOLD } from '../embeddings';
import '../styles/KnowledgeGraphView.css';

interface Props {
  notes: Note[];
  embeddings?: EmbeddingMap;
  embeddingStatus?: EmbeddingStatus;
  initialSelectedNodeId?: string | null;
  onOpenNote: (noteId: string) => void;
  onCreateConceptNote: (title: string) => void;
  onReindex?: () => void;
  onClose: () => void;
}

const CANVAS_WIDTH = 860;
const CANVAS_HEIGHT = 560;

export function KnowledgeGraphView({
  notes,
  embeddings = {},
  embeddingStatus = 'idle',
  initialSelectedNodeId = null,
  onOpenNote,
  onCreateConceptNote,
  onReindex,
  onClose,
}: Props) {
  const [similarityThreshold, setSimilarityThreshold] = useState(
    DEFAULT_SIMILARITY_THRESHOLD
  );
  const graph = useMemo(
    () => buildKnowledgeGraph(notes, embeddings, similarityThreshold),
    [notes, embeddings, similarityThreshold]
  );
  const initialPositions = useMemo(
    () => computeForceLayout(graph, CANVAS_WIDTH, CANVAS_HEIGHT),
    [graph]
  );

  const [nodes, setNodes] = useState<PositionedGraphNode[]>(initialPositions);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    initialSelectedNodeId
  );
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | GraphNodeType>('all');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Drag state for nodes or canvas pan
  const draggingNodeRef = useRef<string | null>(null);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    setNodes(initialPositions);
  }, [initialPositions]);

  useEffect(() => {
    if (initialSelectedNodeId) {
      setSelectedNodeId(initialSelectedNodeId);
    }
  }, [initialSelectedNodeId]);

  const nodeById = useMemo(() => {
    const map = new Map<string, PositionedGraphNode>();
    for (const n of nodes) map.set(n.id, n);
    return map;
  }, [nodes]);

  const filteredNodeIds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const visible = new Set<string>();
    for (const n of nodes) {
      const matchesType = typeFilter === 'all' || n.type === typeFilter;
      const matchesQuery = !q || n.label.toLowerCase().includes(q);
      if (matchesType && matchesQuery) {
        visible.add(n.id);
      }
    }
    return visible;
  }, [nodes, searchQuery, typeFilter]);

  const visibleEdges = useMemo(
    () =>
      graph.edges.filter(
        (e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target)
      ),
    [graph.edges, filteredNodeIds]
  );

  const activeFocusId = hoveredNodeId ?? selectedNodeId;

  const neighborIds = useMemo(() => {
    if (!activeFocusId) return new Set<string>();
    const set = new Set<string>([activeFocusId]);
    for (const e of graph.edges) {
      if (e.source === activeFocusId) set.add(e.target);
      if (e.target === activeFocusId) set.add(e.source);
    }
    return set;
  }, [activeFocusId, graph.edges]);

  const selectedNode: GraphNode | null = selectedNodeId
    ? nodeById.get(selectedNodeId) ?? null
    : null;

  const selectedNodeNeighbors = useMemo(() => {
    if (!selectedNode) return [];
    const map = new Map<
      string,
      { node: GraphNode; kind: GraphEdgeKind; weight?: number }
    >();
    for (const e of graph.edges) {
      let otherId: string | null = null;
      if (e.source === selectedNode.id) otherId = e.target;
      else if (e.target === selectedNode.id) otherId = e.source;
      if (!otherId) continue;
      const other = nodeById.get(otherId);
      if (!other) continue;
      // Prefer explicit link if both explicit and semantic exist
      const existing = map.get(otherId);
      if (!existing || existing.kind === 'semantic') {
        map.set(otherId, { node: other, kind: e.kind, weight: e.weight });
      }
    }
    return Array.from(map.values());
  }, [selectedNode, graph.edges, nodeById]);

  const counts = useMemo(() => {
    let noteCount = 0;
    let tagCount = 0;
    let conceptCount = 0;
    let semanticCount = 0;
    for (const n of graph.nodes) {
      if (n.type === 'note') noteCount++;
      else if (n.type === 'tag') tagCount++;
      else if (n.type === 'concept') conceptCount++;
    }
    for (const e of graph.edges) {
      if (e.kind === 'semantic') semanticCount++;
    }
    return {
      noteCount,
      tagCount,
      conceptCount,
      edgeCount: graph.edges.length,
      semanticCount,
    };
  }, [graph]);

  const handleResetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setNodes(initialPositions);
  }, [initialPositions]);

  const clientToSvgCoords = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
      const scaleX = CANVAS_WIDTH / rect.width;
      const scaleY = CANVAS_HEIGHT / rect.height;
      const rawX = (clientX - rect.left) * scaleX;
      const rawY = (clientY - rect.top) * scaleY;
      return {
        x: (rawX - pan.x) / zoom,
        y: (rawY - pan.y) / zoom,
      };
    },
    [pan, zoom]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (draggingNodeRef.current) {
        const coords = clientToSvgCoords(e.clientX, e.clientY);
        const nodeId = draggingNodeRef.current;
        setNodes((prev) =>
          prev.map((n) =>
            n.id === nodeId ? { ...n, x: coords.x, y: coords.y } : n
          )
        );
      } else if (isPanningRef.current) {
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        setPan({
          x: panStartRef.current.panX + dx,
          y: panStartRef.current.panY + dy,
        });
      }
    },
    [clientToSvgCoords]
  );

  const handlePointerUp = useCallback(() => {
    draggingNodeRef.current = null;
    isPanningRef.current = false;
  }, []);

  return (
    <main className="knowledge-graph" aria-label="Knowledge graph view">
      <div className="knowledge-graph__toolbar">
        <div className="knowledge-graph__title-group">
          <h2 className="knowledge-graph__title">Knowledge Graph</h2>
          <span className="knowledge-graph__stats">
            {counts.noteCount} notes · {counts.tagCount} topics ·{' '}
            {counts.conceptCount} concepts · {counts.edgeCount} links (
            {counts.semanticCount} semantic)
          </span>
        </div>

        <div className="knowledge-graph__controls">
          <label className="knowledge-graph__threshold" title="Minimum cosine similarity for neural embedding edges">
            <span>Similarity ≥ {Math.round(similarityThreshold * 100)}%</span>
            <input
              type="range"
              min="0.35"
              max="0.90"
              step="0.05"
              aria-label="Semantic similarity threshold"
              value={similarityThreshold}
              onChange={(e) =>
                setSimilarityThreshold(parseFloat(e.target.value))
              }
            />
          </label>

          <input
            type="search"
            className="knowledge-graph__search"
            placeholder="Filter nodes…"
            aria-label="Filter graph nodes"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          <div
            className="knowledge-graph__filter-group"
            role="group"
            aria-label="Filter by node type"
          >
            {(['all', 'note', 'tag', 'concept'] as const).map((type) => (
              <button
                key={type}
                type="button"
                className={`knowledge-graph__filter-btn${
                  typeFilter === type
                    ? ' knowledge-graph__filter-btn--active'
                    : ''
                }`}
                aria-pressed={typeFilter === type}
                onClick={() => setTypeFilter(type)}
              >
                {type === 'all'
                  ? 'All'
                  : type === 'note'
                  ? 'Notes'
                  : type === 'tag'
                  ? 'Topics'
                  : 'Concepts'}
              </button>
            ))}
          </div>

          <div className="knowledge-graph__zoom-group">
            <button
              type="button"
              className="knowledge-graph__icon-btn"
              aria-label="Zoom out"
              title="Zoom out"
              onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.2).toFixed(2)))}
            >
              −
            </button>
            <button
              type="button"
              className="knowledge-graph__icon-btn"
              aria-label="Reset graph view"
              title="Reset graph view"
              onClick={handleResetView}
            >
              Reset
            </button>
            <button
              type="button"
              className="knowledge-graph__icon-btn"
              aria-label="Zoom in"
              title="Zoom in"
              onClick={() => setZoom((z) => Math.min(2.4, +(z + 0.2).toFixed(2)))}
            >
              +
            </button>
          </div>

          {onReindex && (
            <button
              type="button"
              className="knowledge-graph__icon-btn"
              aria-label="Re-index embeddings"
              title="Re-compute semantic embeddings for all notes"
              onClick={onReindex}
            >
              ↻ Re-index
            </button>
          )}

          <button
            type="button"
            className="knowledge-graph__close-btn"
            onClick={onClose}
          >
            Back to Editor
          </button>
        </div>
      </div>

      <div className="knowledge-graph__body">
        {nodes.length === 0 ? (
          <div className="knowledge-graph__empty">
            <p>
              No notes in your knowledge graph yet. Create a note and use{' '}
              <code>[[Concept]]</code> or <code>#topic</code> to connect ideas.
            </p>
          </div>
        ) : (
          <div className="knowledge-graph__canvas-wrap">
            <svg
              ref={svgRef}
              className="knowledge-graph__svg"
              viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) {
                  isPanningRef.current = true;
                  panStartRef.current = {
                    x: e.clientX,
                    y: e.clientY,
                    panX: pan.x,
                    panY: pan.y,
                  };
                  setSelectedNodeId(null);
                }
              }}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onWheel={(e) => {
                e.preventDefault();
                const delta = e.deltaY < 0 ? 0.1 : -0.1;
                setZoom((z) =>
                  Math.max(0.4, Math.min(2.4, +(z + delta).toFixed(2)))
                );
              }}
            >
              <g
                transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}
              >
                {/* Edges */}
                {visibleEdges.map((edge) => {
                  const src = nodeById.get(edge.source);
                  const tgt = nodeById.get(edge.target);
                  if (!src || !tgt) return null;
                  const isHighlighted =
                    activeFocusId === edge.source ||
                    activeFocusId === edge.target;
                  const isDimmed =
                    Boolean(activeFocusId) && !isHighlighted;
                  return (
                    <line
                      key={edge.id}
                      x1={src.x}
                      y1={src.y}
                      x2={tgt.x}
                      y2={tgt.y}
                      className={`knowledge-graph__edge knowledge-graph__edge--${
                        edge.kind
                      }${
                        isHighlighted
                          ? ' knowledge-graph__edge--highlighted'
                          : ''
                      }${isDimmed ? ' knowledge-graph__edge--dimmed' : ''}`}
                    />
                  );
                })}

                {/* Nodes */}
                {nodes
                  .filter((n) => filteredNodeIds.has(n.id))
                  .map((node) => {
                    const radius =
                      (node.type === 'note' ? 12 : 10) +
                      Math.min(node.degree * 2, 10);
                    const isSelected = selectedNodeId === node.id;
                    const isDimmed =
                      Boolean(activeFocusId) && !neighborIds.has(node.id);

                    return (
                      <g
                        key={node.id}
                        transform={`translate(${node.x}, ${node.y})`}
                        role="button"
                        tabIndex={0}
                        aria-label={`${node.type} node: ${node.label}`}
                        className={`knowledge-graph__node knowledge-graph__node--${
                          node.type
                        }${
                          isSelected ? ' knowledge-graph__node--selected' : ''
                        }${isDimmed ? ' knowledge-graph__node--dimmed' : ''}`}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          draggingNodeRef.current = node.id;
                        }}
                        onMouseEnter={() => setHoveredNodeId(node.id)}
                        onMouseLeave={() => setHoveredNodeId(null)}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedNodeId(node.id);
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          if (node.type === 'note' && node.noteId) {
                            onOpenNote(node.noteId);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedNodeId(node.id);
                          }
                        }}
                      >
                        <circle
                          r={radius}
                          className="knowledge-graph__node-circle"
                        />
                        <text
                          y={radius + 14}
                          textAnchor="middle"
                          className="knowledge-graph__node-label"
                        >
                          {node.label}
                        </text>
                      </g>
                    );
                  })}
              </g>
            </svg>

            <div className="knowledge-graph__legend" aria-label="Graph legend">
              <span className="knowledge-graph__legend-item">
                <span className="knowledge-graph__legend-dot knowledge-graph__legend-dot--note" />
                Note
              </span>
              <span className="knowledge-graph__legend-item">
                <span className="knowledge-graph__legend-dot knowledge-graph__legend-dot--tag" />
                Topic (#tag)
              </span>
              <span className="knowledge-graph__legend-item">
                <span className="knowledge-graph__legend-dot knowledge-graph__legend-dot--concept" />
                Concept ([[link]])
              </span>
              <span className="knowledge-graph__legend-item">
                <span className="knowledge-graph__legend-line--semantic" />
                Semantic ({embeddingStatus === 'ready' ? 'MiniLM' : embeddingStatus})
              </span>
            </div>
          </div>
        )}

        {selectedNode && (
          <aside
            className="knowledge-graph__inspector"
            aria-label="Selected graph node details"
          >
            <div className="knowledge-graph__inspector-header">
              <span
                className={`knowledge-graph__badge knowledge-graph__badge--${selectedNode.type}`}
              >
                {selectedNode.type === 'note'
                  ? 'Note'
                  : selectedNode.type === 'tag'
                  ? 'Topic'
                  : 'Concept'}
              </span>
              <button
                type="button"
                className="knowledge-graph__inspector-close"
                aria-label="Close node details"
                onClick={() => setSelectedNodeId(null)}
              >
                ×
              </button>
            </div>

            <h3 className="knowledge-graph__inspector-title">
              {selectedNode.label}
            </h3>

            {selectedNode.type === 'note' && selectedNode.noteId && (
              <button
                type="button"
                className="knowledge-graph__primary-btn"
                onClick={() => onOpenNote(selectedNode.noteId!)}
              >
                Open Note in Editor
              </button>
            )}

            {selectedNode.type === 'concept' && (
              <button
                type="button"
                className="knowledge-graph__primary-btn"
                onClick={() => onCreateConceptNote(selectedNode.label)}
              >
                Create Note &ldquo;{selectedNode.label}&rdquo;
              </button>
            )}

            <div className="knowledge-graph__inspector-section">
              <h4 className="knowledge-graph__inspector-subtitle">
                Connected Nodes ({selectedNodeNeighbors.length})
              </h4>
              {selectedNodeNeighbors.length === 0 ? (
                <p className="knowledge-graph__inspector-empty">
                  No connections yet.
                </p>
              ) : (
                <ul className="knowledge-graph__inspector-list">
                  {selectedNodeNeighbors.map(({ node: neighbor, kind, weight }) => (
                    <li key={neighbor.id}>
                      <button
                        type="button"
                        className="knowledge-graph__neighbor-btn"
                        onClick={() => {
                          if (neighbor.type === 'note' && neighbor.noteId) {
                            onOpenNote(neighbor.noteId);
                          } else {
                            setSelectedNodeId(neighbor.id);
                          }
                        }}
                      >
                        <span className="knowledge-graph__neighbor-label">
                          {neighbor.label}
                        </span>
                        <span className="knowledge-graph__neighbor-action">
                          {kind === 'semantic' && weight !== undefined
                            ? `${Math.round(weight * 100)}% similar`
                            : neighbor.type === 'note'
                            ? 'Open note →'
                            : 'Focus'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}
