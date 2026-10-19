// The example row on every import template is copied by people setting up a
// business, so it has to be right. The Expenses template once showed "March
// electricity" charged to 610000 - Salaries & Wages - and anyone following it
// booked their power bill as payroll.
import { describe, it, expect } from 'vitest';
import { DATASETS } from '../lib/dataSets.js';
import { EXPENSE_CATEGORIES, ACCOUNTS } from '../lib/chartOfAccounts.js';

const exampleOf = (key, col) => DATASETS[key].importSpec.columns.find((c) => c.name === col)?.example;

describe('template examples', () => {
  it('every importable dataset that has a template gives a full example row', () => {
    for (const [key, d] of Object.entries(DATASETS)) {
      if (!d.importSpec) continue;
      for (const c of d.importSpec.columns) {
        if (c.required) expect(c.example, `${key}.${c.name}`).not.toBeUndefined();
      }
    }
  });

  it('the expense example is charged to an expense account that fits what it says', () => {
    const code = exampleOf('expenses', 'categoryCode');
    const cat = EXPENSE_CATEGORIES.find((c) => c.code === code);
    expect(cat, `expense example code ${code}`).toBeTruthy();
    expect(exampleOf('expenses', 'description')).toMatch(/electric/i);
    expect(cat.label).toMatch(/electric|utilit/i);
  });

  it('the bill example names an account that exists', () => {
    const code = exampleOf('bills', 'expenseAccountCode');
    expect(ACCOUNTS[code], `bill example code ${code}`).toBeTruthy();
  });
});
