import { useState, useMemo, useEffect } from 'react';

// Lightweight client-side pagination for report tables.
// Returns the current page's slice plus controls. Safe with undefined/empty input.
export function usePagination(items, pageSize = 10) {
  const list = Array.isArray(items) ? items : [];
  const [page, setPage] = useState(1);
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // If the list shrinks (re-fetch / filter), clamp the page back into range.
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [totalPages, page]);

  const pageItems = useMemo(
    () => list.slice((page - 1) * pageSize, page * pageSize),
    [list, page, pageSize]
  );

  return { pageItems, page, setPage, totalPages, total, pageSize };
}
