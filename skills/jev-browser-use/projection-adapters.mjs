import { profileKey } from './profile-cache.mjs';

const AGODA_HINTS = [
  {concept:'room-size', pattern:/\broom\s+size\b/i, boost:2},
  {concept:'children-policy', pattern:/\bchild(?:ren)?\b|\bexisting bedding\b/i, boost:2},
  {concept:'occupancy', pattern:/\boccupancy\b|\bguests?\b/i, boost:1},
  {concept:'check-in-out', pattern:/\bcheck[- ]?(?:in|out)\b/i, boost:1},
  {concept:'facilities', pattern:/\bfacilit(?:y|ies)\b/i, boost:1},
];

function headerUrl(snapshot) {
  const line = typeof snapshot === 'string' ? snapshot.split('\n').find(item => item.startsWith('Browser tab:')) ?? '' : '';
  return line.match(/\bURL:\s*"([^"]+)"/)?.[1] ?? null;
}

const genericAdapter = Object.freeze({id:'generic-origin-v1', family:'generic-https', evidenceHints:[]});
const agodaAdapter = Object.freeze({id:'agoda-property-v1', family:'agoda-property', evidenceHints:AGODA_HINTS});

export function selectProjectionAdapter(snapshot) {
  const url = headerUrl(snapshot);
  if (url && profileKey(url)) return agodaAdapter;
  try {
    if (new URL(url).protocol === 'https:') return genericAdapter;
  } catch {}
  return Object.freeze({id:'raw-v1', family:'raw', evidenceHints:[]});
}
