import { AppError, internalError } from './errors';

/**
 * HTTP response helpers — DeepSeek-owned.
 *
 * All API responses are JSON. Success payloads are returned directly; failures always
 * use the `{ error: { code, message, details? } }` envelope from the contract.
 */

export function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(headers ?? {}),
    },
  });
}

export function errorResponse(error: AppError): Response {
  return jsonResponse(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    },
    error.status,
  );
}

export function noContentResponse(): Response {
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

/**
 * Wraps a route handler so that thrown `AppError`s become the error envelope and
 * unexpected failures become a generic 500 without leaking internals.
 */
export function route<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response> | Response,
): (...args: Args) => Promise<Response> {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof AppError) return errorResponse(err);
      console.error('[api] unhandled error:', err);
      return errorResponse(internalError());
    }
  };
}
