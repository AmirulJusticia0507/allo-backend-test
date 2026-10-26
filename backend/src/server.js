import express from 'express';
import cors from 'cors';
import Decimal from 'decimal.js';
import {
  GITHUB_USERNAME,
  computeServiceChargePct,
  serviceChargeForExpenses,
} from './config.js';
import {
  SplitStrategy,
  buildSettlement,
  computeBalances,
} from './settlement.js';
import {
  createGroup,
  getGroup,
  listGroups,
  addExpense,
  getExpenses,
  addPayment,
  getPayments,
} from './store.js';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4110;

// Reject anything `new Decimal()` would throw on, so bad input is a 400 not a 500.
function isNumericString (value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string' || value.trim() === '') return false;
  return Number.isFinite(Number(value));
}

/**
 * `shares` are only meaningful for PERCENT and EXACT. Silently accepting shares
 * that do not add up produces meaningless balances, so reject them instead.
 * Returns an error message, or null when the payload is valid.
 */
function validateShares (strategy, shares, beneficiaries, amount) {
  if (strategy !== SplitStrategy.PERCENT && strategy !== SplitStrategy.EXACT) return null;

  const values = Object.values(shares);
  if (values.length === 0) return `shares are required for ${strategy} expenses`;
  if (!values.every(isNumericString)) return 'shares must be numeric values';

  let total = new Decimal(0);
  for (const value of values) total = total.plus(new Decimal(value));

  if (strategy === SplitStrategy.PERCENT) {
    return total.equals(100) ? null : 'shares must total 100 for PERCENT expenses';
  }

  const expected = new Decimal(amount);
  return total.equals(expected) ? null : 'shares must total the expense amount for EXACT expenses';
}

// ── Root (welcome + endpoint index) ────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    name: 'Allo Split Bill API',
    status: 'running',
    github: GITHUB_USERNAME,
    serviceChargePct: `${computeServiceChargePct(GITHUB_USERNAME)}%`,
    endpoints: [
      { method: 'GET', path: '/health', description: 'Health check' },
      { method: 'GET', path: '/', description: 'This welcome message' },
      { method: 'GET', path: '/api/groups', description: 'List all bill groups' },
      { method: 'POST', path: '/api/groups', description: 'Create a bill group { name, participants:[{name}] }' },
      { method: 'GET', path: '/api/groups/:id', description: 'Get a group by id' },
      { method: 'GET', path: '/api/groups/:id/expenses', description: 'List expenses of a group' },
      { method: 'POST', path: '/api/groups/:id/expenses', description: 'Add an expense { amount, paidBy, for:[ids], strategy, shares?, category? }' },
      { method: 'POST', path: '/api/groups/:id/payments', description: 'Record a payment { from, to, amount, note? }' },
      { method: 'GET', path: '/api/groups/:id/settlement', description: 'Get settlement summary with service charge & optimized transactions' },
    ],
  });
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', github: GITHUB_USERNAME }));

// ── Groups ─────────────────────────────────────────────────────────────────────
app.get('/api/groups', (_req, res) => res.json(listGroups()));

app.post('/api/groups', (req, res) => {
  const { name, participants } = req.body || {};
  if (!name || !Array.isArray(participants) || participants.length === 0) {
    return res.status(400).json({ error: 'name and non-empty participants are required' });
  }
  const group = createGroup({ name, participants });
  res.status(201).json(group);
});

app.get('/api/groups/:id', (req, res) => {
  const group = getGroup(req.params.id);
  if (!group) return res.status(404).json({ error: 'group not found' });
  res.json(group);
});

// ── Expenses ───────────────────────────────────────────────────────────────────
app.get('/api/groups/:id/expenses', (req, res) => {
  if (!getGroup(req.params.id)) return res.status(404).json({ error: 'group not found' });
  res.json(getExpenses(req.params.id));
});

app.post('/api/groups/:id/expenses', (req, res) => {
  const group = getGroup(req.params.id);
  if (!group) return res.status(404).json({ error: 'group not found' });

  const { amount, paidBy, for: forIds, strategy, shares, category, description } = req.body || {};
  if (amount == null || !paidBy) {
    return res.status(400).json({ error: 'amount and paidBy are required' });
  }
  if (!Decimal.isDecimal(amount) && !isNumericString(amount)) {
    return res.status(400).json({ error: 'amount must be a numeric value' });
  }
  if (new Decimal(amount).lte(0)) {
    return res.status(400).json({ error: 'amount must be positive' });
  }
  const participantIds = new Set(group.participants.map((p) => p.id));
  if (!participantIds.has(paidBy)) {
    return res.status(400).json({ error: 'paidBy is not a group participant' });
  }
  const beneficiaries = forIds || group.participants.map((p) => p.id);
  for (const id of beneficiaries) {
    if (!participantIds.has(id)) {
      return res.status(400).json({ error: `beneficiary ${id} is not a group participant` });
    }
  }

  const splitStrategy = strategy || SplitStrategy.EQUAL;
  const shareError = validateShares(splitStrategy, shares || {}, beneficiaries, amount);
  if (shareError) return res.status(400).json({ error: shareError });

  const record = addExpense(req.params.id, {
    amount: String(amount),
    paidBy,
    for: beneficiaries,
    strategy: splitStrategy,
    shares: shares || {},
    category: category || 'general',
    description: description || '',
  });
  res.status(201).json(record);
});

// ── Payments (optional feature: mark a debt paid) ────────────────────────────
app.post('/api/groups/:id/payments', (req, res) => {
  const group = getGroup(req.params.id);
  if (!group) return res.status(404).json({ error: 'group not found' });
  const { from, to, amount, note } = req.body || {};
  if (!from || !to || amount == null) {
    return res.status(400).json({ error: 'from, to and amount are required' });
  }
  const record = addPayment(req.params.id, {
    from,
    to,
    amount: String(amount),
    note: note || '',
  });
  res.status(201).json(record);
});

// ── Settlement summary (core endpoint) ────────────────────────────────────────
app.get('/api/groups/:id/settlement', (req, res) => {
  const group = getGroup(req.params.id);
  if (!group) return res.status(404).json({ error: 'group not found' });

  const exps = getExpenses(req.params.id);
  const pct = computeServiceChargePct(GITHUB_USERNAME);

  // Show skill: also expose raw balances & payment-aware settlement if payments exist
  const balances = computeBalances(group, exps);
  const totalExpenses = exps.reduce(
    (acc, e) => acc.plus(new Decimal(e.amount)),
    new Decimal(0)
  );
  const serviceChargeAmount = serviceChargeForExpenses(pct, totalExpenses);

  const settlement = buildSettlement(group, exps, pct);

  res.json({
    ...settlement,
    paymentsApplied: getPayments(req.params.id),
    // total that includes the service charge
    totalWithServiceCharge: totalExpenses
      .plus(serviceChargeAmount)
      .toDecimalPlaces(2)
      .toString(),
  });
});

const server = app.listen(PORT, () => {
  console.log(`Split Bill API listening on http://localhost:${PORT}`);
  console.log(`Service charge pct for '${GITHUB_USERNAME}': ${computeServiceChargePct(GITHUB_USERNAME)}%`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use. Stop the other process (or run \`docker rm -f allo-be\`) before starting.`
    );
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});
