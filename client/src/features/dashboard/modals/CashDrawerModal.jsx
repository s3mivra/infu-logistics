import { useDashboard } from '../../dashboard/DashboardContext';
import * as ui from '../../../shared/ui';

// The shop's one cash drawer, for a bar where several people ring on the same
// till. Reads shared dashboard state via useDashboard() rather than props -
// see DashboardContext.
//
// Deliberately separate from logging out. On a shared drawer a barista
// finishing their shift must NOT close the till - the money is still in it and
// other people are still selling. Closing is its own decision, made once, by
// whoever counts.
export default function CashDrawerModal() {
  const {
    cashDrawerModal, setCashDrawerModal,
    drawerSession, drawerBusy, drawerMovement, setDrawerMovement,
    submitDrawerMovement, openShiftEndFromDrawer,
  } = useDashboard();

  if (!cashDrawerModal) return null;

  const s = drawerSession;
  const money = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-surface border border-white/10 rounded-2xl shadow-2xl max-w-md w-full p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto custom-scrollbar">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black text-fg">Cash Drawer</h3>
            <p className="text-[11px] text-fg/70 mt-0.5">One till, shared by everyone on shift.</p>
          </div>
          <button onClick={() => setCashDrawerModal(false)}
            className="text-fg/60 hover:text-fg text-xs font-black uppercase tracking-widest">Close</button>
        </div>

        {!s ? (
          <p className="text-sm text-fg/70 italic">No drawer session is open.</p>
        ) : (
          <>
            {/* A drawer left open overnight sweeps the next day's sales into
                yesterday's count, and the shortfall at close looks alarming
                and inexplicable. Nothing closes a cash session automatically -
                a count cannot be invented - so this has to be impossible to
                miss instead. */}
            {s.openHours > 18 && (
              <div className="bg-warning/10 border border-warning/40 rounded-xl p-3">
                <p className="text-warning text-xs font-black uppercase tracking-widest">Open for {Math.round(s.openHours)} hours</p>
                <p className="text-[11px] text-fg/80 mt-1 leading-snug">
                  This session was opened on a previous day, so today&apos;s sales are being counted into it. Close and count it, then open a fresh drawer.
                </p>
              </div>
            )}
            <div className="bg-page-bg border border-white/10 rounded-xl p-4 space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-fg/70 font-bold">Opened by</span>
                <span className="text-fg font-black">{s.openedBy || s.cashierName}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-fg/70 font-bold">Since</span>
                <span className="text-fg font-black">{new Date(s.shiftStart).toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-fg/70 font-bold">Starting float</span>
                <span className="text-fg font-black tabular-nums">{money(s.startingCash)}</span>
              </div>
              {(s.payInsTotal > 0 || s.payOutsTotal > 0) && (
                <>
                  <div className="flex justify-between text-xs">
                    <span className="text-fg/70 font-bold">Paid in</span>
                    <span className="text-success font-black tabular-nums">{money(s.payInsTotal)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-fg/70 font-bold">Paid out</span>
                    <span className="text-warning font-black tabular-nums">{money(s.payOutsTotal)}</span>
                  </div>
                </>
              )}
              {/* Under a blind close the running total is withheld on purpose:
                  being able to read the figure you are meant to reach before
                  counting is what turns a variance into a formality. */}
              {s.expectedCash === undefined ? (
                <p className="text-[10px] text-fg/60 pt-1 leading-snug">The expected total is hidden until the drawer is counted.</p>
              ) : (
                <div className="flex justify-between text-xs pt-1 border-t border-white/10 mt-1">
                  <span className="text-fg/70 font-bold">Expected now</span>
                  <span className="text-brand-text font-black tabular-nums">{money(s.expectedCash)}</span>
                </div>
              )}
            </div>

            {/* Cash in or out that is not a sale. */}
            <div className="bg-page-bg border border-white/10 rounded-xl p-4">
              <p className="text-[10px] uppercase tracking-widest text-fg/70 font-bold mb-2">Record cash in or out</p>
              <div className="flex gap-2 mb-2">
                {['in', 'out'].map(t => (
                  <button key={t} type="button"
                    onClick={() => setDrawerMovement(m => ({ ...m, type: t }))}
                    className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition ${
                      drawerMovement.type === t ? 'bg-accent text-on-brand' : 'bg-surface text-fg/70 border border-white/10'}`}>
                    {t === 'in' ? 'Paid in' : 'Paid out'}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <input type="number" min="0" step="0.01" placeholder="Amount"
                  value={drawerMovement.amount}
                  onChange={e => setDrawerMovement(m => ({ ...m, amount: e.target.value }))}
                  className="w-28 min-w-0 bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent" />
                <input type="text" placeholder="What for? e.g. milk run"
                  value={drawerMovement.reason}
                  onChange={e => setDrawerMovement(m => ({ ...m, reason: e.target.value }))}
                  className="flex-1 min-w-0 bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-accent" />
                <button type="button" onClick={submitDrawerMovement} disabled={drawerBusy}
                  className="bg-accent text-on-brand px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-accent/90 transition disabled:opacity-50">
                  {drawerBusy ? 'Saving…' : 'Record'}
                </button>
              </div>
              <p className="text-[10px] text-fg/70 mt-2 leading-snug">
                Keeps the drawer count honest. It does not post to the ledger - the expense or deposit does that when you file it, and recording both would count the same money twice.
              </p>
            </div>

            {(s.movements || []).length > 0 && (
              <div className="space-y-1">
                {(s.movements || []).slice().reverse().map((m, i) => (
                  <div key={i} className="flex items-center justify-between bg-page-bg border border-white/10 rounded-lg px-3 py-1.5 text-xs">
                    <span className="text-fg/80 truncate pr-2">
                      <span className={m.type === 'in' ? 'text-success font-black' : 'text-warning font-black'}>{m.type === 'in' ? '+' : '-'}{money(m.amount)}</span>
                      <span className="text-fg/60"> · {m.reason}</span>
                    </span>
                    <span className="text-fg/60 shrink-0">{m.by}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Two endings, because they mean different things. A handover
                keeps the shop trading: the till is counted and the same cash
                becomes the next session's float. Closing ends the day. */}
            <button type="button"
              onClick={async () => {
                if (!(await ui.confirm('Count the drawer and hand it over? The session is closed and counted, and a new one opens straight away with the cash you count as its float.'))) return;
                openShiftEndFromDrawer(true);
              }}
              className="w-full bg-brand text-on-brand font-black py-3 rounded-xl uppercase tracking-widest text-xs hover:bg-brand-dark transition">
              Count and hand over
            </button>
            <button type="button"
              onClick={async () => {
                if (!(await ui.confirm('Close the drawer for the day? Nobody will be able to ring cash sales until someone opens a new session with a fresh float.'))) return;
                openShiftEndFromDrawer(false);
              }}
              className="w-full border border-white/15 text-fg/70 hover:text-fg hover:bg-white/5 font-black py-3 rounded-xl uppercase tracking-widest text-xs transition">
              Close drawer for the day
            </button>
            <p className="text-[10px] text-fg/60 text-center leading-snug -mt-1">
              Logging out does not close the drawer. Hand over at a changeover; close only when the till is done for the day.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
