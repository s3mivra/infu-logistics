import React from 'react';

export default function QRCode({ url, size = 200 }) {
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}`;
  
  return (
    <div className="flex flex-col items-center justify-center p-6">
      <div className="bg-white p-4 rounded-lg shadow-lg">
        <img 
          src={qrUrl} 
          alt="Menu QR Code" 
          /* Use pure inline styles for dynamic sizes, remove the invalid Tailwind class */
          style={{ width: `${size}px`, height: `${size}px` }}
        />
      </div>
      <p className="text-gray-400 text-sm mt-4 text-center break-all max-w-xs">{url}</p>
    </div>
  );
}