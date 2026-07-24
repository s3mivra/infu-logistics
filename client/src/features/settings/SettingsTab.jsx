import React from 'react';
import { SlidersHorizontal, QrCode, Clock, Image as ImageIcon, KeyRound, Building2, ShieldCheck, Lock } from 'lucide-react';

// ── SettingsTab — system preferences & account controls ───────────────────────
// Houses the toggles that used to live crammed in the sidebar's "Tools" dropdown
// (QR Orders, Auto-Close, Product Images) as proper labelled setting rows, plus
// account actions (change password) and read-only business info.
//
// Self-contained: pulls only what it needs from ctx.

const BUSINESS_TYPE = import.meta.env.VITE_BUSINESS_TYPE || 'fb';

// Reusable iOS-style toggle switch.
function Toggle({ on, onChange, disabled }) {
  return (
    <button role="switch" aria-checked={on} disabled={disabled} onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-40 ${on ? 'bg-brand' : 'bg-white/15'}`}>
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

function SettingRow({ icon: Icon, title, desc, children, tone = 'default' }) {
  const iconTone = tone === 'default' ? 'text-brand bg-brand/15 border-brand/30' : 'text-white/50 bg-white/5 border-white/10';
  return (
    <div className="flex items-center gap-4 px-4 py-4">
      <div className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${iconTone}`}>
        <Icon size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-white text-sm">{title}</p>
        {desc && <p className="text-white/40 text-xs mt-0.5 leading-snug">{desc}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div>
      <p className="text-[11px] font-black uppercase tracking-wider text-white/30 mb-2 px-1">{title}</p>
      <div className="bg-white/5 border border-white/10 rounded-2xl divide-y divide-white/5">{children}</div>
    </div>
  );
}

export default function SettingsTab({ ctx }) {
  const {
    systemSettings = {}, toggleQROrders, toggleAutoClose, toggleImages,
    isSuperAdmin, setChangePwModal, setChangePwError, BIZ_NAME, activeAdmin,
  } = ctx;

  const qrOn    = systemSettings.isAcceptingQROrders !== false;
  const autoOn  = systemSettings.autoCloseEnabled !== false;
  const imgOn   = systemSettings.imagesEnabled !== false;

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-brand/15 border border-brand/30 flex items-center justify-center">
          <SlidersHorizontal size={19} className="text-brand" />
        </div>
        <div>
          <h1 className="text-xl font-black text-white leading-none">Settings</h1>
          <p className="text-white/40 text-xs font-bold mt-1">System preferences &amp; account</p>
        </div>
      </div>

      <div className="space-y-6">
        {/* System toggles — superadmin only */}
        {isSuperAdmin ? (
          <Card title="System">
            {BUSINESS_TYPE !== 'log' && (
              <SettingRow icon={QrCode} title="QR Orders"
                desc={qrOn ? 'Customers can place orders by scanning the table QR.' : 'QR ordering is closed; scans are rejected.'}>
                <Toggle on={qrOn} onChange={toggleQROrders} />
              </SettingRow>
            )}
            <SettingRow icon={Clock} title="Automatic Midnight Close"
              desc={autoOn ? 'The day auto-closes & archives at midnight.' : 'Manual close required; the day stays open past midnight.'}>
              <Toggle on={autoOn} onChange={toggleAutoClose} />
            </SettingRow>
            <SettingRow icon={ImageIcon} title="Product Images"
              desc={imgOn ? 'Product images show across the menu, portal & lists.' : 'Images are hidden app-wide (faster, text-only).'}>
              <Toggle on={imgOn} onChange={toggleImages} />
            </SettingRow>
          </Card>
        ) : (
          <Card title="System">
            <div className="flex items-center gap-3 px-4 py-5 text-white/40">
              <Lock size={15} />
              <span className="text-sm font-bold">System toggles are superadmin-only.</span>
            </div>
          </Card>
        )}

        {/* Account */}
        <Card title="Account">
          <SettingRow icon={KeyRound} title="Password" desc="Change the password for your account." tone="muted">
            <button onClick={() => { setChangePwError?.(''); setChangePwModal?.(true); }}
              className="text-sm font-bold px-4 py-2 rounded-xl bg-white/5 text-white/70 hover:bg-white/10 hover:text-white transition">
              Change
            </button>
          </SettingRow>
        </Card>

        {/* Business info (read-only) */}
        <Card title="Business">
          <SettingRow icon={Building2} title={BIZ_NAME || 'Business'} desc={`Mode: ${BUSINESS_TYPE === 'log' ? 'Logistics' : 'Food & Beverage'} · Non-VAT registered`} tone="muted">
            <span className="text-[10px] font-black uppercase tracking-widest bg-brand/15 border border-brand/30 text-brand px-2 py-1 rounded-full">
              {BUSINESS_TYPE.toUpperCase()}
            </span>
          </SettingRow>
          <SettingRow icon={ShieldCheck} title="Signed in as" desc={`${activeAdmin?.name || '-'} · ${activeAdmin?.role || '-'}`} tone="muted">
            <span />
          </SettingRow>
        </Card>
      </div>
    </div>
  );
}
