import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { squish, upper, code, lower, title, freeText, toNumber, zTitle, zCode, zMoneyLoose } from './normalize.js';

describe('squish', () => {
  it('collapses runs of whitespace and trims', () => {
    expect(squish('  Kasa   Lokal \n')).toBe('Kasa Lokal');
  });
  it('handles null/undefined without throwing', () => {
    expect(squish(null)).toBe('');
    expect(squish(undefined)).toBe('');
  });
});

describe('code / upper', () => {
  it('uppercases and removes interior spaces for codes', () => {
    expect(code(' osk 001 ')).toBe('OSK001');
  });
  it('keeps interior spaces for plain upper', () => {
    expect(upper(' po ref 12 ')).toBe('PO REF 12');
  });
});

describe('lower', () => {
  it('normalizes emails and usernames', () => {
    expect(lower('  S3MIVRA@Gmail.COM ')).toBe('s3mivra@gmail.com');
  });
});

describe('title', () => {
  it('title-cases a plain business name', () => {
    expect(title('kasa lokal')).toBe('Kasa Lokal');
  });
  it('collapses the three spellings to one canonical form', () => {
    expect(title('KASA LOKAL')).toBe(title('kasa lokal'));
    expect(title('  Kasa   Lokal ')).toBe(title('kasa lokal'));
  });
  it('keeps minor words lowercase in the middle only', () => {
    expect(title('bank of the philippine islands')).toBe('Bank of the Philippine Islands');
    expect(title('of')).toBe('Of');            // first word still capitalized
    expect(title('house of')).toBe('House Of'); // last word still capitalized
  });
  it('preserves acronyms', () => {
    expect(title('abc trading inc')).toBe('Abc Trading Inc');
    expect(title('bir form')).toBe('BIR Form');
  });
  it('uppercases any token containing a digit so pack labels survive', () => {
    expect(title('milk 1l')).toBe('Milk 1L');
    expect(title('bond paper a4')).toBe('Bond Paper A4');
  });
  it('handles hyphens and apostrophes', () => {
    expect(title('coca-cola')).toBe('Coca-Cola');
    expect(title("o'brien supply")).toBe("O'Brien Supply");
  });
});

describe('freeText', () => {
  it('tidies spacing but never re-cases', () => {
    expect(freeText('  DO NOT  STACK  ')).toBe('DO NOT STACK');
  });
  it('preserves single newlines and caps blank runs at one', () => {
    expect(freeText('line one\n\n\n\nline two')).toBe('line one\n\nline two');
  });
});

describe('toNumber', () => {
  it('accepts the formats people actually type', () => {
    expect(toNumber('1,500')).toBe(1500);
    expect(toNumber('₱1,500.00')).toBe(1500);
    expect(toNumber(' 1500 ')).toBe(1500);
    expect(toNumber(1500)).toBe(1500);
    expect(toNumber('-25.5')).toBe(-25.5);
  });
  it('rejects junk as NaN so Zod can 422 it', () => {
    expect(toNumber('abc')).toBeNaN();
    expect(toNumber('')).toBeNaN();
    expect(toNumber('1.2.3')).toBeNaN();
    expect(toNumber(null)).toBeNaN();
  });
});

describe('zod helpers', () => {
  it('zTitle normalizes on parse', () => {
    expect(zTitle(z).parse('  kasa   lokal ')).toBe('Kasa Lokal');
  });
  it('zTitle rejects empty after squishing', () => {
    expect(zTitle(z).safeParse('   ').success).toBe(false);
  });
  it('zCode normalizes on parse', () => {
    expect(zCode(z).parse(' osk 001 ')).toBe('OSK001');
  });
  it('zMoneyLoose accepts comma-formatted pesos', () => {
    expect(zMoneyLoose(z).parse('1,500.50')).toBe(1500.5);
  });
  it('zMoneyLoose rejects negatives and junk', () => {
    expect(zMoneyLoose(z).safeParse('-5').success).toBe(false);
    expect(zMoneyLoose(z).safeParse('abc').success).toBe(false);
  });
});
