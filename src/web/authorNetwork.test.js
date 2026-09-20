import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

test('author network navigation, rendering module and CSS are removed', async () => {
  for (const name of ['index.html', 'app.js', 'styles.css']) {
    const source = await readFile(new URL(`./public/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /authorNetwork|networkCanvas|data-view="network"|id="network"|\.network-/);
  }
  await assert.rejects(access(new URL('./public/authorNetwork.js', import.meta.url)), { code: 'ENOENT' });
});
