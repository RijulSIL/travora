export const formatCurrency = (amount) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(Number(amount || 0));

export const formatDate = (dateString) =>
  new Date(dateString).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

export const formatDatetime = (dateString) =>
  new Date(dateString).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export const formatRelative = (dateString) => {
  const diff = Date.now() - new Date(dateString).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 30) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)} minutes ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} hours ago`;
  return `${Math.floor(sec / 86400)} days ago`;
};
