import type { ErrorCode } from '../../shared/contracts.js';
import { ERROR_MESSAGES } from '../../shared/error-messages.js';

export class ServiceError extends Error {
  constructor(readonly code: ErrorCode, readonly status: number) {
    super(ERROR_MESSAGES[code]);
    this.name = 'ServiceError';
  }
}

// Never return arbitrary exception messages: they can contain tokens/URLs.
export function publicError(error: unknown): ServiceError {
  return error instanceof ServiceError ? error : new ServiceError('INTERNAL', 500);
}
