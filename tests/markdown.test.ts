import { describe, expect, it } from 'vitest';
import { isSafeUrl, markdownToTipTap } from '@/lib/server/import/markdown';
import { textToTipTap, titleFromFilename } from '@/lib/server/import/parse';
import { validateTipTapDoc } from '@/lib/tiptap';

describe('markdown → TipTap conversion', () => {
  it('converts headings with the right level', () => {
    const doc = markdownToTipTap('# H1\n\n## H2\n\n### H3');
    const headings = doc.content?.filter((node) => node.type === 'heading');
    expect(headings).toHaveLength(3);
    expect(headings?.map((node) => node.attrs?.level)).toEqual([1, 2, 3]);
  });

  it('converts bold and italic into marks', () => {
    const doc = markdownToTipTap('Some **bold** and *italic* and `code`.');
    const paragraph = doc.content?.[0];
    const marks = paragraph?.content?.map((node) => node.marks?.[0]?.type).filter(Boolean);
    expect(marks).toContain('bold');
    expect(marks).toContain('italic');
    expect(marks).toContain('code');
  });

  it('converts bullet and numbered lists', () => {
    const doc = markdownToTipTap('- one\n- two\n\n1. first\n2. second');
    expect(doc.content?.[0].type).toBe('bulletList');
    expect(doc.content?.[0].content).toHaveLength(2);
    expect(doc.content?.[0].content?.[0].type).toBe('listItem');
    expect(doc.content?.[1].type).toBe('orderedList');
    expect(doc.content?.[1].attrs?.start).toBe(1);
  });

  it('converts code blocks, quotes and rules', () => {
    const doc = markdownToTipTap('> quoted\n\n```ts\nconst a = 1;\n```\n\n---');
    expect(doc.content?.[0].type).toBe('blockquote');
    expect(doc.content?.[1].type).toBe('codeBlock');
    expect(doc.content?.[1].attrs?.language).toBe('ts');
    expect(doc.content?.[2].type).toBe('horizontalRule');
  });

  it('drops raw HTML instead of storing it', () => {
    const doc = markdownToTipTap('<script>alert(1)</script>\n\nSafe text');
    const serialized = JSON.stringify(doc);
    expect(serialized).not.toContain('script');
    expect(serialized).toContain('Safe text');
  });

  it('drops javascript: links but keeps their text', () => {
    const doc = markdownToTipTap('[click me](javascript:alert(1))');
    const serialized = JSON.stringify(doc);
    expect(serialized).not.toContain('javascript:');
    expect(serialized).toContain('click me');
  });

  it('keeps safe http links with protective attributes', () => {
    const doc = markdownToTipTap('[docs](https://example.com/docs)');
    const link = doc.content?.[0].content?.[0].marks?.[0];
    expect(link?.type).toBe('link');
    expect(link?.attrs?.href).toBe('https://example.com/docs');
    expect(link?.attrs?.rel).toContain('noopener');
  });

  it('produces a document that passes server-side validation', () => {
    const doc = markdownToTipTap('# Title\n\nBody with **bold**.\n\n- item');
    const result = validateTipTapDoc(doc);
    expect(result.ok).toBe(true);
  });
});

describe('URL safety', () => {
  it('rejects script-bearing protocols', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('JavaScript:alert(1)')).toBe(false);
    expect(isSafeUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(isSafeUrl('vbscript:msgbox(1)')).toBe(false);
  });

  it('allows normal web and relative URLs', () => {
    expect(isSafeUrl('https://example.com')).toBe(true);
    expect(isSafeUrl('http://example.com')).toBe(true);
    expect(isSafeUrl('mailto:someone@example.com')).toBe(true);
    expect(isSafeUrl('/docs/page')).toBe(true);
    expect(isSafeUrl('#section')).toBe(true);
    expect(isSafeUrl('relative/path')).toBe(true);
  });
});

describe('plain text → TipTap conversion', () => {
  it('splits blank-line separated blocks into paragraphs', () => {
    const doc = textToTipTap('One\n\nTwo\n\nThree');
    expect(doc.content).toHaveLength(3);
    expect(doc.content?.every((node) => node.type === 'paragraph')).toBe(true);
  });

  it('turns single newlines into hard breaks', () => {
    const doc = textToTipTap('Line A\nLine B');
    const paragraph = doc.content?.[0];
    expect(paragraph?.content?.some((node) => node.type === 'hardBreak')).toBe(true);
  });

  it('never produces an empty document', () => {
    const doc = textToTipTap('   \n\n  ');
    expect(doc.content).toHaveLength(1);
    expect(doc.content?.[0].type).toBe('paragraph');
  });
});

describe('filename handling', () => {
  it('derives a readable title', () => {
    expect(titleFromFilename('release-notes.md')).toBe('release notes');
    expect(titleFromFilename('my_report.txt')).toBe('my report');
    expect(titleFromFilename('notes.TXT')).toBe('notes');
  });
});
