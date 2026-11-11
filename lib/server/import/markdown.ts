import { fromMarkdown } from 'mdast-util-from-markdown';
import type { TipTapDoc, TipTapMark, TipTapNode } from '@/lib/tiptap';

/**
 * Markdown → TipTap JSON conversion — DeepSeek-owned.
 *
 * The output is structured editor content, never HTML. Raw HTML in the source Markdown
 * is **dropped**, links with unsafe protocols are degraded to plain text, and images
 * are only kept when their URL uses a safe protocol.
 */

/**
 * Minimal structural view of an mdast node.
 *
 * The converter deliberately does not lean on mdast's discriminated unions: the shape
 * here is small, stable, and keeps this module independent of mdast's type churn.
 */
type MdNode = {
  type: string;
  children?: MdNode[];
  value?: string;
  depth?: number;
  lang?: string | null;
  url?: string;
  alt?: string | null;
  title?: string | null;
  ordered?: boolean;
  start?: number | null;
};

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/**
 * Rejects `javascript:`, `data:`, `vbscript:` and other script-bearing URLs.
 * Relative URLs are allowed.
 */
export function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith('#') || trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return true;
  }
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
  if (!match) return true; // no scheme → relative
  return SAFE_PROTOCOLS.has(`${match[1].toLowerCase()}:`);
}

function extractText(node: MdNode): string {
  if (typeof node.value === 'string') return node.value;
  if (!node.children) return '';
  return node.children.map(extractText).join('');
}

function withMarks(text: string, marks: TipTapMark[]): TipTapNode {
  return marks.length > 0 ? { type: 'text', text, marks } : { type: 'text', text };
}

function convertPhrasing(nodes: MdNode[], activeMarks: TipTapMark[] = []): TipTapNode[] {
  const out: TipTapNode[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case 'text': {
        if (node.value) out.push(withMarks(node.value, activeMarks));
        break;
      }
      case 'strong': {
        out.push(...convertPhrasing(node.children ?? [], [...activeMarks, { type: 'bold' }]));
        break;
      }
      case 'emphasis': {
        out.push(...convertPhrasing(node.children ?? [], [...activeMarks, { type: 'italic' }]));
        break;
      }
      case 'inlineCode': {
        if (node.value) out.push(withMarks(node.value, [...activeMarks, { type: 'code' }]));
        break;
      }
      case 'delete': {
        out.push(...convertPhrasing(node.children ?? [], [...activeMarks, { type: 'strike' }]));
        break;
      }
      case 'link': {
        const href = node.url ?? '';
        if (!isSafeUrl(href)) {
          // Keep the text, drop the unsafe link.
          out.push(...convertPhrasing(node.children ?? [], activeMarks));
          break;
        }
        out.push(
          ...convertPhrasing(node.children ?? [], [
            ...activeMarks,
            {
              type: 'link',
              attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow' },
            },
          ]),
        );
        break;
      }
      case 'break': {
        out.push({ type: 'hardBreak' });
        break;
      }
      case 'image': {
        const src = node.url ?? '';
        if (!isSafeUrl(src)) break;
        out.push({
          type: 'image',
          attrs: { src, alt: node.alt ?? null, title: node.title ?? null },
        });
        break;
      }
      case 'html': {
        // Raw HTML is never carried into the document.
        break;
      }
      default: {
        const text = extractText(node);
        if (text) out.push(withMarks(text, activeMarks));
      }
    }
  }

  return out;
}

function convertListItem(node: MdNode): TipTapNode | null {
  if (node.type !== 'listItem') return null;
  const content = (node.children ?? [])
    .map(convertBlock)
    .filter((child): child is TipTapNode => child !== null);
  return { type: 'listItem', content: content.length > 0 ? content : [{ type: 'paragraph' }] };
}

function convertBlock(node: MdNode): TipTapNode | null {
  switch (node.type) {
    case 'paragraph': {
      const content = convertPhrasing(node.children ?? []);
      return { type: 'paragraph', content };
    }
    case 'heading': {
      const level = Math.min(Math.max(node.depth ?? 1, 1), 6);
      return {
        type: 'heading',
        attrs: { level },
        content: convertPhrasing(node.children ?? []),
      };
    }
    case 'code': {
      return {
        type: 'codeBlock',
        attrs: { language: node.lang ?? null },
        content: node.value ? [{ type: 'text', text: node.value }] : [],
      };
    }
    case 'blockquote': {
      const content = (node.children ?? [])
        .map(convertBlock)
        .filter((child): child is TipTapNode => child !== null);
      return { type: 'blockquote', content: content.length > 0 ? content : [{ type: 'paragraph' }] };
    }
    case 'list': {
      const content = (node.children ?? [])
        .map(convertListItem)
        .filter((child): child is TipTapNode => child !== null);
      if (node.ordered) {
        return {
          type: 'orderedList',
          attrs: { start: node.start ?? 1 },
          content,
        };
      }
      return { type: 'bulletList', content };
    }
    case 'thematicBreak': {
      return { type: 'horizontalRule' };
    }
    case 'html': {
      return null;
    }
    default: {
      const text = extractText(node);
      if (!text.trim()) return null;
      return { type: 'paragraph', content: [{ type: 'text', text }] };
    }
  }
}

/** Converts a Markdown string into a TipTap JSON document. */
export function markdownToTipTap(markdown: string): TipTapDoc {
  const root = fromMarkdown(markdown) as unknown as { children: MdNode[] };
  const content = (root.children ?? [])
    .map(convertBlock)
    .filter((node): node is TipTapNode => node !== null);

  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] };
}
