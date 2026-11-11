import { requirePrincipal } from '@/lib/server/auth/principal';
import { readFormData } from '@/lib/server/http/body';
import { validationError } from '@/lib/server/http/errors';
import { jsonResponse, route } from '@/lib/server/http/responses';
import { createDocument, normalizeTitle } from '@/lib/server/documents/service';
import { importToTipTap, validateUpload } from '@/lib/server/import/parse';

// API responses are session-scoped and must never be cached.
export const dynamic = 'force-dynamic';

/**
 * Imports a `.txt` or `.md` file as a new, editable document owned by the caller.
 *
 * Every check is server-side: extension, MIME type, size limit, UTF-8 decodability and
 * a binary sniff. The uploaded content is converted to structured TipTap JSON and is
 * never rendered as trusted HTML.
 */
export const POST = route(async (req: Request) => {
  const principal = await requirePrincipal(req);

  const form = await readFormData(req);
  const file = form.get('file');

  if (!(file instanceof File)) {
    throw validationError('A file is required.', { field: 'file' });
  }

  const validation = await validateUpload(file);
  if (!validation.ok) {
    throw validation.error;
  }

  const requestedTitle = form.get('title');
  const title = normalizeTitle(
    typeof requestedTitle === 'string' && requestedTitle.trim().length > 0
      ? requestedTitle
      : validation.title,
  );

  const content = importToTipTap(validation.kind, validation.text);

  const document = await createDocument(principal, { title, content });
  return jsonResponse(document, 201);
});
