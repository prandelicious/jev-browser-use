#!/usr/bin/env node
import { runE2E } from '../../tests/e2e/runner.mjs';

const code = await runE2E(process.argv.slice(2));
process.exit(code);
