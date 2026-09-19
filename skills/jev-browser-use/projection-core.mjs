const STOP_WORDS = new Set(['a', 'an', 'and', 'at', 'be', 'by', 'check', 'for', 'find', 'from', 'in', 'of', 'on', 'open', 'show', 'the', 'to', 'with']);

function lineIndex(line) { return Number(line.match(/^(\d+)\s/)?.[1] ?? NaN); }
function semanticLine(line) { return line.replace(/^\d+\s+/, '').trim(); }
function axRole(line) { return line.trim().match(/^\d+ ([\w]+)(?: \([^)]*\))? /)?.[1] ?? null; }
function escaped(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function termPattern(term) { return new RegExp(`(?<![a-z0-9])${escaped(term)}(?![a-z0-9])`, 'i'); }

function snapshotUrl(snapshot) {
  const header = snapshot.split('\n').find(line => line.startsWith('Browser tab:')) ?? '';
  return header.match(/URL:\s*"([^"]+)"/)?.[1] ?? null;
}

function originHeader(snapshot) {
  let url;
  try { url = new URL(snapshotUrl(snapshot)); } catch { throw new Error('Invalid origin projection input'); }
  if (url.protocol !== 'https:') throw new Error('Invalid origin projection input');
  const labels = url.hostname.replace(/^www\./i, '').split('.');
  const label = labels.length > 1 ? labels.at(-2) : labels[0];
  const site = label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : 'Site';
  return `Browser tab: ${site} (origin ${url.origin}).`;
}

function pageFromSnapshot(snapshot) {
  let url;
  try { url = new URL(snapshotUrl(snapshot)); } catch { throw new Error('Invalid origin projection input'); }
  if (url.protocol !== 'https:') throw new Error('Invalid origin projection input');
  const labels = url.hostname.replace(/^www\./i, '').split('.');
  const label = labels.length > 1 ? labels.at(-2) : labels[0];
  const site = label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : 'Site';
  return {site, origin:url.origin};
}

function normalizedNode(line, maxItemChars) {
  const match = line.trim().match(/^(\d+) (text field|text area|combo box|radio button|menu item|[\w]+)(?: \([^)]*\))? (?:Description: )?(.*)$/);
  if (!match) return null;
  const index = Number(match[1]);
  const role = match[2];
  const name = match[3].trim();
  if (!Number.isInteger(index) || !name) return null;
  return {index, role, name:name.slice(0, maxItemChars)};
}

export function normalizeAXState(snapshot, {maxItemChars = 320} = {}) {
  if (typeof snapshot !== 'string' || !Number.isInteger(maxItemChars) || maxItemChars < 1) throw new Error('Invalid normalization input');
  return {
    page: pageFromSnapshot(snapshot),
    nodes: snapshot.split('\n').map(line => normalizedNode(line, maxItemChars)).filter(Boolean),
  };
}

export function goalTerms(goal) {
  const tokens = typeof goal === 'string' ? goal.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [] : [];
  const filtered = tokens.filter(token => token.length >= 3 && !STOP_WORDS.has(token));
  return [...new Set(filtered)];
}

function wordPattern(token) {
  if (token === 'child' || token === 'children') return /\bchild(?:ren)?\b/i;
  if (token === 'policy' || token === 'policies') return /\bpolic(?:y|ies)\b/i;
  return termPattern(token);
}

export function scoreEvidence(node, {goalTokens = [], goalPhrases = [], adapterHints = []} = {}) {
  const text = `${node?.role ?? ''} ${node?.name ?? ''}`;
  let score = 0;
  for (const phrase of goalPhrases) if (typeof phrase === 'string' && phrase && text.toLowerCase().includes(phrase.toLowerCase())) score += 12;
  for (const token of goalTokens) if (typeof token === 'string' && wordPattern(token).test(text)) score += 4;
  for (const hint of adapterHints) {
    const pattern = hint instanceof RegExp ? hint : typeof hint === 'string' ? termPattern(hint) : null;
    if (pattern) { pattern.lastIndex = 0; if (pattern.test(text)) score += 1; }
  }
  return score;
}

export function selectEvidence(nodes, {goal, adapterHints = [], maxItems = 40, maxPerSignature = 3} = {}) {
  if (!Array.isArray(nodes) || !Number.isInteger(maxItems) || maxItems < 0) throw new Error('Invalid evidence selection input');
  const goalTokens = goalTerms(goal);
  const goalPhrases = typeof goal === 'string' ? goal.toLowerCase().match(/[a-z0-9]+(?:\s+[a-z0-9]+){1,3}/g) ?? [] : [];
  const unique = [];
  const seen = new Set();
  for (const node of nodes) {
    const signature = `${node.role}\0${node.name.toLowerCase()}`;
    if (!seen.has(signature)) { seen.add(signature); unique.push(node); }
  }
  const scored = unique.map((node, order) => ({node, order, score:scoreEvidence(node, {goalTokens, goalPhrases, adapterHints})}));
  const selected = [];
  const signatures = new Map();
  const add = item => {
    const signature = `${item.node.role}\0${item.node.name.toLowerCase()}`;
    const count = signatures.get(signature) ?? 0;
    if (count >= maxPerSignature || selected.includes(item.node) || selected.length >= maxItems) return false;
    signatures.set(signature, count + 1);
    selected.push(item.node);
    return true;
  };
  for (const token of goalTokens) {
    const match = scored.filter(item => wordPattern(token).test(`${item.node.role} ${item.node.name}`))
      .sort((a,b) => b.score - a.score || a.order - b.order)[0];
    if (match) add(match);
  }
  for (const item of scored.sort((a,b) => b.score - a.score || a.order - b.order)) add(item);
  return selected;
}

export function goalEvidencePatterns(goal) {
  const tokens = typeof goal === 'string' ? goal.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [] : [];
  return [...new Set(tokens.filter(token => token.length >= 4 && !STOP_WORDS.has(token)).map(token => {
    if (token === 'child') return /\bchild(?:ren)?\b/i;
    if (token === 'policy') return /\bpolic(?:y|ies)\b/i;
    return termPattern(token);
  }))];
}

function matchesEvidence(line, patterns) {
  return patterns.some(pattern => {
    if (pattern instanceof RegExp) { pattern.lastIndex = 0; return pattern.test(line); }
    return typeof pattern === 'string' && termPattern(pattern).test(line);
  });
}

export function projectEvidenceLanes(snapshot, {goal, actions, evidencePatterns = [], maxChars = 20000} = {}) {
  if (typeof snapshot !== 'string' || !Number.isInteger(maxChars) || maxChars < 1) throw new Error('Invalid projection input');
  const lines = snapshot.split('\n');
  const actionIndices = new Set((Array.isArray(actions) ? actions : []).flatMap(action => [action?.index, action?.target]).filter(Number.isInteger));
  const patterns = [...goalEvidencePatterns(goal), ...(Array.isArray(evidencePatterns) ? evidencePatterns : [])];
  const selected = [];
  const seen = new Set();
  for (const line of lines) {
    const index = lineIndex(line);
    const role = axRole(line);
    if (!actionIndices.has(index) && (role === 'heading' || role === 'container' || !matchesEvidence(line, patterns))) continue;
    const key = semanticLine(line);
    if (!seen.has(key)) { seen.add(key); selected.push(line); }
  }
  const state = [originHeader(snapshot), ...selected.filter(line => !line.startsWith('Browser tab:'))].join('\n');
  if (state.length > maxChars) throw new Error('Projection exceeds safe limit');
  return state;
}
