# Freight Detention & Demurrage Recovery OS

An independent React, Express, PostgreSQL, and OpenRouter application for validating ocean freight charges, generating evidence-backed disputes, tracking recoveries, and preventing avoidable fees.

## Included

- 12 domain-specific capabilities with custom input fields and three scenario-fill buttons each.
- 15 meaningful PostgreSQL records per capability (180 total).
- Deterministic free-time, charge, timing, and recovery calculations.
- Professional structured OpenRouter decision briefs; raw JSON is never rendered.
- Three provisioned roles, visible demo credential controls, governed state changes, outcome analytics, and a clickable audit trail.

## Run

```bash
./start.sh
```

Open <http://127.0.0.1:4531>. The API runs on port `5531`. The script provisions a local PostgreSQL database, applies migrations, preserves and upserts seeded records, and loads `../.openrouter.env` when present.

## Validate

```bash
node scripts/validate.mjs
node scripts/smoke.mjs
```
