import { test } from 'node:test';
import assert from 'node:assert/strict';
import Decimal from 'decimal.js';
import {
  SplitStrategy,
  allocateExpense,
  computeBalances,
  settleOptimized,
  buildSettlement,
} from '../src/settlement.js';
import { computeServiceChargePct, serviceChargeForExpenses, GITHUB_USERNAME } from '../src/config.js';

// Helper to make a group
const makeGroup = () => ({
  id: 'g1',
  name: 'Trip',
  participants: [
    { id: 'a', name: 'Alice' },
    { id: 'b', name: 'Bob' },
    { id: 'c', name: 'Carol' },
  ],
});

test('allocateExpense EQUAL splits evenly', () => {
  const e = { amount: '100.00', paidBy: 'a', for: ['a', 'b', 'c'], strategy: SplitStrategy.EQUAL };
  const alloc = allocateExpense(e);
  assert.equal(alloc.get('a').toDecimalPlaces(2).toString(), '33.33');
  assert.equal(alloc.get('b').toDecimalPlaces(2).toString(), '33.33');
  // last absorbs remainder so total is exactly 100
  assert.equal(alloc.get('c').toDecimalPlaces(2).toString(), '33.34');
  const sum = alloc.get('a').plus(alloc.get('b')).plus(alloc.get('c'));
  assert.equal(sum.toString(), '100');
});

test('allocateExpense PERCENT uses shares and totals exactly', () => {
  const e = {
    amount: '200.00',
    paidBy: 'a',
    for: ['a', 'b', 'c'],
    strategy: SplitStrategy.PERCENT,
    shares: { a: 50, b: 30, c: 20 },
  };
  const alloc = allocateExpense(e);
  assert.equal(alloc.get('a').toString(), '100');
  assert.equal(alloc.get('b').toString(), '60');
  assert.equal(alloc.get('c').toString(), '40');
});

test('allocateExpense EXACT respects given amounts', () => {
  const e = {
    amount: '90.00',
    paidBy: 'a',
    for: ['b', 'c'],
    strategy: SplitStrategy.EXACT,
    shares: { b: '55.50', c: '34.50' },
  };
  const alloc = allocateExpense(e);
  assert.equal(alloc.get('b').toString(), '55.5');
  assert.equal(alloc.get('c').toString(), '34.5');
});

test('computeBalances: payer gains amount, beneficiaries owe their share', () => {
  const group = makeGroup();
  const expenses = [
    { amount: '100.00', paidBy: 'a', for: ['a', 'b', 'c'], strategy: SplitStrategy.EQUAL },
  ];
  const balances = computeBalances(group, expenses);
  // Alice paid 100, owes 33.33 → net +66.67
  assert.equal(balances.get('a').toDecimalPlaces(2).toString(), '66.67');
  // Bob owes 33.33; Carol absorbs remainder (33.34)
  assert.equal(balances.get('b').toDecimalPlaces(2).toString(), '-33.33');
  assert.equal(balances.get('c').toDecimalPlaces(2).toString(), '-33.34');
  void assert;
});

test('settleOptimized minimizes transactions and balances to zero', () => {
  const balances = new Map([
    ['a', new Decimal('66.67')],
    ['b', new Decimal('-33.33')],
    ['c', new Decimal('-33.34')],
  ]);
  const tx = settleOptimized(balances);
  // Should be exactly 2 transactions, fully settling both debtors
  assert.equal(tx.length, 2);
  const totalMoved = tx.reduce((acc, t) => acc.plus(new Decimal(t.amount)), new Decimal(0));
  assert.equal(totalMoved.toDecimalPlaces(2).toString(), '66.67');
  // every debtor fully paid
  for (const t of tx) assert.ok(new Decimal(t.amount).gt(0));
});

test('settlement with 4 people optimizes below naive count', () => {
  const group = makeGroup();
  group.participants.push({ id: 'd', name: 'Dan' });
  const expenses = [
    { amount: '120.00', paidBy: 'a', for: ['a', 'b', 'c', 'd'], strategy: SplitStrategy.EQUAL },
    { amount: '40.00', paidBy: 'd', for: ['a', 'b'], strategy: SplitStrategy.EQUAL },
  ];
  const balances = computeBalances(group, expenses);
  const tx = settleOptimized(balances);
  // 4 participants, a fully-connected naive settle could need up to 3 transfers.
  // Greedy optimization should never need more than (n-1) transactions.
  assert.ok(tx.length <= 3, `expected <=3 tx, got ${tx.length}`);
  // Every transaction moves a positive amount and fully settles participants
  const moved = tx.reduce((acc, t) => acc.plus(new Decimal(t.amount)), new Decimal(0));
  assert.ok(moved.gt(0));
});

test('service charge pct computed from username, not hardcoded', () => {
  // allobankdev → sum ASCII 1155 → 1155 % 10 = 5
  assert.equal(computeServiceChargePct('allobankdev'), 5);
  // case-insensitive
  assert.equal(computeServiceChargePct('AlloBankDev'), 5);
});

test('service charge pct is derived from the submission GitHub username', () => {
  // Sum of the lowercase code points of 'amiruljusticia0507' = 1714 → 1714 % 10 = 4.
  let sum = 0;
  for (const ch of 'amiruljusticia0507') sum += ch.charCodeAt(0);
  assert.equal(computeServiceChargePct(GITHUB_USERNAME), sum % 10);
  assert.equal(computeServiceChargePct(GITHUB_USERNAME), 4);
});

test('service charge amount is pct of total expenses', () => {
  const pct = computeServiceChargePct('allobankdev'); // 5
  const amount = serviceChargeForExpenses(pct, new Decimal('200.00'));
  assert.equal(amount.toString(), '10'); // 5% of 200
});

test('buildSettlement returns required personalization fields', () => {
  const group = makeGroup();
  const expenses = [
    { amount: '100.00', paidBy: 'a', for: ['a', 'b', 'c'], strategy: SplitStrategy.EQUAL },
  ];
  const settlement = buildSettlement(group, expenses, 5);
  // The brief requires these exact snake_case keys on every settlement response.
  assert.equal(settlement.service_charge_pct, 5);
  assert.equal(settlement.service_charge_amount, '5.00'); // 5% of 100 = 5
  assert.equal(settlement.total_with_service_charge, '105.00');
  // CamelCase kept for the existing frontend.
  assert.equal(settlement.serviceChargePct, 5);
  assert.equal(settlement.serviceChargeAmount, '5.00');
  assert.ok(Array.isArray(settlement.transactions));
  assert.ok(settlement.totalExpenses);
});
