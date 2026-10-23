// Offline only: provider keys are removed before importing app modules; no provider calls are made.
delete process.env.OPENROUTER_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { filterRecords, recordsToCsv, recordsToJson, buildInsight } from "../featurePack.mjs";

const rows = [
  { id: 1, reference: "FDF01-1", title: "Alpha territory case", status: "Open", owner: "Sam", risk: "High", due_date: "2026-01-05", amount: 0, payload: { verified: false, note: "", retries: 0 } },
  { id: 2, reference: "FDF01-2", title: "Beta fee case", status: "Closed", owner: "", risk: "Low", due_date: "2026-01-20", amount: 500, payload: { verified: true } },
];
const feature = { id: "development-agreement-library", title: "Development agreement library" };

test("search/filter matches text, payload, status, and risk", () => {
  assert.equal(filterRecords(rows, { q: "alpha" }).length, 1);
  assert.equal(filterRecords(rows, { q: "false" }).length, 1);
  assert.equal(filterRecords(rows, { status: "Closed" })[0].reference, "FDF01-2");
  assert.equal(filterRecords(rows, { risk: "High" }).length, 1);
  assert.deepEqual(filterRecords(rows, { q: "missing" }), []);
  assert.equal(filterRecords(rows, {}).length, 2);
});

test("CSV and JSON export preserve 0, false, and empty values", () => {
  const csv = recordsToCsv(rows);
  assert.ok(csv.includes("FDF01-1") && csv.includes(",0,"));
  assert.ok(csv.includes('"verified":false') || csv.includes("false"));
  const parsed = JSON.parse(recordsToJson(rows, feature.id));
  assert.equal(parsed.count, 2);
  assert.equal(parsed.records[0].amount, 0);
  assert.equal(parsed.records[0].payload.verified, false);
  assert.equal(parsed.records[0].payload.note, "");
  assert.equal(parsed.records[0].payload.retries, 0);
});

test("record insights are labelled deterministic fallback with aiGenerated false", () => {
  const now = new Date("2026-01-10T00:00:00Z");
  for (const kind of ["exception-triage", "value-concentration", "next-actions"]) {
    const insight = buildInsight(kind, rows, feature, now);
    assert.equal(insight.aiGenerated, false);
    assert.equal(insight.source, "deterministic-fallback");
    assert.match(insight.label, /Deterministic fallback/);
    assert.ok(Array.isArray(insight.metrics) && Array.isArray(insight.actions));
  }
  assert.equal(buildInsight("next-actions", rows, feature, now).metrics.find((m) => m.label === "Overdue open").value, 1);
  assert.equal(buildInsight("value-concentration", [], feature, now).metrics.find((m) => m.label === "Average value").value, 0);
  assert.throws(() => buildInsight("nope", rows, feature, now), /Insight kind/);
});

test("feature pack is mounted behind auth before record-id routes", () => {
  const server = fs.readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.ok(server.includes("mountFeaturePack(app,{pool,auth,featureById})"));
  assert.ok(server.indexOf("mountFeaturePack(app") < server.indexOf("mountRecoveryRecordActions(app"), "export route must precede :recordId");
  assert.ok(server.includes("filterRecords(rows,req.query)"), "main records list must apply search/filter");
});
