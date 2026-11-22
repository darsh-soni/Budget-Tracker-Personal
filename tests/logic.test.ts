import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmountToCents, centsToDecimal } from '../lib/money.ts';
import { categorize, merchantKey } from '../lib/merchant.ts';
import { matchCard } from '../lib/cards.ts';
import { monthRange, parseTimestamp, shiftMonth, monthKey } from '../lib/dates.ts';
import { parseCsv, parseStatementDate, toCsv } from '../lib/csv.ts';

test('parseAmountToCents handles Shortcut & bank formats', () => {
  assert.equal(parseAmountToCents('$12.34'), 1234);
  assert.equal(parseAmountToCents('CA$1,234.50'), 123450);
  assert.equal(parseAmountToCents('12,34'), 1234);
  assert.equal(parseAmountToCents('1.234,56'), 123456);
  assert.equal(parseAmountToCents('-4.00'), -400);
  assert.equal(parseAmountToCents('(4.00)'), -400);
  assert.equal(parseAmountToCents(7.1), 710);
  assert.equal(parseAmountToCents('1,000'), 100000);
  assert.equal(parseAmountToCents('abc'), null);
  assert.equal(parseAmountToCents(''), null);
  assert.equal(centsToDecimal(-1205), '-12.05');
});

test('merchantKey strips store numbers', () => {
  assert.equal(merchantKey('STARBUCKS #4521 TORONTO'), 'starbucks toronto');
  assert.equal(merchantKey('Café Olimpico'), 'cafe olimpico');
});

test('categorize prefers user rules and longest keyword', () => {
  const rules = [
    { keyword: 'uber', category_id: 'transport', source: 'default' as const },
    { keyword: 'uber eats', category_id: 'dining', source: 'default' as const },
    { keyword: 'costco', category_id: 'groceries', source: 'default' as const },
    { keyword: 'costco gas', category_id: 'transport', source: 'user' as const },
    { keyword: 'bar', category_id: 'dining', source: 'default' as const },
  ];
  assert.equal(categorize('UBER* TRIP', rules), 'transport');
  assert.equal(categorize('Uber Eats', rules), 'dining');
  assert.equal(categorize('COSTCO WHOLESALE #123', rules), 'groceries');
  assert.equal(categorize('Costco Gas', rules), 'transport');
  assert.equal(categorize('Barbershop', rules), null); // word boundary
  assert.equal(categorize('The Wine Bar', rules), 'dining');
});

test('matchCard uses alias, exact name, last4, fuzzy', () => {
  const cards = [
    { id: 'a', name: 'Amex Cobalt', last4: '1001' },
    { id: 'b', name: 'TD Visa', last4: '2002' },
    { id: 'c', name: 'TD Debit', last4: '3003' },
  ];
  const aliases = [{ alias: 'Everyday Card', card_id: 'c' }];
  assert.equal(matchCard('amex cobalt', cards, aliases), 'a');
  assert.equal(matchCard('Everyday Card', cards, aliases), 'c');
  assert.equal(matchCard('Visa •••• 2002', cards, aliases), 'b');
  assert.equal(matchCard('TD Aeroplan TD Visa Infinite', cards, aliases), 'b');
  assert.equal(matchCard('TD', cards, aliases), null); // ambiguous
  assert.equal(matchCard('Unknown', cards, aliases), null);
});

test('month ranges respect time zones', () => {
  const { start, end } = monthRange('2026-11', 'America/Toronto');
  assert.equal(start.toISOString(), '2026-11-01T04:00:00.000Z');
  assert.equal(end.toISOString(), '2026-12-01T05:00:00.000Z');
  const mar = monthRange('2026-03', 'America/Vancouver');
  assert.equal(mar.start.toISOString(), '2026-03-01T08:00:00.000Z');
  assert.equal(mar.end.toISOString(), '2026-04-01T07:00:00.000Z');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(monthKey(new Date('2026-12-01T03:00:00Z'), 'America/Toronto'), '2026-11');
});

test('parseTimestamp accepts ISO and Shortcuts long format', () => {
  assert.equal(parseTimestamp('2026-11-21T10:32:00-05:00')?.toISOString(), '2026-11-21T15:32:00.000Z');
  assert.ok(parseTimestamp('Nov 21, 2026 at 5:32 PM'));
  assert.equal(parseTimestamp('1795000000')?.getTime(), 1795000000000);
  assert.equal(parseTimestamp('garbage'), null);
});

test('csv parse/write round-trip', () => {
  const rows = parseCsv('﻿Date,Description,Amount\r\n2026-11-01,"Loblaws, ""Queen""",-45.10\n\n');
  assert.deepEqual(rows, [['Date', 'Description', 'Amount'], ['2026-11-01', 'Loblaws, "Queen"', '-45.10']]);
  assert.equal(toCsv(['a'], [['=SUM(1)'], ['-4.5']]), "a\r\n'=SUM(1)\r\n-4.5\r\n");
  assert.equal(parseStatementDate('11/03/2026')?.toISOString().slice(0, 10), '2026-11-03');
  assert.equal(parseStatementDate('11/03/2026', 'dmy')?.toISOString().slice(0, 10), '2026-03-11');
});
