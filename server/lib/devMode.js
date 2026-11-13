// Preloaded by `npm run dev` (node --import ./lib/devMode.js). The server runs
// with production safeguards unless NODE_ENV says otherwise (2026-11 audit,
// M42), so the dev script names development mode itself rather than relying on
// every developer's .env. An explicit NODE_ENV in the shell still wins.
process.env.NODE_ENV ||= 'development';
