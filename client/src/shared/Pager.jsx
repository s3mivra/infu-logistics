import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Compact pagination control for report tables. Render it directly below a table.
// Pass the object returned by usePagination(). Hidden when everything fits on one page.
export default function Pager({ page, setPage, totalPages, total, pageSize, label = 'rows' }) {
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between gap-3 pt-3 mt-2 border-t border-white/10 text-xs text-white/50">
      <span className="tabular-nums">{from}–{to} of {total} {label}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setPage(p => Math.max(1, p - 1))}
          disabled={page <= 1}
          aria-label="Previous page"
          className="p-1.5 rounded-lg border border-white/10 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="px-2 tabular-nums">{page} / {totalPages}</span>
        <button
          type="button"
          onClick={() => setPage(p => Math.min(totalPages, p + 1))}
          disabled={page >= totalPages}
          aria-label="Next page"
          className="p-1.5 rounded-lg border border-white/10 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
