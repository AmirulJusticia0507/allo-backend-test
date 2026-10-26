import Decimal from 'decimal.js';

/**
 * Split strategies for an expense.
 *  - EQUAL:   divide equally among all participants the expense is "for"
 *  - PERCENT: each beneficiary gets a share defined by their percentage (must sum to 100)
 *  - EXACT:   each beneficiary owes a specific exact amount
 */
export const SplitStrategy = {
  EQUAL: 'EQUAL',
  PERCENT: 'PERCENT',
  EXACT: 'EXACT',
};

/**
 * Allocate an expense's amount across its beneficiaries according to the split strategy.
 * Returns a Map<participantId, Decimal> of how much each beneficiary owes for THIS expense.
 *
 * @param {object} expense - { amount, paidBy, for: [ids], strategy, shares }
 *   shares: { [id]: percent } for PERCENT, { [id]: amount } for EXACT
 */
export function allocateExpense(expense) {
  const amount = new Decimal(expense.amount);
  const beneficiaries = expense.for ?? expense.beneficiaries ?? [];
  const result = new Map();

  for (const id of beneficiaries) result.set(id, new Decimal(0));

  switch (expense.strategy) {
    case SplitStrategy.PERCENT: {
      const shares = expense.shares ?? {};
      let allocated = new Decimal(0);
      // last beneficiary absorbs rounding remainder to guarantee exact total
      for (let i = 0; i < beneficiaries.length; i++) {
        const id = beneficiaries[i];
        const pct = new Decimal(shares[id] ?? 0).div(100);
        const share = amount.times(pct);
        if (i !== beneficiaries.length - 1) {
          result.set(id, share);
          allocated = allocated.plus(share);
        } else {
          result.set(id, amount.minus(allocated)); // absorb remainder
        }
      }
      break;
    }
    case SplitStrategy.EXACT: {
      const shares = expense.shares ?? {};
      let allocated = new Decimal(0);
      for (let i = 0; i < beneficiaries.length; i++) {
        const id = beneficiaries[i];
        const amt = new Decimal(shares[id] ?? 0);
        if (i !== beneficiaries.length - 1) {
          result.set(id, amt);
          allocated = allocated.plus(amt);
        } else {
          result.set(id, amount.minus(allocated)); // absorb remainder
        }
      }
      break;
    }
    case SplitStrategy.EQUAL:
    default: {
      const per = amount.div(beneficiaries.length).toDecimalPlaces(2);
      let allocated = new Decimal(0);
      beneficiaries.forEach((id, idx) => {
        if (idx !== beneficiaries.length - 1) {
          result.set(id, per);
          allocated = allocated.plus(per);
        } else {
          result.set(id, amount.minus(allocated)); // absorb remainder to exactly total
        }
      });
      break;
    }
  }
  return result;
}

/**
 * Build per-participant balances.
 *   balance = (total paid by participant) - (total owed by participant)
 * A positive balance means they are owed money; negative means they owe.
 *
 * @returns {Map<id, Decimal>}
 */
export function computeBalances(group, expenses) {
  const balances = new Map();
  group.participants.forEach((p) => balances.set(p.id, new Decimal(0)));

  for (const e of expenses) {
    const paidBy = e.paidBy;
    const paid = new Decimal(e.amount);
    balances.set(paidBy, balances.get(paidBy).plus(paid));

    const allocation = allocateExpense(e);
    for (const [id, owe] of allocation) {
      balances.set(id, balances.get(id).minus(owe));
    }
  }
  return balances;
}

/**
 * Settlement optimization: turn balances into the minimum number of transactions.
 * Greedy algorithm: repeatedly match the biggest creditor with the biggest debtor.
 *
 * @returns {Array<{ from, to, amount }>}
 */
export function settleOptimized(balances) {
  const creditors = []; // positive balance → is owed money
  const debtors = [];   // negative balance → owes money

  for (const [id, bal] of balances) {
    if (bal.gt(0)) creditors.push({ id, amount: bal });
    else if (bal.lt(0)) debtors.push({ id, amount: bal.neg() });
  }

  creditors.sort((a, b) => b.amount.cmp(a.amount));
  debtors.sort((a, b) => b.amount.cmp(a.amount));

  const transactions = [];
  let i = 0;
  let j = 0;
  while (i < creditors.length && j < debtors.length) {
    const c = creditors[i];
    const d = debtors[j];
    const pay = Decimal.min(c.amount, d.amount);

    if (pay.gt(0)) {
      transactions.push({
        from: d.id,
        to: c.id,
        amount: pay.toDecimalPlaces(2).toFixed(2),
      });
    }

    c.amount = c.amount.minus(pay);
    d.amount = d.amount.minus(pay);

    if (c.amount.lte(0)) i++;
    if (d.amount.lte(0)) j++;
  }
  return transactions;
}

/**
 * Full settlement summary for a group.
 */
export function buildSettlement(group, expenses, serviceChargePct) {
  const balances = computeBalances(group, expenses);
  const transactions = settleOptimized(balances);

  const totalExpenses = expenses.reduce(
    (acc, e) => acc.plus(new Decimal(e.amount)),
    new Decimal(0)
  );

  const serviceChargeAmount = totalExpenses
    .times(new Decimal(serviceChargePct).div(100))
    .toDecimalPlaces(2);

  // Always two decimal places so clients get a stable money format.
  const money = (value) => value.toDecimalPlaces(2).toFixed(2);

  const perParticipant = group.participants.map((p) => ({
    id: p.id,
    name: p.name,
    balance: money(balances.get(p.id)),
  }));

  const totalExpensesRounded = money(totalExpenses);

  return {
    groupId: group.id,
    groupName: group.name,
    totalExpenses: totalExpensesRounded,
    // Required by the brief: snake_case, both fields, every settlement response.
    service_charge_pct: serviceChargePct,
    service_charge_amount: money(serviceChargeAmount),
    // Kept for backwards compatibility with the existing frontend.
    serviceChargePct,
    serviceChargeAmount: money(serviceChargeAmount),
    total_with_service_charge: money(totalExpenses.plus(serviceChargeAmount)),
    perParticipant,
    transactions,
  };
}
