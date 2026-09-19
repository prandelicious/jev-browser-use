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
  const site = label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : host;
  return `Browser tab: ${site} (origin ${url.origin}).`;
}

export function goalEvidencePatterns(goal) {
  const tokens = typeof goal === 'string' ? goal.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [] : [];
  return [...new Set(tokens.filter(token => token.length >= 4 && !STOP_WORDS.has(token)).map(token => {
    if (token === 'child') return /\bchildren?\b/i;
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
