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
        urlTransform={(url) => url}
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
            return (
              <a href={href} {...rest}>
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

