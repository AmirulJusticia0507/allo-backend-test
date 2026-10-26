// Simple in-memory store. Resets on restart — fine for a practice build.
// Swap with a real DB later without changing the service layer.

const groups = new Map(); // groupId -> { id, name, participants: [{id,name}] }
const expenses = new Map(); // groupId -> [expense,...]
const payments = new Map(); // groupId -> [payment,...]

export function createGroup({ name, participants }) {
  const id = `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const normalizedParticipants = (participants || []).map((p, idx) => ({
    id: p.id || `p_${idx + 1}`,
    name: p.name,
  }));
  const group = { id, name, participants: normalizedParticipants };
  groups.set(id, group);
  expenses.set(id, []);
  payments.set(id, []);
  return group;
}

export function getGroup(id) {
  return groups.get(id) || null;
}

export function listGroups() {
  return [...groups.values()];
}

export function addExpense(groupId, expense) {
  if (!groups.has(groupId)) return null;
  const list = expenses.get(groupId);
  const record = {
    id: `exp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    ...expense,
  };
  list.push(record);
  return record;
}

export function getExpenses(groupId) {
  return expenses.get(groupId) || [];
}

export function addPayment(groupId, payment) {
  if (!groups.has(groupId)) return null;
  const list = payments.get(groupId);
  const record = {
    id: `pay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    ...payment,
  };
  list.push(record);
  return record;
}

export function getPayments(groupId) {
  return payments.get(groupId) || [];
}
