import { useState } from 'react';

import { normalizeApiError, shouldRetryGet } from '../utils/apiErrors';

export function useAsyncAction(action, options = {}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [statusText, setStatusText] = useState('');

  const run = async (...args) => {
    setLoading(true);
    setError(null);
    const maxAttempts = options.retry ? 3 : 1;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        setStatusText(attempt > 0 ? 'Retrying...' : '');
        return await action(...args);
      } catch (err) {
        const normalized = err.normalized || normalizeApiError(err);
        err.normalized = normalized;
        const canRetry = options.retry ? shouldRetryGet(err, attempt) : false;
        if (canRetry && attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        setError(err);
        throw err;
      }
    }
    return null;
  };

  const wrappedRun = async (...args) => {
    try {
      return await run(...args);
    } finally {
      setStatusText('');
      setLoading(false);
    }
  };

  return { run: wrappedRun, loading, error, statusText };
}
