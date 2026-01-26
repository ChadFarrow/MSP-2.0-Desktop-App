/**
 * Error handling utilities
 */

/**
 * Extracts a human-readable error message from an unknown error value.
 * Useful in catch blocks where the error type is unknown.
 */
export function extractErrorMessage(e: unknown, fallback = 'Operation failed'): string {
  return e instanceof Error ? e.message : fallback;
}
