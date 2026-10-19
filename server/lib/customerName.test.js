// A stand-in name is not a person, however it is typed.
import { describe, it, expect } from 'vitest';
import { isAnonymousCustomerName, WALK_IN_NAME } from './customerName.js';

describe('isAnonymousCustomerName', () => {
  it('treats the stand-ins as nobody', () => {
    for (const n of ['', '   ', null, undefined, 'Guest', 'guest', 'GUEST',
      'Walk-in', 'Walk-In', 'walk in', 'WALKIN', 'Walk-in 2', WALK_IN_NAME]) {
      expect(isAnonymousCustomerName(n)).toBe(true);
    }
  });

  it('treats a real name as a real customer', () => {
    // Including names that merely START with the same letters: "Walker" is a
    // person, and must still be able to become a regular.
    for (const n of ['Maria', 'Ben Santos', 'Walker', 'Walkington', 'Guestina', 'Walter In']) {
      expect(isAnonymousCustomerName(n)).toBe(false);
    }
  });
});
