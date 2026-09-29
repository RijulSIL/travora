import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function Pagination({ page, totalPages, onPageChange, total, pageSize, startIndex }) {
  if (total === 0) return null;

  const rangeStart = total === 0 ? 0 : startIndex + 1;
  const rangeEnd = Math.min(startIndex + pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/60 px-5 py-3 text-xs text-slate-500">
      <span>
        Showing <span className="font-medium text-slate-700">{rangeStart}</span>
        {'–'}
        <span className="font-medium text-slate-700">{rangeEnd}</span> of{' '}
        <span className="font-medium text-slate-700">{total}</span>
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="min-w-[64px] text-center font-medium text-slate-700">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
