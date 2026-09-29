import { useEffect, useMemo, useState } from 'react';

export const DEFAULT_PAGE_SIZE = 10;

export function usePagination(items, pageSize = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const list = items || [];
  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));

  useEffect(() => {
    setPage(1);
  }, [list.length]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return list.slice(start, start + pageSize);
  }, [list, page, pageSize]);

  const startIndex = (page - 1) * pageSize;

  return { page, setPage, totalPages, pageItems, startIndex, pageSize, total: list.length };
}
