import { projectEvidenceLanes, goalEvidencePatterns } from './projection-core.mjs';
import { profileKey } from './profile-cache.mjs';

const AGODA_ALIASES = [/room\s+size/i, /child(?:ren)?/i, /polic(?:y|ies)/i, /occupancy/i, /guests?/i, /check[- ]?in/i, /check[- ]?out/i];
const genericAdapter = { id: 'generic-origin-v1', cacheFamily: null, profileCacheEnabled: false, evidencePatterns: goalEvidencePatterns, project(snapshot, options = {}) { return projectEvidenceLanes(snapshot, {...options, evidencePatterns: goalEvidencePatterns(options.goal)}); } };
const agodaAdapter = { id: 'agoda-property-v1', cacheFamily: 'agoda-property-v1', profileCacheEnabled: true, evidencePatterns(goal) { return [...goalEvidencePatterns(goal), ...AGODA_ALIASES]; }, project(snapshot, options = {}) { return projectEvidenceLanes(snapshot, {...options, evidencePatterns: this.evidencePatterns(options.goal)}); } };
const rawAdapter = { id: 'raw', cacheFamily: null, profileCacheEnabled: false, evidencePatterns: () => [], project(snapshot) { return snapshot; } };

export function selectProjectionAdapter(snapshot) {
  if (profileKey(snapshot)) return agodaAdapter;
  try {
    const header = snapshot.split('\n').find(line => line.startsWith('Browser tab:')) ?? '';
    if (new URL(header.match(/URL:\s*"([^"]+)"/)?.[1]).protocol === 'https:') return genericAdapter;
  } catch {}
  return rawAdapter;
}
