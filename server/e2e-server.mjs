// Boots the API against a throwaway in-memory MongoDB for e2e runs, so
// Playwright never touches the real database. Seeds the default Super Admin
// (password ChangeMe@2026!) via the normal startup path.
//
// Usage:  npm run e2e:server   (root)  — then in another terminal:
//         npm run e2e          (client/, or `npx playwright test`)
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.MONGO_URI = mongod.getUri();
process.env.ADMIN_PASS = 'ChangeMe@2026!';
process.env.JWT_SECRET = 'e2e-only-secret-not-for-production-use-1234567890';
process.env.PORT = process.env.PORT || '5002';
process.env.BUSINESS_TYPE = process.env.BUSINESS_TYPE || 'log';
process.env.NODE_ENV = 'development';

console.log('[e2e-server] in-memory MongoDB at', process.env.MONGO_URI);
await import('./server.js');
