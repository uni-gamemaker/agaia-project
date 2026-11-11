import { z } from 'zod';

/**
 * TipTap document model.
 *
 * The editor owns the exact node vocabulary; the server only needs to know that the
 * payload is *structurally* a TipTap document so that malformed or hostile input is
 * rejected before it reaches the database. Unknown node/mark types are allowed through
 * (TipTap extensions may add nodes later), but the shape is strictly validated.
 */

export type TipTapMark = {
  type: string;
  attrs?: Record<string, unknown>;
};

export type TipTapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  text?: string;
  marks?: TipTapMark[];
};

export type TipTapDoc = TipTapNode & { type: 'doc' };

/** Hard limits — see docs/AGENT_CONTRACT.md §6. */
export const LIMITS = {
  MAX_UPLOAD_BYTES: 1_048_576, // 1 MB
  MAX_TITLE_LENGTH: 200,
  MAX_CONTENT_BYTES: 1_048_576, // 1 MB serialized TipTap JSON
  MAX_CONTENT_DEPTH: 20,
  MAX_SESSION_TTL_DAYS: 7,
} as const;

const MAX_NODE_TYPE_LENGTH = 64;
const MAX_MARK_TYPE_LENGTH = 64;

export const tipTapMarkSchema: z.ZodType<TipTapMark> = z.object({
  type: z.string().min(1).max(MAX_MARK_TYPE_LENGTH),
  attrs: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Recursive node schema. `z.lazy` is required because TipTap nodes nest arbitrarily.
 */
export const tipTapNodeSchema: z.ZodType<TipTapNode> = z.lazy(() =>
  z.object({
    type: z.string().min(1).max(MAX_NODE_TYPE_LENGTH),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(tipTapNodeSchema).optional(),
    text: z.string().optional(),
    marks: z.array(tipTapMarkSchema).max(16).optional(),
  }),
);

export const tipTapDocSchema: z.ZodType<TipTapDoc> = z.object({
  type: z.literal('doc'),
  attrs: z.record(z.string(), z.unknown()).optional(),
  content: z.array(tipTapNodeSchema).optional(),
});

/** Maximum nesting depth of a TipTap tree, counted from the root. */
export function contentDepth(node: TipTapNode): number {
  if (!node.content || node.content.length === 0) return 1;
  let max = 0;
  for (const child of node.content) {
    const d = contentDepth(child);
    if (d > max) max = d;
  }
  return max + 1;
}

/**
 * Validates a candidate TipTap document.
 * Returns a discriminated result instead of throwing so callers can map it onto the
 * HTTP error envelope without leaking parser internals.
 */
export type ContentValidationResult =
  | { ok: true; value: TipTapDoc }
  | { ok: false; reason: string; field: string };

export function validateTipTapDoc(input: unknown): ContentValidationResult {
  const parsed = tipTapDocSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue.path.join('.') || 'content';
    return { ok: false, reason: issue.message, field: path };
  }

  const doc = parsed.data;

  if (contentDepth(doc) > LIMITS.MAX_CONTENT_DEPTH) {
    return {
      ok: false,
      reason: `document nesting exceeds the maximum depth of ${LIMITS.MAX_CONTENT_DEPTH}`,
      field: 'content',
    };
  }

  const serialized = JSON.stringify(doc);
  if (Buffer.byteLength(serialized, 'utf8') > LIMITS.MAX_CONTENT_BYTES) {
    return {
      ok: false,
      reason: `document content exceeds the maximum size of ${LIMITS.MAX_CONTENT_BYTES} bytes`,
      field: 'content',
    };
  }

  return { ok: true, value: doc };
}

/** A minimal, valid empty document. */
export function emptyDoc(): TipTapDoc {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}
