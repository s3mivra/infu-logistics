import { useEffect } from 'react';
import { X, BookOpen } from 'lucide-react';
import { staffGuide } from '../../shared/staffGuide.js';

// The quick guide window. Opens by itself on someone's first sign-in and is
// always in the account menu after that. What it says comes from
// shared/staffGuide.js, chosen by the reader's own permissions.
export default function StaffGuide({ open, onClose, user, businessType, can }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const sections = staffGuide({ role: user?.role, businessType, can });

  return (
    <div className="fixed inset-0 z-[9990] bg-black/70 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="staff-guide-title" onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-2xl max-h-[92vh] flex flex-col bg-sidebar-bg border border-white/10 rounded-t-2xl sm:rounded-2xl shadow-2xl">
        <div className="flex items-start gap-3 p-5 border-b border-white/10">
          <div className="w-10 h-10 rounded-xl bg-brand/15 border border-brand/30 flex items-center justify-center shrink-0">
            <BookOpen size={18} className="text-brand-text" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="staff-guide-title" className="text-fg font-black text-lg leading-tight">Quick guide</h2>
            <p className="text-fg/70 text-xs mt-0.5">
              Hi {user?.name?.split(' ')[0] || 'there'} - the everyday steps for your role. It is always in the account menu (your name, bottom left).
            </p>
          </div>
          <button onClick={onClose} aria-label="Close guide"
            className="w-9 h-9 rounded-lg bg-white/5 hover:bg-white/10 text-fg/75 hover:text-fg flex items-center justify-center shrink-0 transition">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-5">
          {sections.map((s, i) => (
            <section key={s.id} aria-labelledby={`guide-${s.id}`}>
              <h3 id={`guide-${s.id}`} className="flex items-center gap-2 text-fg font-black text-sm mb-2">
                <span className="w-6 h-6 rounded-full bg-brand text-on-brand text-[11px] flex items-center justify-center shrink-0">{i + 1}</span>
                {s.title}
              </h3>
              <ul className="space-y-1.5 pl-8">
                {s.steps.map((step, j) => (
                  <li key={j} className="text-fg/85 text-[13px] leading-snug list-disc marker:text-fg/40">{step}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="p-4 border-t border-white/10 flex justify-end">
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl bg-brand text-on-brand font-black text-xs uppercase tracking-wider hover:bg-brand/90 transition">
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
