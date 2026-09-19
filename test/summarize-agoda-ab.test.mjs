import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, formatMarkdown, validateRecords } from '../scripts/summarize-agoda-ab.mjs';

const base = {
  property: 'ideal-fukushima', variant: 'cold', trial: 1,
  rawChars: 42000, projectedChars: 6800, cacheHit: false,
  apiMs: 410, elapsedMs: 1120, executedActions: 2, choice: 'DONE', verification: 'pass',
};

test('summarizer rejects unknown properties, variants, missing numbers, warm misses, and invalid verification', () => {
  for (const change of [
    {property: 'unknown'},
    {variant: 'hot'},
    {rawChars: undefined},
    {variant: 'warm', cacheHit: false},
    {verification: 'needs_verification'},
  ]) {
    const record = {...base, ...change};
    if (change.rawChars === undefined) delete record.rawChars;
    assert.throws(() => validateRecords([record]), /Invalid A\/B record/);
  }
});

test('summarize returns medians, reduction, action totals, choices, and verification totals', () => {
  const records = [
    base,
    {...base, trial: 2, rawChars: 40000, projectedChars: 6000, apiMs: 430, elapsedMs: 1000, executedActions: 1, choice: 'a0'},
    {...base, variant: 'warm', trial: 1, rawChars: 42000, projectedChars: 6800, cacheHit: true, apiMs: 390, elapsedMs: 900, executedActions: 2, verification: 'blocked'},
    {...base, variant: 'warm', trial: 2, rawChars: 40000, projectedChars: 6000, cacheHit: true, apiMs: 400, elapsedMs: 950, executedActions: 3, verification: 'fail', choice: 'BLOCKED'},
  ];
  const summary = summarize(records);
  assert.equal(summary.overall.count, 4);
  assert.equal(summary.overall.medianRawChars, 41000);
  assert.equal(summary.overall.medianProjectedChars, 6400);
  assert.equal(summary.overall.executedActions, 8);
  assert.deepEqual(summary.overall.choices, {a0: 1, BLOCKED: 1, DONE: 2});
  assert.deepEqual(summary.overall.verification, {pass: 2, fail: 1, blocked: 1});
  assert.equal(summary.byProperty['ideal-fukushima'].byVariant.warm.count, 2);
  assert.ok(summary.overall.reductionPct > 80);
  const markdown = formatMarkdown(summary);
  assert.match(markdown, /Median projected/);
  assert.match(markdown, /ideal-fukushima/);
  assert.doesNotMatch(markdown, /https?:\/\//);
  assert.doesNotMatch(markdown, /footer noise|Room size|Children/);
});
