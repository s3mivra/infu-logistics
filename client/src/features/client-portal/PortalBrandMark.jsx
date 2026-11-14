import { useEffect, useState } from 'react';
import { Package } from 'lucide-react';
import { API_URL } from '../../shared/apiBase.js';

// The business's logo (Settings -> logo upload) at the top of the client's
// sign-in and finish-setup pages, as the portal itself shows it; the package
// icon until a logo is uploaded. Read from the public portal settings - these
// pages are seen before the client signs in.
let cached = null;
const loadLogo = () => {
  if (!cached) {
    cached = fetch(`${API_URL}/api/public/portal-settings`)
      .then((r) => r.json())
      .then((d) => (d?.success ? d.settings?.businessLogo || '' : ''))
      .catch(() => { cached = null; return ''; });
  }
  return cached;
};

export default function PortalBrandMark({ name = '' }) {
  const [logo, setLogo] = useState('');
  useEffect(() => {
    let alive = true;
    loadLogo().then((l) => { if (alive) setLogo(l); });
    return () => { alive = false; };
  }, []);
  if (logo) {
    return <img src={logo} alt={name ? `${name} logo` : 'Logo'} className="w-16 h-16 rounded-2xl object-contain bg-white/5 mb-4" />;
  }
  return (
    <div className="w-14 h-14 rounded-2xl bg-brand/20 flex items-center justify-center mb-4">
      <Package size={26} className="text-brand-text" />
    </div>
  );
}
