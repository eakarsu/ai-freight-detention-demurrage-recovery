// Search/filter, export, and deterministic insights over saved feature records.
// Insights never call an AI provider: they are a labelled deterministic fallback
// (aiGenerated:false) computed only from this app's own saved records.
const fail = (message, status = 422) => Object.assign(new Error(message), { status });
const amountOf = (row) => { const n = Number(row?.amount); return Number.isFinite(n) ? n : 0; };
const dueOf = (row) => { const v = row?.due_date; if (!v) return ''; return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10); };

export function filterRecords(rows, filters = {}) {
  const q = String(filters.q || '').trim().toLowerCase();
  const status = String(filters.status || '').trim().toLowerCase();
  const risk = String(filters.risk || '').trim().toLowerCase();
  const owner = String(filters.owner || '').trim().toLowerCase();
  return (rows || []).filter((row) => {
    if (status && String(row.status || '').toLowerCase() !== status) return false;
    if (risk && String(row.risk || '').toLowerCase() !== risk) return false;
    if (owner && String(row.owner || '').toLowerCase() !== owner) return false;
    if (!q) return true;
    const haystack = [row.reference, row.title, row.owner, row.status, row.risk, JSON.stringify(row.payload ?? {})].join(' ').toLowerCase();
    return haystack.includes(q);
  });
}

function csvCell(value) {
  const raw = value instanceof Date ? value.toISOString() : value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export function recordsToCsv(rows) {
  const header = ['id', 'reference', 'title', 'status', 'owner', 'risk', 'due_date', 'amount', 'payload'];
  const lines = (rows || []).map((row) => [row.id, row.reference, row.title, row.status, row.owner, row.risk, dueOf(row), amountOf(row), row.payload ?? {}].map(csvCell).join(','));
  return [header.join(','), ...lines].join('\n') + '\n';
}

export function recordsToJson(rows, featureId) {
  return JSON.stringify({ featureId, count: (rows || []).length, records: JSON.parse(JSON.stringify(rows || [])) }, null, 2) + '\n';
}

const brief = (row) => ({ reference: row.reference, title: row.title, status: row.status, owner: row.owner ?? '', risk: row.risk, dueDate: dueOf(row), amount: amountOf(row) });

export function buildInsight(kind, rows, feature, now = new Date()) {
  const records = rows || [];
  const title = feature?.title || 'Records';
  const base = { kind, featureId: feature?.id, featureTitle: title, aiGenerated: false, provider: 'none', source: 'deterministic-fallback', label: 'Deterministic fallback — not AI generated' };
  const open = records.filter((r) => !['Approved', 'Closed'].includes(r.status));
  if (kind === 'exception-triage') {
    const flagged = records.filter((r) => ['High', 'Critical'].includes(r.risk)).sort((a, b) => amountOf(b) - amountOf(a)).slice(0, 5).map(brief);
    const valueAtRisk = records.filter((r) => ['High', 'Critical'].includes(r.risk) && !['Approved', 'Closed'].includes(r.status)).reduce((s, r) => s + amountOf(r), 0);
    return { ...base, summary: `${title}: ${flagged.length} high-risk records flagged from ${records.length} saved records; ${open.length} still open.`, metrics: [{ label: 'Saved records', value: records.length }, { label: 'Open records', value: open.length }, { label: 'High-risk records', value: records.filter((r) => ['High', 'Critical'].includes(r.risk)).length }, { label: 'Open high-risk value', value: valueAtRisk }], records: flagged, actions: flagged.length ? flagged.map((r) => `Review ${r.reference} (${r.risk}, ${r.status}) with its owner ${r.owner || 'unassigned'}.`) : ['No high-risk records need triage.'] };
  }
  if (kind === 'value-concentration') {
    const sorted = [...records].sort((a, b) => amountOf(b) - amountOf(a));
    const total = records.reduce((s, r) => s + amountOf(r), 0);
    const top = sorted.slice(0, 5).map(brief);
    const top3 = sorted.slice(0, 3).reduce((s, r) => s + amountOf(r), 0);
    return { ...base, summary: `${title}: total saved value ${total} across ${records.length} records; largest records drive the concentration view.`, metrics: [{ label: 'Saved records', value: records.length }, { label: 'Total value', value: total }, { label: 'Average value', value: records.length ? Math.round((total / records.length) * 100) / 100 : 0 }, { label: 'Top 3 share %', value: total ? Math.round((top3 / total) * 1000) / 10 : 0 }], records: top, actions: top.length ? top.map((r) => `Validate the evidence behind ${r.reference} before relying on its value ${r.amount}.`) : ['No saved records to rank yet.'] };
  }
  if (kind === 'next-actions') {
    const today = dueOf({ due_date: now });
    const overdue = open.filter((r) => dueOf(r) && dueOf(r) < today).map(brief);
    const soon = open.filter((r) => { const d = dueOf(r); if (!d || d < today) return false; const days = (Date.parse(d) - Date.parse(today)) / 86400000; return days >= 0 && days <= 7; }).map(brief);
    const unassigned = open.filter((r) => !String(r.owner || '').trim()).map(brief);
    const actions = [...overdue.map((r) => `Escalate overdue ${r.reference} (due ${r.dueDate}).`), ...soon.map((r) => `Prepare ${r.reference} due ${r.dueDate}.`), ...unassigned.map((r) => `Assign an owner to ${r.reference}.`)];
    return { ...base, summary: `${title}: ${overdue.length} overdue, ${soon.length} due within 7 days, ${unassigned.length} unassigned open records.`, metrics: [{ label: 'Overdue open', value: overdue.length }, { label: 'Due within 7 days', value: soon.length }, { label: 'Unassigned open', value: unassigned.length }], records: [...overdue, ...soon].slice(0, 5), actions: actions.length ? actions.slice(0, 8) : ['No overdue, due-soon, or unassigned open records.'] };
  }
  throw fail('Insight kind must be exception-triage, value-concentration, or next-actions');
}

export function mountFeaturePack(app, { pool, auth, featureById }) {
  if (typeof auth !== 'function') throw new Error('mountFeaturePack requires the auth middleware');
  app.get('/api/features/:id/records/export', auth, async (req, res, next) => {
    try {
      const feature = featureById(req.params.id);
      const rows = (await pool.query('SELECT * FROM feature_records WHERE feature_id=$1 ORDER BY updated_at DESC,id DESC', [feature.id])).rows;
      const filtered = filterRecords(rows, req.query);
      const format = String(req.query.format || 'csv').toLowerCase();
      if (format === 'json') { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${feature.id}-records.json"`); return res.send(recordsToJson(filtered, feature.id)); }
      if (format !== 'csv') throw fail('Export format must be csv or json');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${feature.id}-records.csv"`); return res.send(recordsToCsv(filtered));
    } catch (error) { next(error); }
  });
  app.get('/api/features/:id/insights/:kind', auth, async (req, res, next) => {
    try {
      const feature = featureById(req.params.id);
      const rows = (await pool.query('SELECT * FROM feature_records WHERE feature_id=$1 ORDER BY updated_at DESC,id DESC', [feature.id])).rows;
      res.json({ insight: buildInsight(req.params.kind, rows, feature) });
    } catch (error) { next(error); }
  });
}
