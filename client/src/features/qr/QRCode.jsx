import React from 'react';
import { QRCode as QR } from 'react-qr-code';

// Drawn in the browser - the link is never sent to a third-party QR service.
export default function QRCode({ url, size = 200 }) {
  const value = url || new URLSearchParams(window.location.search).get('url') || window.location.origin;

  return (
    <div className="flex flex-col items-center justify-center p-6">
      <div className="bg-white p-4 rounded-lg shadow-lg">
        <QR value={value} size={size} aria-label="Menu QR Code" />
      </div>
      <p className="text-fg/70 text-sm mt-4 text-center break-all max-w-xs">{value}</p>
    </div>
  );
}
