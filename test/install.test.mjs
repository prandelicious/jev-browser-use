import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { install } from '../scripts/install.mjs';

test('installer includes the bridge, profile, and projection modules', async () => {
  const home = await mkdtemp(join(tmpdir(), 'jev-install-'));
  const source = new URL('..', import.meta.url).pathname;
  const result = await install({source, home});
  await stat(join(result.target, 'bridge.mjs'));
  await stat(join(result.target, 'profile-cache.mjs'));
  await stat(join(result.target, 'projection-core.mjs'));
  await stat(join(result.target, 'projection-adapters.mjs'));
});
