# Allo Bank Backend Take-Home Test — Split Bill API

Submission by **Amirul Justicia** ([@AmirulJusticia0507](https://github.com/AmirulJusticia0507)).

| | |
|---|---|
| GitHub username | `AmirulJusticia0507` |
| `service_charge_pct` | **4%** |
| Calculation | sum of lowercase code points of `amiruljusticia0507` = `1714`; `1714 % 10` = `4` |
| Stack | Node.js 20 + Express, `decimal.js` for money |
| Port | `4110` |

> **Note on the stack.** The brief asks for Java/Spring Boot, but the recruiter
> asked for the backend in JavaScript, so this is implemented with Node.js and
> Express. Precision requirements are met with `decimal.js` (arbitrary-precision
> decimal arithmetic) instead of `float`/`double`; no monetary value ever passes
> through a JavaScript `number`.

---

## How to build and run

### Docker (recommended)

```bash
docker build -t allo-split-bill .
docker run -p 4110:4110 allo-split-bill
```

The image is a multi-stage build. The builder stage installs dependencies and
runs the test suite, so an image with failing tests is never produced.

### Locally

Requires Node.js 20+.

```bash
cd backend
npm ci
npm start          # http://localhost:4110
```

Other scripts:

```bash
npm run dev        # node --watch, restarts on change
npm test           # node --test test/settlement.test.js
npm run smoke      # end-to-end smoke test against a running server
```

Data is stored **in memory**: restarting the server clears all groups.

---

## API

All requests and responses are JSON. Money is always a **decimal string**
(`"120.50"`), never a float. Errors use `{ "error": "<reason>" }`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | Endpoint index |
| `GET` | `/health` | Health check |
| `GET` | `/api/groups` | List groups |
| `POST` | `/api/groups` | Create a group |
| `GET` | `/api/groups/:id` | Get one group |
| `GET` | `/api/groups/:id/expenses` | List expenses |
| `POST` | `/api/groups/:id/expenses` | Add an expense |
| `POST` | `/api/groups/:id/payments` | Record a payment |
| `GET` | `/api/groups/:id/settlement` | Settlement summary |

### Health

```bash
curl http://localhost:4110/health
# {"status":"ok","github":"AmirulJusticia0507"}
```

### Create a group

```bash
curl -X POST http://localhost:4110/api/groups \
  -H 'Content-Type: application/json' \
  -d '{"name":"Trip","participants":[{"name":"Ana"},{"name":"Ben"},{"name":"Cid"}]}'
# 201 {"id":"grp_...","name":"Trip","participants":[{"id":"p_1","name":"Ana"}, ...]}
```

The client sends participant **names only**; the server assigns `p_1`, `p_2`, …
in order. Always use the ids from the response.

### Get a group / list groups

```bash
curl http://localhost:4110/api/groups
curl http://localhost:4110/api/groups/grp_...
```

### Add an expense

`amount`, `paidBy` and `for` (participant ids) are required. `strategy` is
`EQUAL` (default), `PERCENT` or `EXACT`.

```bash
# Equal split across all participants
curl -X POST http://localhost:4110/api/groups/grp_.../expenses \
  -H 'Content-Type: application/json' \
  -d '{"amount":"90.00","paidBy":"p_1","category":"food","description":"Dinner"}'

# Split by percentage (must total 100)
curl -X POST http://localhost:4110/api/groups/grp_.../expenses \
  -H 'Content-Type: application/json' \
  -d '{"amount":"100","paidBy":"p_1","strategy":"PERCENT","shares":{"p_1":50,"p_2":30,"p_3":20}}'

# Exact amount per person (must total the expense amount)
curl -X POST http://localhost:4110/api/groups/grp_.../expenses \
  -H 'Content-Type: application/json' \
  -d '{"amount":"90","paidBy":"p_1","strategy":"EXACT","shares":{"p_1":50,"p_2":40}}'
```

Validation returns `400`: a non-numeric, zero or negative `amount`, an unknown
participant, or `shares` that do not add up.

### Record a payment

```bash
curl -X POST http://localhost:4110/api/groups/grp_.../payments \
  -H 'Content-Type: application/json' \
  -d '{"from":"p_2","to":"p_1","amount":"40.00","note":"Paid via transfer"}'
```

### Settlement

```bash
curl http://localhost:4110/api/groups/grp_.../settlement
```

```json
{
  "groupId": "grp_...",
  "groupName": "Trip",
  "totalExpenses": "120.00",
  "service_charge_pct": 4,
  "service_charge_amount": "4.80",
  "total_with_service_charge": "124.80",
  "perParticipant": [
    { "id": "p_1", "name": "Ana", "balance": "50.00" },
    { "id": "p_2", "name": "Ben", "balance": "-40.00" },
    { "id": "p_3", "name": "Cid", "balance": "-10.00" }
  ],
  "transactions": [
    { "from": "p_2", "to": "p_1", "amount": "40.00" },
    { "from": "p_3", "to": "p_1", "amount": "10.00" }
  ],
  "paymentsApplied": []
}
```

- A **positive** balance means that person is owed money, **negative** means they
  owe. The balances always sum to `0`.
- `transactions` is the reduced set of transfers produced by a greedy
  largest-creditor / largest-debtor match, so nobody pays more than necessary.
- `service_charge_pct` and `service_charge_amount` are required by the brief and
  are present on every settlement response, computed in code from the username.

---

## Tests

```bash
cd backend && npm test
```

Ten tests cover the settlement logic: equal/percent/exact allocation, the
rounding remainder, balance signs and the zero-sum invariant, the greedy
transaction reduction, the service-charge calculation, and the required
personalization fields.

---

## Submission question

> **What was the hardest design decision you made while building this, and what
> trade-off did you accept?**

The hardest decision was how to represent money everywhere. Dividing `100` by `3`
in floating point yields `33.333333`, and re-summing those shares silently loses
a cent, which is unacceptable in a banking-adjacent product, so I routed every
monetary value through `decimal.js` and kept amounts as decimal strings on the
wire. The remaining problem is that some division is genuinely inexact; I made
the **last beneficiary absorb the rounding remainder** so the allocated shares
always total the expense exactly. The trade-off is that the last person can owe
one cent more than the others and, for deliberately skewed `EXACT` shares, could
even end up with a small negative share — I accepted that edge case rather than
spreading the remainder, because a "correct total" is easier to audit than a
"perfectly even split" that does not balance. A related trade-off is keeping the
store in memory: it keeps the code small and the tests deterministic, at the cost
of losing data on restart.
