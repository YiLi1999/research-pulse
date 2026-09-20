import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config/index.js';
import { createVisitorScoring } from './visitorScoring.js';

test('visitor ranking settings persist separately without modifying shared papers or owner defaults', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'visitor-scoring-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const ownerWeights = { ...config.scoring.keywordWeights };
  const sharedPapers = [{ id: 'magic', title: 'Magic' }, { id: 'entanglement', title: 'Entanglement' }];
  const originalPapers = structuredClone(sharedPapers);
  const defaults = async () => ({ keywordWeights: { entanglement: 1 } });
  const scoring = createVisitorScoring({ directory, defaults });
  const visitorA = 'visitor-a', visitorB = 'visitor-b';
  assert.deepEqual((await scoring.get(visitorA)).keywordWeights, { entanglement: 1 });
  assert.equal((await scoring.save(visitorA, { magic: 10 }, sharedPapers)).papers[0].id, 'magic');
  assert.deepEqual((await scoring.get(visitorB)).keywordWeights, { entanglement: 1 });
  assert.equal((await scoring.save(visitorB, { entanglement: 20 }, sharedPapers)).papers[0].id, 'entanglement');
  const restarted = createVisitorScoring({ directory, defaults });
  assert.deepEqual((await restarted.get(visitorA)).keywordWeights, { magic: 10 });
  assert.deepEqual((await restarted.get(visitorB)).keywordWeights, { entanglement: 20 });
  assert.deepEqual(sharedPapers, originalPapers);
  assert.deepEqual(config.scoring.keywordWeights, ownerWeights);
  const files = await readdir(directory);
  assert.equal(files.length, 2);
  assert.ok(files.every(file => /^[a-f0-9]{64}\.json$/.test(file)));
  for (const file of files) assert.deepEqual(Object.keys(JSON.parse(await readFile(path.join(directory, file), 'utf8'))), ['keywordWeights']);
});

test('invalid settings preserve existing visitor ranking while an explicit empty object clears it', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'visitor-scoring-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const scoring = createVisitorScoring({ directory, defaults: async () => ({ keywordWeights: {} }) });
  await scoring.save('visitor', { magic: 3 }, []);
  for (const invalid of [undefined, null, [], { magic: -1 }, { magic: '3' }]) {
    await assert.rejects(scoring.save('visitor', invalid, []), error => error.statusCode === 400);
    assert.deepEqual((await scoring.get('visitor')).keywordWeights, { magic: 3 });
  }
  await scoring.save('visitor', {}, []);
  assert.deepEqual((await scoring.get('visitor')).keywordWeights, {});
});
