import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The developer page lists the project's files; this keeps that list from going out of date
test('the developer page lists every file in lib/', () => {
  const page = fs.readFileSync(new URL('../public/dev.js', import.meta.url), 'utf8');
  const listed = new Set([...page.matchAll(/\['(lib\/[\w-]+\.js)'/g)].map((m) => m[1]));
  const files = fs.readdirSync(new URL('../lib/', import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => `lib/${f}`);
  const missing = files.filter((f) => !listed.has(f));
  assert.deepEqual(missing, [], `add these to FILES in public/dev.js: ${missing.join(', ')}`);
  const gone = [...listed].filter((f) => !files.includes(f));
  assert.deepEqual(gone, [], `these are listed in public/dev.js but no longer exist: ${gone.join(', ')}`);
});
