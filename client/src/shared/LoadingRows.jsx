// Grey placeholder rows while data loads, in place of a "Loading…" line, so
// the page keeps its shape and nothing jumps when the rows arrive. The words
// stay for screen readers.
export default function LoadingRows({ rows = 4 }) {
  return (
    <div role="status" aria-live="polite" className="space-y-2.5 py-3" data-keep-colour>
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-4 rounded-md bg-white/[0.07] animate-pulse" style={{ width: `${92 - (i % 3) * 14}%` }} />
      ))}
    </div>
  );
}
