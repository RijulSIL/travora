export function parseFastApi422(detail) {
  const fieldErrors = {};
  if (!Array.isArray(detail)) return fieldErrors;
  detail.forEach((item) => {
    const loc = Array.isArray(item?.loc) ? item.loc : [];
    const field = loc[loc.length - 1];
    if (field && typeof field === 'string') {
      fieldErrors[field] = item?.msg || 'Invalid value';
    }
  });
  return fieldErrors;
}

export function normalizeApiError(error) {
  if (!error?.response) {
    return {
      kind: 'network',
      status: null,
      message: 'Network error. Please check your connection.',
      fieldErrors: {},
      raw: error,
    };
  }
  const { status, data } = error.response;
  if ([500, 502, 503].includes(status)) {
    return { kind: 'server', status, message: 'Server error. Please try again in a moment.', fieldErrors: {}, raw: error };
  }
  if (status === 403) {
    return { kind: 'forbidden', status, message: "You don't have permission for this action.", fieldErrors: {}, raw: error };
  }
  if (status === 422) {
    const fieldErrors = parseFastApi422(data?.detail);
    return {
      kind: 'validation',
      status,
      message: typeof data?.detail === 'string' ? data.detail : 'Please correct highlighted fields.',
      fieldErrors,
      raw: error,
    };
  }
  return {
    kind: 'unknown',
    status,
    message: data?.detail || error.message || 'Request failed',
    fieldErrors: {},
    raw: error,
  };
}

export function shouldRetryGet(error, attempt) {
  if (attempt >= 2) return false;
  const method = (error?.config?.method || '').toLowerCase();
  if (method && method !== 'get') return false;
  if (!error?.response) return true;
  return [502, 503].includes(error.response.status);
}
