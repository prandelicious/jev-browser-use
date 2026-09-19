#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const PROPERTIES = new Set(['ideal-fukushima', '36m2-japanese-style-4ppl-private-house']);
const VARIANTS = new Set(['cold', 'warm']);
const VERIFICATIONS = new Set(['pass', 'fail', 'blocked']);
const REQUIRED = ['property', 'variant', 'trial', 'rawChars', 'projectedChars', 'cacheHit', 'apiMs', 'elapsedMs', 'executedActions', 'choice', 'verification'];

export function validateRecords(records) {
  if (!Array.isArray(records) || !records.length) throw new Error('Invalid A/B records');
  return records.map(record => {
    if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).sort().join('|') !== [...REQUIRED].sort().join('|')) throw new Error('Invalid A/B record');
    if (!PROPERTIES.has(record.property) || !VARIANTS.has(record.variant) || !VERIFICATIONS.has(record.verification)) throw new Error('Invalid A/B record');
    if (!Number.isInteger(record.trial) || record.trial < 1 || !Number.isFinite(record.rawChars) || record.rawChars < 1 || !Number.isFinite(record.projectedChars) || record.projectedChars < 1 || record.projectedChars > record.rawChars || !Number.isFinite(record.apiMs) || record.apiMs < 0 || !Number.isFinite(record.elapsedMs) || record.elapsedMs < 0 || !Number.isInteger(record.executedActions) || record.executedActions < 0 || typeof record.cacheHit !== 'boolean' || typeof record.choice !== 'string' || !/^(?:DONE|BLOCKED|WAIT|a\d+)$/.test(record.choice)) throw new Error('Invalid A/B record');
    if (record.variant === 'warm' && !record.cacheHit) throw new Error('Invalid A/B record');
    return {...record};
  });
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function round(value) {
  return Number(value.toFixed(1));
}

function aggregate(records) {
  const choices = {};
  const verification = {pass:0, fail:0, blocked:0};
  for (const record of records) {
    choices[record.choice] = (choices[record.choice] ?? 0) + 1;
    verification[record.verification] += 1;
  }
  return {
    count: records.length,
    medianRawChars: median(records.map(record => record.rawChars)),
    medianProjectedChars: median(records.map(record => record.projectedChars)),
    reductionPct: round((1 - median(records.map(record => record.projectedChars)) / median(records.map(record => record.rawChars))) * 100),
    medianApiMs: median(records.map(record => record.apiMs)),
    medianElapsedMs: median(records.map(record => record.elapsedMs)),
    executedActions: records.reduce((total, record) => total + record.executedActions, 0),
    choices: Object.fromEntries(Object.entries(choices).sort(([a], [b]) => a.localeCompare(b))),
    verification,
  };
}

export function summarize(records) {
  const valid = validateRecords(records);
  const byProperty = {};
  for (const property of [...PROPERTIES].sort()) {
    const propertyRecords = valid.filter(record => record.property === property);
    if (!propertyRecords.length) continue;
    const byVariant = {};
    for (const variant of ['cold', 'warm']) {
      const variantRecords = propertyRecords.filter(record => record.variant === variant);
      if (variantRecords.length) byVariant[variant] = aggregate(variantRecords);
    }
    byProperty[property] = {count:propertyRecords.length, byVariant, overall:aggregate(propertyRecords)};
  }
  return {overall:aggregate(valid), byProperty};
}

function choicesText(choices) {
  return Object.entries(choices).map(([choice, count]) => `${choice}=${count}`).join(', ');
}

export function formatMarkdown(summary) {
  const rows = [];
  for (const [property, propertySummary] of Object.entries(summary.byProperty)) {
    for (const [variant, metrics] of Object.entries(propertySummary.byVariant)) {
      rows.push(`| ${property} | ${variant} | ${metrics.count} | ${metrics.medianRawChars} | ${metrics.medianProjectedChars} | ${metrics.reductionPct}% | ${metrics.medianApiMs} | ${metrics.medianElapsedMs} | ${metrics.executedActions} | ${metrics.verification.pass} | ${metrics.verification.fail} | ${metrics.verification.blocked} |`);
    }
  }
  const overall = summary.overall;
  return [
    '# Agoda A/B summary',
    '',
    '| Property | Variant | Count | Median raw | Median projected | Reduction | Median API ms | Median elapsed ms | Executed actions | Pass | Fail | Blocked |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
    '',
    `Overall: ${overall.count} trials; median reduction ${overall.reductionPct}%; choices: ${choicesText(overall.choices)}.`,
    '',
  ].join('\n');
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  const path = process.argv[2];
  if (!path) throw new Error('Usage: node scripts/summarize-agoda-ab.mjs <jsonl>');
  const text = await readFile(path, 'utf8');
  const records = text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  process.stdout.write(`${formatMarkdown(summarize(records))}\n`);
}
