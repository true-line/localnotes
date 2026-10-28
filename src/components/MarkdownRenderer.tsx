import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import '../styles/MarkdownRenderer.css';

interface Props {
  content: string;
  onWikiLinkClick?: (target: string) => void;
  onTagClick?: (tag: string) => void;
}

const SAFE_PROTOCOL_RE = /^(?:https?|mailto|tel)$/i;
const INTERNAL_SCHEME_RE = /^(?:wikilink|tag)$/i;

/**
 * Allowlist-based URL transform for rendered markdown. Keeps LocalNotes'
 * internal `wikilink:`/`tag:` schemes, relative references, and fragments;
 * strips anything with a dangerous or unknown scheme (`javascript:`, `data:`,
 * `vbscript:`, `file:`, ...). The colon-position heuristic mirrors
 * react-markdown's defaultUrlTransform so `java\tscript:`-style smuggling
 * (browsers ignore tabs/newlines inside the scheme) is still caught.
 */
export function sanitizeMarkdownUrl(url: string): string {
  const colon = url.indexOf(':');
  const questionMark = url.indexOf('?');
  const numberSign = url.indexOf('#');
  const slash = url.indexOf('/');

  const schemePart = colon > -1 ? url.slice(0, colon) : '';
  if (INTERNAL_SCHEME_RE.test(schemePart)) return url;

  const looksRelative =
    colon < 0 ||
    (slash > -1 && colon > slash) ||
    (questionMark > -1 && colon > questionMark) ||
    (numberSign > -1 && colon > numberSign);

  return looksRelative || SAFE_PROTOCOL_RE.test(schemePart) ? url : '';
}

function preprocessWikiLinksAndTags(markdown: string): string {
  // Split by fenced code blocks and inline code so we never transform inside code
  const parts = markdown.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  return parts
    .map((part, index) => {
      if (index % 2 === 1) return part; // inside code block / inline code
      return part
        .replace(
          /\[\[([^[\]|]+?)(?:\|([^[\]]+?))?\]\]/g,
          (_match, target: string, alias?: string) => {
            const cleanTarget = target.trim();
            const display = (alias ?? target).trim();
            return `[${display}](wikilink:${encodeURIComponent(cleanTarget)})`;
          }
        )
        .replace(
          /(^|[\s(])#([a-zA-Z][a-zA-Z0-9_-]*(?:\/[a-zA-Z0-9_-]+)*)/g,
          (_match, prefix: string, tag: string) =>
            `${prefix}[#${tag}](tag:${tag.toLowerCase()})`
        );
    })
    .join('');
}

export function MarkdownRenderer({
  content,
  onWikiLinkClick,
  onTagClick,
}: Props) {
  if (!content.trim())
    return <p className="markdown-renderer__empty">Nothing to preview.</p>;

  const processed = preprocessWikiLinksAndTags(content);

  return (
    <div className="markdown-renderer">
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={sanitizeMarkdownUrl}
        components={{
          a: ({ href, children, ...rest }) => {
            if (href?.startsWith('wikilink:')) {
              const target = decodeURIComponent(href.slice('wikilink:'.length));
              return (
                <button
                  type="button"
                  className="markdown-renderer__wikilink"
                  onClick={() => onWikiLinkClick?.(target)}
                  title={`Open or create "${target}"`}
                >
                  [[{children}]]
                </button>
              );
            }
            if (href?.startsWith('tag:')) {
              const tag = href.slice('tag:'.length);
              return (
                <button
                  type="button"
                  className="markdown-renderer__tag"
                  onClick={() => onTagClick?.(tag)}
                  title={`View #${tag} in knowledge graph`}
                >
                  {children}
                </button>
              );
            }
            if (!href) {
              // URL was stripped by the sanitizer; keep the text but inert
              return (
                <span className="markdown-renderer__dead-link">{children}</span>
              );
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
                {children}
              </a>
            );
          },
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}
