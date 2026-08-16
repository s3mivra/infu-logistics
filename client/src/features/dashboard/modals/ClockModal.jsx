import { Coffee, LogOut } from 'lucide-react';
import { useDashboard } from '../../dashboard/DashboardContext';

// Extracted from AdminDashboard. Reads shared dashboard state via
// useDashboard() rather than props - see DashboardContext.
export default function ClockModal() {
  const { clockModalOpen, clockStatus, handleClockOut, setClockModalOpen, startBreak } = useDashboard();

  if (!(clockModalOpen)) return null;

  return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-fade-in">
        <div className="bg-surface border border-gray-700 rounded-2xl shadow-2xl max-w-sm w-full p-6 flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-lg font-black text-fg uppercase tracking-wider">End Shift or Break?</h2>
              <p className="text-xs text-gray-400 mt-0.5">Break used: {clockStatus.breakUsedMinutes || 0}m of 60m</p>
            </div>
            <button onClick={() => setClockModalOpen(false)} className="text-gray-500 hover:text-fg text-xl font-bold">✕</button>
          </div>

          {/* Take a break - disabled once the 1-hour break is used up */}
          {(clockStatus.breakRemainingMinutes ?? 60) > 0 ? (
            <button onClick={startBreak}
              className="w-full py-3 bg-amber-500 border border-amber-500 text-white font-black rounded-xl uppercase tracking-wider text-sm hover:bg-amber-500/80 transition flex items-center justify-center gap-2">
              <Coffee size={16} /> Take a Break ({clockStatus.breakRemainingMinutes ?? 60}m left)
            </button>
          ) : (
            <div className="w-full py-3 bg-white/5 border border-white/10 text-fg/30 font-bold rounded-xl text-xs text-center">
              Break used up - 1-hour break already taken
            </div>
          )}

          <button onClick={handleClockOut}
            className="w-full py-3 bg-red-600 text-white font-black rounded-xl uppercase tracking-widest text-sm hover:bg-red-500 transition flex items-center justify-center gap-2">
            <LogOut size={16} /> End Shift (Clock Out)
          </button>
          <button onClick={() => setClockModalOpen(false)}
            className="w-full py-2 bg-surface-2 border border-white/10 text-fg/50 font-bold rounded-xl text-xs uppercase hover:text-fg transition">
            Cancel
          </button>
        </div>
      </div>
  );
}
