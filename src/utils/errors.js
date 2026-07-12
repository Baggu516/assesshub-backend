/**
 * Typed HTTP errors for controllers/services.
 * Prefer `throw new AppError(message, status)` over ad-hoc `err.status` / `err.statusCode`.
 */
export class AppError extends Error {
  /**
   * @param {string} message
   * @param {number} [status=500]
   */
  constructor(message, status = 500) {
    super(message);
    this.name = 'AppError';
    this.status = status;
  }
}

/** @param {boolean} condition @param {string} message @param {number} [status=400] */
export function assert(condition, message, status = 400) {
  if (!condition) throw new AppError(message, status);
}
