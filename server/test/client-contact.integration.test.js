// Customer contact tracking — phone/email/contactNotes on ClientAccount,
// through the create + update routes, incl. email validation.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok;
const auth = (method, path, token) => request(app)[method](path).set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'ccSuper', role: 'superadmin' });
  superTok = await loginStaff(app, 'ccSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('client contact fields', () => {
  let clientId;

  it('creates a client with phone/email/notes', async () => {
    const res = await auth('post', '/api/client-accounts', superTok).send({
      username: 'contactco', password: 'secret123', name: 'Contact Co',
      phone: '0917-555-1234', email: 'Billing@Contact.CO', contactNotes: 'Prefers SMS after 5pm',
    });
    expect(res.status).toBe(200);
    expect(res.body.client.phone).toBe('0917-555-1234');
    expect(res.body.client.email).toBe('billing@contact.co'); // lowercased
    expect(res.body.client.contactNotes).toBe('Prefers SMS after 5pm');
    clientId = res.body.client._id;
  });

  it('rejects an invalid email on create', async () => {
    const res = await auth('post', '/api/client-accounts', superTok).send({
      username: 'bademail', password: 'secret123', name: 'Bad Email', email: 'not-an-email',
    });
    expect(res.status).toBe(400);
  });

  it('updates contact fields and can clear the email with an empty string', async () => {
    const res = await auth('patch', `/api/client-accounts/${clientId}`, superTok).send({
      phone: '0999-000-1111', email: '',
    });
    expect(res.status).toBe(200);
    expect(res.body.client.phone).toBe('0999-000-1111');
    expect(res.body.client.email).toBe('');
  });

  it('rejects an invalid email on update (and leaves the record untouched)', async () => {
    const res = await auth('patch', `/api/client-accounts/${clientId}`, superTok).send({ email: 'still@bad' });
    expect(res.status).toBe(400);
    const list = await auth('get', '/api/client-accounts', superTok);
    const c = list.body.clients.find((x) => x._id === clientId);
    expect(c.email).toBe(''); // unchanged from the previous successful update
    expect(c.phone).toBe('0999-000-1111');
  });
});
