// Where the API and the app live. A build sets VITE_API_URL - empty ("") on the
// platform, meaning "this same origin". When a build leaves it out entirely,
// production falls back to the same origin rather than to a developer's LAN
// address, which every copy used to hard-code: a build missing the variable
// then tried to reach 192.168.100.2 from a customer's tablet. The LAN address
// is kept for `npm run dev`, where it is how the tablets on the dev network
// reach the laptop.
const DEV_API = 'http://192.168.100.2:5002';
const DEV_FRONTEND = 'http://192.168.100.2:3000';
const origin = typeof window !== 'undefined' ? window.location.origin : '';

export const API_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? DEV_API : origin);
export const FRONTEND_URL = import.meta.env.VITE_FRONTEND_URL || (import.meta.env.DEV ? DEV_FRONTEND : origin);
