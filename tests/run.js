/**
 * Simple test runner for geometry-studio-viewer
 * Runs all *.test.js files in this directory
 */

import { readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const testFiles = readdirSync(__dirname)
  .filter(f => f.endsWith('.test.js'))
  .map(f => resolve(__dirname, f));

if (testFiles.length === 0) {
  console.log('No test files found. Exiting successfully.');
  process.exit(0);
}

let passed = 0;
let failed = 0;
const failures = [];

for (const file of testFiles.sort()) {
  try {
    const mod = await import(file);
    const suite = mod.tests || [];
    const desc = mod.description || file;

    console.log(`\n▶ ${desc}`);
    console.log('─'.repeat(50));

    for (const t of suite) {
      try {
        await t.fn();
        console.log(`  ✓ ${t.name}`);
        passed++;
      } catch (err) {
        console.log(`  ✗ ${t.name}`);
        console.log(`    ${err.message}`);
        failed++;
        failures.push({ file, test: t.name, error: err.message });
      }
    }
  } catch (err) {
    console.error(`  ✗ Failed to load ${file}: ${err.message}`);
    failed++;
  }
}

console.log('\n' + '═'.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('═'.repeat(50));

if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  ${f.file} › ${f.test}`);
    console.log(`    ${f.error}`);
  }
  process.exit(1);
}

process.exit(0);