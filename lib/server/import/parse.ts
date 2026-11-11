import { extname } from 'node:path';
import { fileTooLarge, unsupportedFileType } from '@/lib/server/http/errors';
import type { AppError } from '@/lib/server/http/errors';
import { LIMITS } from '@/lib/tiptap';
import type { TipTapDoc, TipTapNode } from '@/lib/tiptap';
import { markdownToTipTap } from './markdown';

/**
 * Upload validation and text/Markdown → TipTap conversion — DeepSeek-owned.
 *
 * All checks run on the server. The client cannot widen the accepted types or sizes.
 */

export type ImportKind = 'txt' | 'md';

export const ALLOWED_EXTENSIONS = ['.txt', '.md', '.markdown'] as const;

/**
 * Accepted MIME types. `application/octet-stream` is tolerated because browsers and
 * CLI clients frequently send it for `.md` files; the extension check and the content
 * sniff still have to pass.
 */
export const ALLOWED_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'text/x-md',
  'text/md',
  'application/markdown',
  'application/octet-stream',
] as const;

/** U+0000 — present in binary files, never in legitimate text. */
const NULL_BYTE = String.fromCharCode(0);
/** U+FFFD — the replacement character produced when UTF-8 decoding fails. */
const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);

export function detectImportKind(filename: string): ImportKind | null {
  const extension = extname(filename).toLowerCase();
  if (extension === '.txt') return 'txt';
  if (extension === '.md' || extension === '.markdown') return 'md';
  return null;
}

function baseMimeType(contentType: string | null): string {
  if (!contentType) return '';
  return contentType.split(';')[0].trim().toLowerCase();
}

export function maxUploadBytes(): number {
  const raw = process.env.MAX_UPLOAD_BYTES;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : LIMITS.MAX_UPLOAD_BYTES;
}

export type UploadValidation =
  | { ok: true; kind: ImportKind; text: string; title: string }
  | { ok: false; error: AppError };

/**
 * Validates an uploaded file and returns its decoded text.
 *
 * Order of checks: size → extension → MIME → decodability → binary sniff.
 */
export async function validateUpload(file: File): Promise<UploadValidation> {
  const limit = maxUploadBytes();

  if (file.size > limit) {
    return {
      ok: false,
      error: fileTooLarge(
        `"${file.name}" is ${formatBytes(file.size)}. The maximum allowed size is ${formatBytes(limit)}.`,
        { maxBytes: limit, actualBytes: file.size },
      ),
    };
  }

  const kind = detectImportKind(file.name);
  if (!kind) {
    return {
      ok: false,
      error: unsupportedFileType(
        `"${file.name}" is not a supported file type. Allowed extensions: ${ALLOWED_EXTENSIONS.join(', ')}.`,
        { allowedExtensions: ALLOWED_EXTENSIONS },
      ),
    };
  }

  const mime = baseMimeType(file.type);
  if (mime.length > 0 && !ALLOWED_MIME_TYPES.includes(mime as (typeof ALLOWED_MIME_TYPES)[number])) {
    return {
      ok: false,
      error: unsupportedFileType(
        `Content type "${mime}" is not supported for import.`,
        { allowedMimeTypes: ALLOWED_MIME_TYPES },
      ),
    };
  }

  const text = await file.text();

  if (text.includes(NULL_BYTE)) {
    return {
      ok: false,
      error: unsupportedFileType('The file appears to be binary rather than text.'),
    };
  }

  if (text.includes(REPLACEMENT_CHARACTER)) {
    return {
      ok: false,
      error: unsupportedFileType(
        'The file could not be decoded as UTF-8 text. Please re-save it as UTF-8 and try again.',
      ),
    };
  }

  return { ok: true, kind, text, title: titleFromFilename(file.name) };
}

/** Derives a document title from an uploaded filename. */
export function titleFromFilename(filename: string): string {
  const base = basename(filename);
  const extension = extname(base);
  const withoutExtension = extension ? base.slice(0, -extension.length) : base;
  const cleaned = withoutExtension.replace(/[_-]+/g, ' ').trim();
  const candidate = cleaned.length > 0 ? cleaned : base;
  return candidate.slice(0, LIMITS.MAX_TITLE_LENGTH);
}

function basename(filename: string): string {
  const normalized = filename.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] ?? filename;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Plain text → TipTap JSON.
 *
 * Blank-line separated blocks become paragraphs; single newlines inside a block become
 * hard breaks so the visible line structure survives the round-trip.
 */
export function textToTipTap(raw: string): TipTapDoc {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n[ \t]*\n+/);

  const content: TipTapNode[] = [];
  for (const block of blocks) {
    if (block.trim().length === 0) continue;
    const lines = block.split('\n');
    const nodes: TipTapNode[] = [];
    lines.forEach((line, index) => {
      if (index > 0) nodes.push({ type: 'hardBreak' });
      if (line.length > 0) nodes.push({ type: 'text', text: line });
    });
    content.push({ type: 'paragraph', content: nodes });
  }

  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] };
}

/** Converts validated upload text into editor content. */
export function importToTipTap(kind: ImportKind, text: string): TipTapDoc {
  return kind === 'md' ? markdownToTipTap(text) : textToTipTap(text);
}
