/**
 * Application error model — DeepSeek-owned.
 *
 * Every failure that crosses the HTTP boundary is an `AppError` so that the response
 * envelope is uniform and predictable. Route handlers never leak raw driver errors.
 *
 * See docs/AGENT_CONTRACT.md §4.2 for the canonical error code list.
 */

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'SHARING_SELF_NOT_ALLOWED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'DOCUMENT_NOT_FOUND'
  | 'USER_NOT_FOUND'
  | 'MEMBER_NOT_FOUND'
  | 'CONFLICT'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: Record<string, unknown>) =>
  new AppError(400, 'BAD_REQUEST', message, details);

export const sharingSelfNotAllowed = (message = 'You cannot share a document with yourself.') =>
  new AppError(400, 'SHARING_SELF_NOT_ALLOWED', message);

export const unauthenticated = (message = 'Sign in to continue.') =>
  new AppError(401, 'UNAUTHENTICATED', message);

export const forbidden = (message = 'You do not have permission to perform this action.') =>
  new AppError(403, 'FORBIDDEN', message);

export const documentNotFound = (
  message = 'Document not found.',
): AppError => new AppError(404, 'DOCUMENT_NOT_FOUND', message);

export const userNotFound = (message = 'No user exists with that email address.') =>
  new AppError(404, 'USER_NOT_FOUND', message);

export const memberNotFound = (message = 'That user is not a member of this document.') =>
  new AppError(404, 'MEMBER_NOT_FOUND', message);

export const conflict = (message: string, details?: Record<string, unknown>) =>
  new AppError(409, 'CONFLICT', message, details);

export const fileTooLarge = (message: string, details?: Record<string, unknown>) =>
  new AppError(413, 'FILE_TOO_LARGE', message, details);

export const unsupportedFileType = (message: string, details?: Record<string, unknown>) =>
  new AppError(415, 'UNSUPPORTED_FILE_TYPE', message, details);

export const validationError = (message: string, details?: Record<string, unknown>) =>
  new AppError(422, 'VALIDATION_ERROR', message, details);

export const internalError = (message = 'Something went wrong. Please try again.') =>
  new AppError(500, 'INTERNAL_ERROR', message);
