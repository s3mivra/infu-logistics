import React, { useState } from 'react';
import { SlidersHorizontal, QrCode, Clock, Image as ImageIcon, KeyRound, Building2, ShieldCheck, Lock, CreditCard, Palette, Languages, Package, MessageSquare, Tag, FileText, Printer, Receipt, Type } from 'lucide-react';
import { readPrinterMode, writePrinterMode } from '../../shared/escpos';

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
  const iconTone = tone === 'default' ? 'text-brand bg-brand/15 border-brand/30' : 'text-fg/50 bg-white/5 border-white/10';
  return (
    <div className="flex items-center gap-4 px-4 py-4">
      <div className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${iconTone}`}>
        <Icon size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-fg text-sm">{title}</p>
        {desc && <p className="text-fg/40 text-xs mt-0.5 leading-snug">{desc}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div>
      <p className="text-[11px] font-black uppercase tracking-wider text-fg/30 mb-2 px-1">{title}</p>
      <div className="bg-white/5 border border-white/10 rounded-2xl divide-y divide-white/5">{children}</div>
    </div>
  );
}

// How credit limits are applied across the business. Mirrors CREDIT_MODES on
// the server — the server is authoritative and rejects anything else.
const CREDIT_MODES = [
  { value: 'off',        label: 'No limits',        desc: 'Clients can buy on account without restriction.' },
  { value: 'per_client', label: 'Per client',       desc: 'Only clients with their own limit are restricted.' },
  { value: 'global',     label: 'Same for all',     desc: 'One limit applies to every client.' },
  { value: 'both',       label: 'Both',             desc: 'A shared default, overridden by a client’s own limit.' },
];

// Appearance is a per-device preference (localStorage), not a business setting —
// one shop can run a dark register and a light warehouse tablet.
const THEMES = [
  { value: 'default', label: 'Forest',  hint: 'Dark charcoal + olive' },
  { value: 'light',   label: 'Light',   hint: 'Off-white, for bright rooms' },
  { value: 'yellow',  label: 'Amber',   hint: 'Dark + high-vis yellow' },
  { value: 'ocean',   label: 'Ocean',   hint: 'Dark + electric blue' },
];

const readTheme = () => {
  try { return localStorage.getItem('dash.theme') || import.meta.env.VITE_THEME || 'default'; }
  catch { return 'default'; }
};

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'fil', label: 'Taglish' },
];

// Free-text setting: saves on blur so we don't PATCH on every keystroke.
// `defaultValue` + a key tied to the stored value keeps it uncontrolled while
// still picking up an external refresh after save.
function TextSetting({ label, hint, value, onSave, placeholder, multiline, maxLength = 400 }) {
  const common = {
    defaultValue: value ?? '',
    placeholder,
    maxLength,
    onBlur: e => {
      const next = e.target.value.trim();
      if (next !== String(value ?? '')) onSave(next);
    },
    className: 'w-full bg-white/5 border border-white/10 focus:border-brand text-fg placeholder-white/20 px-3 py-2.5 rounded-xl outline-none transition text-sm',
  };
  return (
    <div>
      <label className="text-[10px] font-bold text-fg/40 uppercase tracking-widest block mb-1.5">{label}</label>
      {multiline
        ? <textarea key={String(value ?? '')} rows={2} {...common} className={`${common.className} resize-none`} />
        : <input key={String(value ?? '')} type="text" {...common} />}
      {hint && <p className="text-[10px] text-fg/40 mt-1 leading-snug">{hint}</p>}
    </div>
  );
}

const readLang = () => {
  try { return localStorage.getItem('dash.lang') || 'en'; } catch { return 'en'; }
};

// App-wide text size, per device. Value is a percent of the 16px base; because
// the whole app is rem-based, scaling the root font-size scales text + spacing
// together. Kept in sync with the boot-time apply in App.jsx.
const FONT_SIZES = [
  { value: 90, label: 'Small' },
  { value: 100, label: 'Normal' },
  { value: 110, label: 'Large' },
  { value: 125, label: 'X-Large' },
];
const readFontScale = () => {
  try { return Number(localStorage.getItem('dash.fontScale')) || 100; } catch { return 100; }
};

export default function SettingsTab({ ctx }) {
  const {
    systemSettings = {}, toggleQROrders, toggleAutoClose, toggleImages,
    isSuperAdmin, setChangePwModal, setChangePwError, BIZ_NAME, activeAdmin,
    saveSetting,
  } = ctx;

  const qrOn    = systemSettings.isAcceptingQROrders !== false;
  const autoOn  = systemSettings.autoCloseEnabled !== false;
  const imgOn   = systemSettings.imagesEnabled !== false;

  const [theme, setTheme] = useState(readTheme);
  const [lang, setLang] = useState(readLang);
  const [fontScale, setFontScale] = useState(readFontScale);
  const applyFontScale = (v) => {
    setFontScale(v);
    document.documentElement.style.fontSize = (16 * v / 100) + 'px';
    try { localStorage.setItem('dash.fontScale', String(v)); } catch { /* private mode: applies for this session only */ }
  };

  // Business logo — stored as a base64 data-URL in the businessLogo setting
  // (same approach as product images). Resized to 300px webp so the payload
  // stays small. Shown on the sidebar, login, receipts, menu and portal.
  const [logoBusy, setLogoBusy] = useState(false);
  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoBusy(true);
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (ev) => {
      const img = new Image();
      img.src = ev.target.result;
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        const scale = 300 / img.width;
        canvas.width = 300; canvas.height = img.height * scale;
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        await saveSetting('businessLogo', canvas.toDataURL('image/webp', 0.85));
        setLogoBusy(false);
      };
      img.onerror = () => setLogoBusy(false);
    };
    reader.onerror = () => setLogoBusy(false);
  };
  const removeLogo = () => saveSetting('businessLogo', '');
  const currentLogo = systemSettings.businessLogo || '';
  const [printerMode, setPrinterMode] = useState(readPrinterMode);
  const applyPrinterMode = (v) => { setPrinterMode(v); writePrinterMode(v); };

  const applyTheme = (v) => {
    setTheme(v);
    document.documentElement.setAttribute('data-theme', v);
    try { localStorage.setItem('dash.theme', v); } catch { /* private mode: applies for this session only */ }
  };
  const applyLang = (v) => {
    setLang(v);
    try { localStorage.setItem('dash.lang', v); } catch { /* as above */ }
  };

  // Defaults match the portal's own fallbacks: prices stay hidden unless
  // explicitly enabled (log pricing is confirmed by staff), notes stay on.
  const portalShowPrices = systemSettings.portalShowPrices === true;
  const portalAllowNotes = systemSettings.portalAllowNotes !== false;

  const creditMode = systemSettings.creditLimitMode || 'off';
  const globalLimit = systemSettings.globalCreditLimit ?? '';
  const usesGlobal = creditMode === 'global' || creditMode === 'both';

  // VAT. Off by default so an untouched system keeps behaving as a non-VAT
  // (percentage-tax) business, which is what every existing install is.
  const vatOn = systemSettings.vatEnabled === true;
  const vatRate = systemSettings.vatRate ?? 12;
  const scPwdOrder = systemSettings.scPwdOrder === 'discount-first' ? 'discount-first' : 'vat-first';
  // Default inclusive — Philippine retail convention, and how every order booked
  // before this option existed was priced.
  const vatInclusive = systemSettings.vatInclusive !== false;

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-brand/15 border border-brand/30 flex items-center justify-center">
          <SlidersHorizontal size={19} className="text-brand" />
        </div>
        <div>
          <h1 className="text-xl font-black text-fg leading-none">Settings</h1>
          <p className="text-fg/60 text-xs font-bold mt-1">System preferences &amp; account</p>
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
            <div className="flex items-center gap-3 px-4 py-5 text-fg/60">
              <Lock size={15} />
              <span className="text-sm font-bold">System toggles are superadmin-only.</span>
            </div>
          </Card>
        )}

        {/* Branding — business logo, shown on sidebar, login, receipts, menu & portal. */}
        {isSuperAdmin && (
          <Card title="Branding">
            <div className="px-4 py-4">
              <div className="flex items-start gap-4">
                <div className="w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 text-brand bg-brand/15 border-brand/30">
                  <ImageIcon size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-fg text-sm">Business Logo</p>
                  <p className="text-fg/40 text-xs mt-0.5 leading-snug">
                    Shown on the sidebar, login screen, printed receipts, the menu and the client portal. PNG or JPG; it's resized automatically.
                  </p>
                  <div className="flex items-center gap-4 mt-3 flex-wrap">
                    <div className="w-20 h-20 rounded-xl border border-white/10 bg-white/5 flex items-center justify-center overflow-hidden shrink-0">
                      {currentLogo
                        ? <img src={currentLogo} alt="Logo" className="max-w-full max-h-full object-contain" />
                        : <ImageIcon size={22} className="text-fg/20" />}
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider bg-brand text-white hover:bg-brand/90 transition min-h-[40px]">
                        {logoBusy ? 'Uploading…' : (currentLogo ? 'Replace Logo' : 'Upload Logo')}
                        <input type="file" accept="image/*" className="hidden" disabled={logoBusy} onChange={handleLogoUpload} />
                      </label>
                      {currentLogo && (
                        <button onClick={removeLogo} className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-white/5 text-fg/50 border border-white/10 hover:text-red-400 hover:border-red-400/40 transition min-h-[38px]">
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Credit limits — superadmin only, and only meaningful where clients
            buy on account. */}
        {isSuperAdmin && (
          <Card title="VAT">
            <div className="px-4 py-4">
              <div className="flex items-start gap-4">
                <div className="w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 text-brand bg-brand/15 border-brand/30">
                  <Receipt size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-bold text-fg text-sm">VAT-registered</p>
                      <p className="text-fg/60 text-xs mt-0.5 leading-snug">
                        {vatOn
                          ? 'Receipts break out output VAT. The 3% percentage-tax report is switched off — a VAT-registered business does not owe it.'
                          : 'Non-VAT. Sales are reported under the 3% percentage tax.'}
                      </p>
                    </div>
                    <Toggle on={vatOn} onChange={() => saveSetting?.('vatEnabled', !vatOn)} />
                  </div>

                  {vatOn && (
                    <>
                      <div className="mt-4">
                        <label className="text-[10px] font-bold text-fg/40 uppercase tracking-widest block mb-1.5">
                          VAT rate (%)
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          defaultValue={vatRate}
                          onBlur={e => {
                            const n = Number(String(e.target.value).replace(/[\s%]/g, ''));
                            // Reject garbage rather than writing it — the server
                            // would fall back to 12% anyway, and a field showing
                            // an impossible rate is worse than one that resets.
                            if (!Number.isFinite(n) || n < 0 || n >= 100) { e.target.value = vatRate; return; }
                            saveSetting?.('vatRate', n);
                          }}
                          placeholder="12"
                          className="w-full bg-white/5 border border-white/10 focus:border-brand text-fg placeholder-white/20 px-4 py-3 rounded-xl outline-none transition text-sm tabular-nums"
                        />
                        <p className="text-[10px] text-fg/60 mt-1.5">
                          Standard Philippine VAT is 12%.
                        </p>
                      </div>

                      <div className="mt-4">
                        <label className="text-[10px] font-bold text-fg/40 uppercase tracking-widest block mb-1.5">
                          Price basis
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { v: true, label: 'VAT-inclusive' },
                            { v: false, label: 'VAT-exclusive' },
                          ].map(opt => (
                            <button key={String(opt.v)}
                              onClick={() => saveSetting?.('vatInclusive', opt.v)}
                              className={`px-3 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider border transition ${
                                vatInclusive === opt.v
                                  ? 'bg-brand text-white border-brand'
                                  : 'bg-white/5 text-fg/60 border-white/10 hover:text-fg hover:bg-white/10'
                              }`}>
                              {opt.label}
                            </button>
                          ))}
                        </div>
                        <p className="text-[10px] text-fg/60 mt-1.5 leading-relaxed">
                          {vatInclusive
                            ? 'Listed prices already contain VAT. A ₱112 item stays ₱112 — the receipt just breaks out the ₱12 VAT inside it. Standard for Philippine retail.'
                            : 'Listed prices are net; VAT is added on top. A ₱100 item rings up at ₱112. Common in B2B quoting.'}
                          {' '}Switching this re-prices open orders.
                        </p>
                      </div>

                      {/* SC/PWD ordering only bites under inclusive pricing — with
                          exclusive prices there is no embedded VAT to sequence the
                          discount against, so the choice would do nothing. */}
                      {vatInclusive && (
                        <div className="mt-4">
                          <label className="text-[10px] font-bold text-fg/40 uppercase tracking-widest block mb-1.5">
                            SC/PWD calculation
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            {[
                              { v: 'vat-first', label: 'VAT first' },
                              { v: 'discount-first', label: 'Discount first' },
                            ].map(opt => (
                              <button key={opt.v}
                                onClick={() => saveSetting?.('scPwdOrder', opt.v)}
                                className={`px-3 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider border transition ${
                                  scPwdOrder === opt.v
                                    ? 'bg-brand text-white border-brand'
                                    : 'bg-white/5 text-fg/60 border-white/10 hover:text-fg hover:bg-white/10'
                                }`}>
                                {opt.label}
                              </button>
                            ))}
                          </div>
                          <p className="text-[10px] text-fg/60 mt-1.5 leading-relaxed">
                            {scPwdOrder === 'vat-first'
                              ? 'Strip the VAT, then apply the discount to the VAT-less amount. This is the BIR treatment.'
                              : 'Apply the discount to the VAT-inclusive price, then strip the VAT from what remains.'}
                            {' '}For percentage discounts both give the same total and differ only in the discount
                            shown on the receipt; for flat peso discounts the totals genuinely differ.
                          </p>
                        </div>
                      )}
                    </>
                  )}

                  <p className="text-[10px] text-fg/60 mt-3 leading-relaxed">
                    Changing this affects <span className="text-fg/80 font-bold">new orders only</span>.
                    Receipts already issued keep the rate they were rung up under.
                  </p>
                </div>
              </div>
            </div>
          </Card>
        )}

        {isSuperAdmin && (
          <Card title="Credit Limits">
            <div className="px-4 py-4">
              <div className="flex items-start gap-4">
                <div className="w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 text-brand bg-brand/15 border-brand/30">
                  <CreditCard size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-fg text-sm">How limits apply</p>
                  <p className="text-fg/60 text-xs mt-0.5 leading-snug">
                    {CREDIT_MODES.find(m => m.value === creditMode)?.desc}
                  </p>
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    {CREDIT_MODES.map(m => (
                      <button key={m.value}
                        onClick={() => saveSetting?.('creditLimitMode', m.value)}
                        className={`px-3 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider border transition ${
                          creditMode === m.value
                            ? 'bg-brand text-white border-brand'
                            : 'bg-white/5 text-fg/60 border-white/10 hover:text-fg hover:bg-white/10'
                        }`}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                  {usesGlobal && (
                    <div className="mt-4">
                      <label className="text-[10px] font-bold text-fg/40 uppercase tracking-widest block mb-1.5">
                        Limit for all clients (₱)
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        defaultValue={globalLimit}
                        onBlur={e => saveSetting?.('globalCreditLimit', e.target.value === '' ? null : Number(String(e.target.value).replace(/[,\s₱]/g, '')))}
                        placeholder="e.g. 50000"
                        className="w-full bg-white/5 border border-white/10 focus:border-brand text-fg placeholder-white/20 px-4 py-3 rounded-xl outline-none transition text-sm tabular-nums"
                      />
                      <p className="text-[10px] text-fg/60 mt-1.5">
                        Applies to every client{creditMode === 'both' ? ' that has no limit of its own' : ''}.
                        Blank = no shared limit.
                      </p>
                    </div>
                  )}
                  <p className="text-[10px] text-fg/60 mt-3 leading-relaxed">
                    Only <span className="text-fg/80 font-bold">on-account</span> (non-cash) orders use credit.
                    Cash sales settle immediately and are never blocked.
                  </p>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Client Portal — copy & branding shown to logged-in clients and on the
            order slip. Superadmin-only, and only meaningful in logistics mode
            (the portal is a log-only surface). Read publicly by the portal via
            /api/public/portal-settings, so keep operational settings out. */}
        {isSuperAdmin && BUSINESS_TYPE === 'log' && (
          <Card title="Client Portal">
            <SettingRow icon={Tag} title="Show Prices"
              desc={portalShowPrices
                ? 'Clients see each product’s price and a running cart total.'
                : 'Prices are hidden; the portal shows “Inquire price” and staff confirm the total.'}>
              <Toggle on={portalShowPrices} onChange={() => saveSetting?.('portalShowPrices', !portalShowPrices)} />
            </SettingRow>

            <SettingRow icon={MessageSquare} title="Order Notes"
              desc={portalAllowNotes
                ? 'Clients can attach notes/special instructions to an order.'
                : 'The notes box is hidden from the checkout drawer.'}>
              <Toggle on={portalAllowNotes} onChange={() => saveSetting?.('portalAllowNotes', !portalAllowNotes)} />
            </SettingRow>

            {/* Welcome & announcements */}
            <div className="flex items-start gap-4 px-4 py-4">
              <div className="w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 text-brand bg-brand/15 border-brand/30">
                <Package size={16} />
              </div>
              <div className="flex-1 min-w-0 space-y-3">
                <div>
                  <p className="font-bold text-fg text-sm">Welcome &amp; Announcements</p>
                  <p className="text-fg/40 text-xs mt-0.5 leading-snug">Shown at the top of the portal after a client signs in.</p>
                </div>
                <TextSetting label="Welcome title" value={systemSettings.portalWelcomeTitle}
                  placeholder="e.g. Welcome back" maxLength={60}
                  onSave={v => saveSetting?.('portalWelcomeTitle', v)} />
                <TextSetting label="Welcome message" value={systemSettings.portalWelcomeMessage} multiline
                  placeholder="e.g. Browse the catalogue and send us your order — we’ll confirm pricing on Messenger."
                  onSave={v => saveSetting?.('portalWelcomeMessage', v)} />
                <TextSetting label="Announcement banner" value={systemSettings.portalAnnouncement} multiline
                  hint="Highlighted notice, e.g. holiday cut-off dates. Leave blank to hide."
                  placeholder="e.g. Cut-off for Dec 24 deliveries is Dec 20, 5PM."
                  onSave={v => saveSetting?.('portalAnnouncement', v)} />
              </div>
            </div>

            {/* Support & payment */}
            <div className="flex items-start gap-4 px-4 py-4">
              <div className="w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 text-brand bg-brand/15 border-brand/30">
                <MessageSquare size={16} />
              </div>
              <div className="flex-1 min-w-0 space-y-3">
                <div>
                  <p className="font-bold text-fg text-sm">Support &amp; Payment</p>
                  <p className="text-fg/40 text-xs mt-0.5 leading-snug">Where clients send payment proof and reach you. Overrides VITE_FB_LINK.</p>
                </div>
                <TextSetting label="Support link" value={systemSettings.portalSupportLink}
                  placeholder="https://m.me/yourpage" maxLength={300}
                  onSave={v => saveSetting?.('portalSupportLink', v)} />
                <TextSetting label="Support button label" value={systemSettings.portalSupportLabel}
                  placeholder="Send payment proof" maxLength={40}
                  onSave={v => saveSetting?.('portalSupportLabel', v)} />
                <TextSetting label="Payment instructions" value={systemSettings.portalPaymentInstructions} multiline
                  hint="Shown in the checkout drawer and on the success screen."
                  placeholder="e.g. GCash 0917-000-0000 (Juan D.). Send the receipt on Messenger."
                  onSave={v => saveSetting?.('portalPaymentInstructions', v)} />
              </div>
            </div>

            {/* Order slip letterhead */}
            <div className="flex items-start gap-4 px-4 py-4">
              <div className="w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 text-brand bg-brand/15 border-brand/30">
                <FileText size={16} />
              </div>
              <div className="flex-1 min-w-0 space-y-3">
                <div>
                  <p className="font-bold text-fg text-sm">Order Slip Letterhead</p>
                  <p className="text-fg/40 text-xs mt-0.5 leading-snug">Printed at the top of the client’s order slip and its PDF.</p>
                </div>
                <TextSetting label="Company name" value={systemSettings.portalCompanyName}
                  placeholder={BIZ_NAME} maxLength={80}
                  onSave={v => saveSetting?.('portalCompanyName', v)} />
                <TextSetting label="Address" value={systemSettings.portalCompanyAddress} multiline
                  placeholder="e.g. 123 Warehouse Rd, Cebu City" maxLength={160}
                  onSave={v => saveSetting?.('portalCompanyAddress', v)} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <TextSetting label="Phone" value={systemSettings.portalCompanyPhone}
                    placeholder="+63 917 000 0000" maxLength={40}
                    onSave={v => saveSetting?.('portalCompanyPhone', v)} />
                  <TextSetting label="Email" value={systemSettings.portalCompanyEmail}
                    placeholder="orders@example.com" maxLength={80}
                    onSave={v => saveSetting?.('portalCompanyEmail', v)} />
                </div>
                <TextSetting label="Slip footer / terms" value={systemSettings.portalSlipFooter} multiline
                  hint="Leave blank to use the default “final total is confirmed by our team” note."
                  placeholder="e.g. Goods remain our property until paid in full."
                  onSave={v => saveSetting?.('portalSlipFooter', v)} />
              </div>
            </div>
          </Card>
        )}

        {/* Printer Settings — superadmin only. Log prints an ORIGINAL + DUPLICATE
            A4 document on order payment (format & paper size below). fb prints a
            single thermal receipt by default (fast food / bar / restaurant);
            the duplicate copy is optional and off unless toggled on. */}
        {isSuperAdmin && (
          <Card title="Printer Settings">
            {BUSINESS_TYPE === 'log' ? (
              <div className="flex items-start gap-4 px-4 py-4">
                <div className="w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 text-brand bg-brand/15 border-brand/30">
                  <Printer size={16} />
                </div>
                <div className="flex-1 min-w-0 space-y-3">
                  <div>
                    <p className="font-bold text-fg text-sm">Receipt format &amp; paper</p>
                    <p className="text-fg/40 text-xs mt-0.5 leading-snug">What prints when an order is paid, and on what paper. The A4 document always prints an original and a duplicate.</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-fg/60 mb-1.5">Receipt format</p>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { v: 'billing', label: 'Billing / A4' },
                        { v: 'thermal', label: 'Thermal 80mm' },
                        { v: 'both', label: 'Both' },
                      ].map(opt => {
                        const active = (systemSettings.logReceiptFormat || 'billing') === opt.v;
                        return (
                          <button key={opt.v} onClick={() => saveSetting?.('logReceiptFormat', opt.v)}
                            className={`px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wider border transition ${
                              active ? 'bg-brand text-white border-brand' : 'bg-white/5 text-fg/50 border-white/10 hover:text-fg hover:bg-white/10'
                            }`}>
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-fg/60 mb-1.5">Print size (A4 document)</p>
                    <div className="grid grid-cols-4 gap-2">
                      {['A4', 'Letter', 'Legal', 'A5'].map(sz => {
                        const active = (systemSettings.portalPrintSize || 'A4') === sz;
                        return (
                          <button key={sz} onClick={() => saveSetting?.('portalPrintSize', sz)}
                            className={`px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wider border transition ${
                              active ? 'bg-brand text-white border-brand' : 'bg-white/5 text-fg/50 border-white/10 hover:text-fg hover:bg-white/10'
                            }`}>
                            {sz}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <SettingRow icon={Printer} title="Duplicate Copy"
                desc={systemSettings.fbDuplicateReceipt === true
                  ? 'Each receipt prints twice — an original and a duplicate.'
                  : 'A single receipt prints per order (typical for fast food, bars & restaurants).'}>
                <Toggle on={systemSettings.fbDuplicateReceipt === true} onChange={() => saveSetting?.('fbDuplicateReceipt', !(systemSettings.fbDuplicateReceipt === true))} />
              </SettingRow>
            )}
          </Card>
        )}

        {/* Appearance & language — per device, so every role can set their own. */}
        <Card title="This Device">
          <div className="px-4 py-4">
            <div className="flex items-start gap-4">
              <div className="w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 text-brand bg-brand/15 border-brand/30">
                <Palette size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-fg text-sm">Appearance</p>
                <p className="text-fg/40 text-xs mt-0.5 leading-snug">
                  {THEMES.find(t => t.value === theme)?.hint} · saved on this device only
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                  {THEMES.map(t => (
                    <button key={t.value} onClick={() => applyTheme(t.value)}
                      className={`px-3 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider border transition ${
                        theme === t.value
                          ? 'bg-brand text-white border-brand'
                          : 'bg-white/5 text-fg/50 border-white/10 hover:text-fg hover:bg-white/10'
                      }`}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="px-4 py-4">
            <div className="flex items-start gap-4">
              <div className="w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 text-fg/50 bg-white/5 border-white/10">
                <Type size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-fg text-sm">Text Size</p>
                <p className="text-fg/40 text-xs mt-0.5 leading-snug">
                  Scales the whole app — bigger is easier to read on a tablet at arm's length. Saved on this device only.
                </p>
                <div className="grid grid-cols-4 gap-2 mt-3 max-w-md">
                  {FONT_SIZES.map(s => (
                    <button key={s.value} onClick={() => applyFontScale(s.value)}
                      className={`px-2 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider border transition ${
                        fontScale === s.value
                          ? 'bg-brand text-white border-brand'
                          : 'bg-white/5 text-fg/50 border-white/10 hover:text-fg hover:bg-white/10'
                      }`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="px-4 py-4">
            <div className="flex items-start gap-4">
              <div className="w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 text-fg/50 bg-white/5 border-white/10">
                <Languages size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-fg text-sm">Language</p>
                <p className="text-fg/40 text-xs mt-0.5 leading-snug">
                  Interface language for this device.
                </p>
                <div className="grid grid-cols-2 gap-2 mt-3 max-w-xs">
                  {LANGUAGES.map(l => (
                    <button key={l.value} onClick={() => applyLang(l.value)}
                      className={`px-3 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider border transition ${
                        lang === l.value
                          ? 'bg-brand text-white border-brand'
                          : 'bg-white/5 text-fg/50 border-white/10 hover:text-fg hover:bg-white/10'
                      }`}>
                      {l.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-fg/60 mt-2 leading-relaxed">
                  Your choice is saved, but most screens are still English-only —
                  translations are being added screen by screen.
                </p>
              </div>
            </div>
          </div>

          <div className="px-4 py-4">
            <div className="flex items-start gap-4">
              <div className="w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 text-fg/50 bg-white/5 border-white/10">
                <Printer size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-fg text-sm">Receipt Printing</p>
                <p className="text-fg/40 text-xs mt-0.5 leading-snug">
                  {printerMode === 'browser'
                    ? 'Always uses the browser print dialog — this device never probes for a paired Bluetooth/USB thermal printer.'
                    : 'Tries a paired Bluetooth or USB thermal printer first, falling back to the browser print dialog. Saved on this device only.'}
                </p>
                <div className="grid grid-cols-2 gap-2 mt-3 max-w-xs">
                  {[['auto', 'Auto (Thermal)'], ['browser', 'Browser Only']].map(([v, label]) => (
                    <button key={v} onClick={() => applyPrinterMode(v)}
                      className={`px-3 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider border transition ${
                        printerMode === v
                          ? 'bg-brand text-white border-brand'
                          : 'bg-white/5 text-fg/50 border-white/10 hover:text-fg hover:bg-white/10'
                      }`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Account */}
        <Card title="Account">
          <SettingRow icon={KeyRound} title="Password" desc="Change the password for your account." tone="muted">
            <button onClick={() => { setChangePwError?.(''); setChangePwModal?.(true); }}
              className="text-sm font-bold px-4 py-2 rounded-xl bg-white/5 text-fg/70 hover:bg-white/10 hover:text-fg transition">
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
