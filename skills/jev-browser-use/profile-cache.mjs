import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const PROFILE_VERSION = 1;
export const PROFILE_FAMILY = 'agoda-property-v1';
export const MAX_PROFILE_BYTES = 8192;
export const PROFILE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const DEFAULT_CACHE_DIR = join(homedir(), '.cache', 'jev-browser-use', 'profiles');
const RUNTIME_PID = globalThis.process?.pid ?? 0;
const RUNTIME_PLATFORM = globalThis.process?.platform ?? 'unknown';
const VOCABULARY = [
  'overview', 'rooms', 'room', 'room size', 'bed', 'beds', 'facilities',
  'reviews', 'location', 'policies', 'property policies', 'children',
  'child', 'infant', 'age', 'guests', 'occupancy', 'check-in',
  'check-out', 'family room',
];
const ALLOWED_TERMS = new Set(VOCABULARY);
const COLD_TERMS = ['rooms', 'room', 'policies', 'children', 'child', 'age', 'guests', 'occupancy', 'check-in', 'check-out'];
const STOP_WORDS = new Set(['the', 'a', 'an', 'to', 'for', 'of', 'and', 'or', 'with', 'check', 'find', 'show', 'open']);
const PROPERTY_PATH = /(?:[a-z]{2}-[a-z]{2}\/)?[^/]+\/hotel\/[^/]+\.html$/i;

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value ? null : parsed;
}

function profileUrl(value) {
  if (typeof value !== 'string') return null;
  const header = value.match(/^Browser tab:.*?URL: "([^\"]+)"\.?$/m);
  return header?.[1] ?? value;
}

function isAgodaPropertyUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'agoda.com' || url.hostname.endsWith('.agoda.com')) && PROPERTY_PATH.test(url.pathname);
  } catch {
    return false;
  }
}

export function profileKey(urlOrSnapshot) {
  const url = profileUrl(urlOrSnapshot);
  if (!isAgodaPropertyUrl(url)) return null;
  return createHash('sha256').update(PROFILE_FAMILY).digest('hex');
}

export function seedProfile(now = new Date()) {
  const stamp = new Date(now).toISOString();
  return { version: PROFILE_VERSION, family: PROFILE_FAMILY, observedTerms: [], createdAt: stamp, updatedAt: stamp };
}

function termPattern(term) {
  return new RegExp(`(?<![a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'i');
}

export function mergeObservedTerms(profile, snapshot, now = new Date()) {
  const base = validateProfile(profile, now) ?? seedProfile(now);
  const text = typeof snapshot === 'string' ? snapshot.toLowerCase() : '';
  const observed = new Set(base.observedTerms);
  for (const term of VOCABULARY) if (termPattern(term).test(text)) observed.add(term);
  return {
    ...base,
    observedTerms: [...observed].sort(),
    updatedAt: new Date(now).toISOString(),
  };
}

export function validateProfile(value, now = new Date()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort().join('|');
  if (keys !== 'createdAt|family|observedTerms|updatedAt|version') return null;
  if (value.version !== PROFILE_VERSION || value.family !== PROFILE_FAMILY || !Array.isArray(value.observedTerms)) return null;
  if (value.observedTerms.some(term => typeof term !== 'string' || !ALLOWED_TERMS.has(term))) return null;
  const terms = [...value.observedTerms].sort();
  if (terms.some((term, index) => terms[index - 1] === term) || terms.join('|') !== value.observedTerms.join('|')) return null;
  const createdAt = timestamp(value.createdAt);
  const updatedAt = timestamp(value.updatedAt);
  const current = new Date(now);
  if (!createdAt || !updatedAt || createdAt > updatedAt || updatedAt.getTime() > current.getTime() + 5 * 60 * 1000) return null;
  if (current.getTime() - updatedAt.getTime() > PROFILE_TTL_MS) return null;
  return value;
}

function validKey(key) {
  return typeof key === 'string' && /^[a-f0-9]{64}$/.test(key);
}

function cachePath(cacheDir, key) {
  return join(cacheDir, `${key}.json`);
}

export async function loadProfile(key, options = {}) {
  if (!validKey(key)) return { profile: null, hit: false, reason: 'invalid_key' };
  const cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
  const now = options.now ?? new Date();
  try {
    const file = cachePath(cacheDir, key);
    const info = await stat(file);
    if (info.size > MAX_PROFILE_BYTES) return { profile: null, hit: false, reason: 'oversized' };
    const raw = await readFile(file, 'utf8');
    let value;
    try { value = JSON.parse(raw); } catch { return { profile: null, hit: false, reason: 'malformed' }; }
    const profile = validateProfile(value, now);
    return profile ? { profile, hit: true, reason: 'hit' } : { profile: null, hit: false, reason: 'invalid' };
  } catch (error) {
    return { profile: null, hit: false, reason: error?.code === 'ENOENT' ? 'miss' : 'read_failed' };
  }
}

export async function saveProfile(key, profile, options = {}) {
  if (!validKey(key)) return { written: false, reason: 'invalid_key' };
  const now = options.now ?? new Date();
  const valid = validateProfile(profile, now);
  if (!valid) return { written: false, reason: 'invalid_profile' };
  const cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
  const temp = join(cacheDir, `${key}.${RUNTIME_PID}.${randomUUID()}.tmp`);
  try {
    await mkdir(cacheDir, {recursive: true, mode: 0o700});
    if (RUNTIME_PLATFORM !== 'win32') await chmod(cacheDir, 0o700);
    await writeFile(temp, `${JSON.stringify(valid)}\n`, {flag: 'wx', mode: 0o600});
    if (RUNTIME_PLATFORM !== 'win32') await chmod(temp, 0o600);
    await rename(temp, cachePath(cacheDir, key));
    return { written: true };
  } catch (error) {
    return { written: false, reason: error?.code ?? 'write_failed' };
  } finally {
    try { await unlink(temp); } catch {}
  }
}

function numericActionIndices(actions) {
  const indices = new Set();
  for (const action of Array.isArray(actions) ? actions : []) {
    if (Number.isInteger(action?.index)) indices.add(action.index);
    if (Number.isInteger(action?.target)) indices.add(action.target);
  }
  return indices;
}

function lineIndex(line) {
  const match = line.match(/^(\d+)\s/);
  return match ? Number(match[1]) : null;
}

function goalTerms(goal) {
  const terms = new Set();
  const tokens = typeof goal === 'string' ? goal.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [] : [];
  for (const token of tokens) if (token.length >= 3 && !STOP_WORDS.has(token)) terms.add(token);
  return terms;
}

export function projectState(snapshot, {goal, actions, profile, maxChars = 20000} = {}) {
  if (typeof snapshot !== 'string' || !Number.isInteger(maxChars) || maxChars < 1) throw new Error('Invalid projection input');
  const lines = snapshot.split('\n');
  const actionIndices = numericActionIndices(actions);
  const terms = new Set([...goalTerms(goal), ...(profile?.observedTerms ?? []), ...COLD_TERMS]);
  const normalized = lines.map(line => line.toLowerCase());
  const selected = new Set();
  for (let index = 0; index < lines.length; index++) {
    const isHeader = lines[index].startsWith('Browser tab:');
    const isAction = actionIndices.has(lineIndex(lines[index]));
    const isMatch = terms.size > 0 && [...terms].some(term => termPattern(term).test(normalized[index]));
    if (isHeader || isAction || isMatch) {
      for (const nearby of [index - 1, index, index + 1]) if (nearby >= 0 && nearby < lines.length) selected.add(nearby);
    }
  }
  for (const index of lines.map((line, i) => [line, i]).filter(([line]) => line.startsWith('Browser tab:')).map(([, i]) => i)) selected.add(index);
  const protectedIndices = new Set(lines.map((line, index) => [lineIndex(line), index]).filter(([number]) => actionIndices.has(number)).map(([, index]) => index));
  const uniqueLines = new Set();
  const ordered = [...selected].sort((a, b) => a - b).map(index => {
    const value = lines[index].slice(0, 500);
    if (uniqueLines.has(value)) return null;
    uniqueLines.add(value);
    return {index, value, protected: protectedIndices.has(index)};
  }).filter(Boolean);
  const mandatory = ordered.filter(item => item.protected || lines[item.index].startsWith('Browser tab:'));
  const mandatoryLength = mandatory.reduce((total, item, index) => total + item.value.length + (index ? 1 : 0), 0);
  if (mandatoryLength > maxChars) throw new Error('Projection exceeds safe limit');
  const output = [];
  let length = 0;
  let truncated = false;
  for (const item of ordered) {
    const nextLength = length + item.value.length + (output.length ? 1 : 0);
    if (nextLength <= maxChars) {
      output.push(item.value);
      length = nextLength;
      continue;
    }
    truncated = true;
    break;
  }
  if (truncated) {
    const marker = '[projection truncated]';
    while (output.length && output.join('\n').length + 1 + marker.length > maxChars && !mandatory.some(item => output.includes(item.value) && item.protected)) output.pop();
    const candidate = output.length ? `${output.join('\n')}\n${marker}` : marker;
    if (candidate.length > maxChars) throw new Error('Projection exceeds safe limit');
    return candidate;
  }
  return output.join('\n');
}

function axRole(line) {
  return line.trim().match(/^\d+ ([\w]+)(?: \([^)]*\))? /)?.[1] ?? null;
}

function originHeader(snapshot) {
  const value = profileUrl(snapshot);
  try {
    const url = new URL(value);
    const site = url.hostname.replace(/^www\./i, '').split('.')[0];
    return `Browser tab: ${site.charAt(0).toUpperCase()}${site.slice(1)} (origin ${url.origin}).`;
  } catch {
    throw new Error('Invalid origin projection input');
  }
}

function directEvidencePatterns(goal) {
  const text = typeof goal === 'string' ? goal.toLowerCase() : '';
  const patterns = [];
  if (/\broom\s+size\b/.test(text)) patterns.push(/room\s+size/i);
  if (/\bchild(?:ren)?\b/.test(text)) patterns.push(/child(?:ren)?/i);
  if (/\bpolic(?:y|ies)\b/.test(text)) patterns.push(/polic(?:y|ies)/i);
  if (/\bage\b/.test(text)) patterns.push(/\bage\b/i);
  if (/\bcheck[- ]?in\b/.test(text)) patterns.push(/check[- ]?in/i);
  if (/\bcheck[- ]?out\b/.test(text)) patterns.push(/check[- ]?out/i);
  if (/\boccupancy\b/.test(text)) patterns.push(/occupancy/i);
  if (/\bguests?\b/.test(text)) patterns.push(/guests?/i);
  if (/\bbeds?\b/.test(text)) patterns.push(/beds?/i);
  if (/\bfacilit(?:y|ies)\b/.test(text)) patterns.push(/facilit(?:y|ies)/i);
  if (/\breviews?\b/.test(text)) patterns.push(/reviews?/i);
  if (/\blocation\b/.test(text)) patterns.push(/location/i);
  return patterns;
}

export function projectOriginMinimizedState(snapshot, {goal, actions, maxChars = 20000} = {}) {
  if (typeof snapshot !== 'string' || !Number.isInteger(maxChars) || maxChars < 1) throw new Error('Invalid origin projection input');
  const header = originHeader(snapshot);
  const actionIndices = numericActionIndices(actions);
  const patterns = directEvidencePatterns(goal);
  const lines = snapshot.split('\n');
  const selected = lines.filter(line => {
    if (line.startsWith('Browser tab:') || actionIndices.has(lineIndex(line))) return true;
    const role = axRole(line);
    return role !== 'heading' && role !== 'container' && patterns.some(pattern => pattern.test(line));
  });
  const output = [header, ...uniqueLines(selected.filter(line => !line.startsWith('Browser tab:')))];
  const state = output.join('\n');
  if (state.length > maxChars) throw new Error('Origin projection exceeds safe limit');
  return state;
}

function semanticLine(line) {
  return line.replace(/^\d+\s+/, '').trim();
}

function projectionTerms(goal, profile) {
  return new Set([...goalTerms(goal), ...(profile?.observedTerms ?? []), ...COLD_TERMS]);
}

function relevantProjectionLine(line, terms, actionIndices) {
  if (line.startsWith('Browser tab:') || actionIndices.has(lineIndex(line))) return true;
  const normalized = line.toLowerCase();
  return [...terms].some(term => termPattern(term).test(normalized));
}

function uniqueLines(lines) {
  const seen = new Set();
  return lines.filter(line => {
    const key = semanticLine(line);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deltaText(header, context, added, removed, maxChars) {
  const output = [header, '[semantic delta]', '[current context]', ...context];
  if (added.length) output.push('[added or changed]', ...added.map(line => `+ ${line}`));
  if (removed.length) output.push('[removed]', ...removed.map(line => `- ${line}`));
  const state = output.join('\n');
  if (state.length > maxChars) throw new Error('Incremental projection exceeds safe limit');
  return state;
}

export function projectIncrementalState(currentSnapshot, previousSnapshot, {
  goal,
  actions,
  profile,
  maxChars = 20000,
  enabled = true,
  maxRatio = 0.65,
  projectionMode = 'full',
} = {}) {
  if (typeof currentSnapshot !== 'string' || (previousSnapshot !== null && typeof previousSnapshot !== 'string')) throw new Error('Invalid incremental state input');
  if (!Number.isFinite(maxRatio) || maxRatio < 0.1 || maxRatio > 1) throw new Error('Invalid incremental state ratio');
  const project = projectionMode === 'origin-minimized' ? projectOriginMinimizedState : projectState;
  if (projectionMode !== 'full' && projectionMode !== 'origin-minimized') throw new Error('Invalid projection mode');
  const full = project(currentSnapshot, {goal, actions, profile, maxChars});
  const fullProjectedChars = full.length;
  const fullResult = (deltaAddedChars = 0, deltaRemovedChars = 0) => ({state:full, mode:'full', fullProjectedChars, deltaAddedChars, deltaRemovedChars});
  if (!enabled || previousSnapshot === null) return fullResult();

  const previous = project(previousSnapshot, {goal, actions, profile, maxChars});
  const actionIndices = numericActionIndices(actions);
  const terms = projectionTerms(goal, profile);
  const currentLines = full.split('\n');
  const previousLines = previous.split('\n');
  const currentKeys = new Set(currentLines.map(semanticLine));
  const previousByKey = new Map(previousLines.map(line => [semanticLine(line), line]));
  const currentContext = uniqueLines(currentLines.filter(line => relevantProjectionLine(line, terms, actionIndices)));
  const contextKeys = new Set(currentContext.map(semanticLine));
  const added = uniqueLines(currentLines.filter(line => {
    const key = semanticLine(line);
    return !contextKeys.has(key) && previousByKey.get(key) !== line;
  }));
  const removed = uniqueLines(previousLines.filter(line => {
    const key = semanticLine(line);
    return relevantProjectionLine(line, terms, actionIndices) && !currentKeys.has(key);
  }));
  const deltaAddedChars = added.reduce((total, line) => total + line.length + 2, 0);
  const deltaRemovedChars = removed.reduce((total, line) => total + line.length + 2, 0);
  let state;
  try {
    state = deltaText(currentLines.find(line => line.startsWith('Browser tab:')) ?? '', currentContext.filter(line => !line.startsWith('Browser tab:')), added, removed, maxChars);
  } catch {
    return fullResult(deltaAddedChars, deltaRemovedChars);
  }
  if (!state || state.length >= fullProjectedChars * maxRatio) return fullResult(deltaAddedChars, deltaRemovedChars);
  return {state, mode:'delta', fullProjectedChars, deltaAddedChars, deltaRemovedChars};
}
