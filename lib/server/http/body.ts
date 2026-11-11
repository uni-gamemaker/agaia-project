import { AppError, badRequest } from './errors';

/**
 * Request body parsing — DeepSeek-owned.
 */

export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await req.text();
  } catch {
    throw badRequest('Could not read the request body.');
  }

  if (text.trim().length === 0) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw badRequest('Request body must be valid JSON.');
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw badRequest('Request body must be a JSON object.');
  }

  return parsed as Record<string, unknown>;
}

export async function readFormData(req: Request): Promise<FormData> {
  try {
    return await req.formData();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw badRequest('Expected a multipart/form-data body.');
  }
}
