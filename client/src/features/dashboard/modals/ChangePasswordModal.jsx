import { useDashboard } from '../../dashboard/DashboardContext';

// Extracted from AdminDashboard. Reads shared dashboard state via
// useDashboard() rather than props - see DashboardContext.
export default function ChangePasswordModal() {
  const { changePwError, changePwForm, changePwLoading, changePwModal, handleChangePassword, setChangePwError, setChangePwForm, setChangePwModal } = useDashboard();

  if (!(changePwModal)) return null;

  return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-fade-in">
        <div className="bg-surface border border-gray-700 rounded-2xl shadow-2xl max-w-sm w-full p-6 flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-black text-fg uppercase tracking-wider">Change Password</h2>
            <button onClick={() => { setChangePwModal(false); setChangePwError(''); setChangePwForm({ currentPassword: '', newPassword: '', confirmPassword: '' }); }}
              className="text-gray-500 hover:text-fg text-xl font-bold">✕</button>
          </div>
          {changePwError && (
            <div className="bg-red-900/30 border border-red-500/40 rounded-xl px-4 py-3 text-xs text-red-300 font-bold">{changePwError}</div>
          )}
          {[
            ['Current Password', 'currentPassword', 'Your existing password'],
            ['New Password', 'newPassword', 'Minimum 6 characters'],
            ['Confirm New Password', 'confirmPassword', 'Repeat the new password'],
          ].map(([label, field, hint]) => (
            <div key={field}>
              <label className="text-[10px] text-gray-400 font-bold uppercase block mb-1">{label}</label>
              <input type="password" value={changePwForm[field]}
                onChange={e => setChangePwForm(p => ({ ...p, [field]: e.target.value }))}
                placeholder={hint}
                className="w-full bg-page-bg border border-gray-700 rounded-xl px-3 py-2.5 text-fg outline-none focus:border-brand/60 placeholder-white/20 text-sm"
              />
            </div>
          ))}
          <button onClick={handleChangePassword} disabled={changePwLoading}
            className="w-full py-3 bg-brand text-white font-black rounded-xl uppercase tracking-widest text-sm hover:bg-brand/90 transition disabled:opacity-50">
            {changePwLoading ? 'Saving…' : 'Update Password'}
          </button>
        </div>
      </div>
  );
}
