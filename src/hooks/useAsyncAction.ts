/**
 * Hook for handling async actions with loading and error state
 */

import { useState, useCallback } from 'react';
import { extractErrorMessage } from '../utils/errorHandling';

interface AsyncActionState {
  loading: boolean;
  error: string | null;
}

interface AsyncActionResult<T> extends AsyncActionState {
  execute: <R = T>(fn: () => Promise<R>) => Promise<R | undefined>;
  clearError: () => void;
  setError: (error: string | null) => void;
}

/**
 * Abstracts the common try-catch-loading-error pattern for async operations.
 *
 * @example
 * const { loading, error, execute, clearError } = useAsyncAction();
 *
 * const handleUpload = () => execute(async () => {
 *   const result = await uploadFile(file);
 *   return result;
 * });
 */
export function useAsyncAction<T = void>(): AsyncActionResult<T> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async <R = T>(fn: () => Promise<R>): Promise<R | undefined> => {
    setLoading(true);
    setError(null);
    try {
      const result = await fn();
      return result;
    } catch (e) {
      const message = extractErrorMessage(e);
      setError(message);
      return undefined;
    } finally {
      setLoading(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { loading, error, execute, clearError, setError };
}
