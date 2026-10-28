import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkdownRenderer, sanitizeMarkdownUrl } from '../components/MarkdownRenderer';

describe('sanitizeMarkdownUrl', () => {
  it('allows safe external protocols', () => {
    expect(sanitizeMarkdownUrl('https://example.com/page')).toBe(
      'https://example.com/page'
    );
    expect(sanitizeMarkdownUrl('http://example.com')).toBe('http://example.com');
    expect(sanitizeMarkdownUrl('mailto:someone@example.com')).toBe(
      'mailto:someone@example.com'
    );
  });

  it('allows fragments, query strings, and relative references', () => {
    expect(sanitizeMarkdownUrl('#section')).toBe('#section');
    expect(sanitizeMarkdownUrl('?q=test')).toBe('?q=test');
    expect(sanitizeMarkdownUrl('./other-page')).toBe('./other-page');
    expect(sanitizeMarkdownUrl('images/pic.png')).toBe('images/pic.png');
  });

  it('strips dangerous schemes', () => {
    expect(sanitizeMarkdownUrl('javascript:alert(1)')).toBe('');
    expect(sanitizeMarkdownUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe('');
    expect(sanitizeMarkdownUrl('vbscript:msgbox(1)')).toBe('');
    expect(sanitizeMarkdownUrl('file:///etc/passwd')).toBe('');
  });

  it('strips whitespace-smuggled scheme names', () => {
    // Browsers ignore tabs and newlines inside the scheme, so
    // "java\tscript:alert(1)" would otherwise execute as javascript:
    expect(sanitizeMarkdownUrl('java\tscript:alert(1)')).toBe('');
    expect(sanitizeMarkdownUrl('java\nscript:alert(1)')).toBe('');
    expect(sanitizeMarkdownUrl(' javascript:alert(1)')).toBe('');
  });

  it('strips unknown schemes even if harmless-looking', () => {
    expect(sanitizeMarkdownUrl('chrome-extension://abc/index.html')).toBe('');
    expect(sanitizeMarkdownUrl('blob:https://example.com/id')).toBe('');
  });

  it('keeps internal wikilink: and tag: schemes', () => {
    expect(sanitizeMarkdownUrl('wikilink:My%20Note')).toBe(
      'wikilink:My%20Note'
    );
    expect(sanitizeMarkdownUrl('tag:security')).toBe('tag:security');
  });
});

describe('MarkdownRenderer link rendering', () => {
  it('renders a javascript: link as inert text, not an anchor', () => {
    render(<MarkdownRenderer content={'[bad](javascript:alert(1))'} />);
    expect(screen.getByText('bad').tagName).toBe('SPAN');
    expect(screen.queryByRole('link', { name: 'bad' })).toBeNull();
  });

  it('renders external links with target=_blank and rel=noopener', () => {
    render(<MarkdownRenderer content={'[ok](https://example.com)'} />);
    const link = screen.getByRole('link', { name: 'ok' });
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders wikilinks as buttons that report their target', () => {
    render(<MarkdownRenderer content={'[[Some Note]]'} />);
    const button = screen.getByRole('button', { name: '[[Some Note]]' });
    expect(button).toHaveClass('markdown-renderer__wikilink');
    expect(button).toHaveAttribute('title', 'Open or create "Some Note"');
  });

  it('renders tags as buttons', () => {
    render(<MarkdownRenderer content={'see #security notes'} />);
    const button = screen.getByRole('button', { name: '#security' });
    expect(button).toHaveClass('markdown-renderer__tag');
  });
});
