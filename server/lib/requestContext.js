// The request a piece of code is running on behalf of, available anywhere in
// that request's async call chain without threading `req` through every
// function.
//
// Its one job today: journal entries record WHO posted them. There are ~60
// places that create an entry; stamping postedBy at each would miss the next
// one someone adds. Instead the JournalEntry schema reads the user from here
// when it validates, so every posting - inside a transaction or not - is
// attributed, including ones written after this comment.
import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage();

// Express middleware. Mount it before any route; verifyToken fills req.user
// later on the same object, which is why the REQUEST is stored, not the user.
export function requestContext(req, _res, next) {
  store.run({ req }, next);
}

// The staff member (or client) the current code is acting for, if any.
export function currentActor() {
  const u = store.getStore()?.req?.user;
  if (!u) return null;
  return {
    id: String(u._id || u.clientId || ''),
    name: u.name || u.username || '',
    role: u.role || '',
  };
}
