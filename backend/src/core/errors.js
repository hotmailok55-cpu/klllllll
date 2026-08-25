'use strict';

/**
 * Typed application errors.
 *
 * Throw an `AppError` (or one of the helpers) anywhere in a service and the
 * HTTP layer turns it into a clean JSON response with the right status code and
 * a stable machine-readable `code`. This keeps user-facing error messages
 * understandable (spec §73) instead of leaking stack traces.
 */

class AppError extends Error {
  /**
   * @param {number} status  HTTP status code
   * @param {string} code    stable machine code, e.g. 'VALIDATION_ERROR'
   * @param {string} message human-readable, safe-to-show message
   * @param {object} [details] optional structured details (validation fields…)
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true; // safe to send to the client
  }
}

const badRequest = (msg, details) => new AppError(400, 'BAD_REQUEST', msg, details);
const validation = (msg, details) => new AppError(422, 'VALIDATION_ERROR', msg || 'Some fields are invalid.', details);
const unauthorized = (msg) => new AppError(401, 'UNAUTHORIZED', msg || 'You need to sign in to do that.');
const forbidden = (msg) => new AppError(403, 'FORBIDDEN', msg || "You don't have permission to do that.");
const notFound = (msg) => new AppError(404, 'NOT_FOUND', msg || 'That was not found.');
const conflict = (msg, details) => new AppError(409, 'CONFLICT', msg || 'That conflicts with something that already exists.', details);
const tooManyRequests = (msg) => new AppError(429, 'RATE_LIMITED', msg || 'Too many requests. Please slow down and try again shortly.');
const serviceUnavailable = (msg) => new AppError(503, 'SERVICE_UNAVAILABLE', msg || 'That service is temporarily unavailable.');

module.exports = {
  AppError,
  badRequest,
  validation,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  tooManyRequests,
  serviceUnavailable,
};
