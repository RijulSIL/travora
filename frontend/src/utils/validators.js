export const required = (msg = 'This field is required.') => (value) =>
  value === null || value === undefined || String(value).trim() === '' ? msg : null;

export const email = (msg = 'Enter a valid email address.') => (value) => {
  if (!value) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value)) ? null : msg;
};

export const min = (n, msg) => (value) => {
  if (value === null || value === undefined || value === '') return null;
  return Number(value) >= n ? null : msg || `Must be at least ${n}.`;
};

export const max = (n, msg) => (value) => {
  if (value === null || value === undefined || value === '') return null;
  return Number(value) <= n ? null : msg || `Must be at most ${n}.`;
};

export const minLength = (n, msg) => (value) =>
  String(value || '').length >= n ? null : msg || `Must be at least ${n} characters.`;

export const maxLength = (n, msg) => (value) =>
  String(value || '').length <= n ? null : msg || `Must be at most ${n} characters.`;

export const pattern = (regex, msg = 'Invalid format.') => (value) =>
  !value || regex.test(String(value)) ? null : msg;

export const matches = (otherField, msg = 'Values do not match.') => (value, allValues) =>
  value === allValues?.[otherField] ? null : msg;
