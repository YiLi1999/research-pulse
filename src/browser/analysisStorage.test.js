import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalysisStorage } from './analysisStorage.js';

test('blocked browser storage keeps current-page results without claiming persistence', async () => {
  const storage = createAnalysisStorage(null);
  assert.equal(await storage.set('paper:one', [{ question: 'Question?', focus: 'Evidence' }]), false);
  assert.deepEqual(await storage.get('paper:one'), [{ question: 'Question?', focus: 'Evidence' }]);
  assert.equal(await storage.get('missing'), null);
});

test('failed disk writes prefer fresh memory results to old disk entries, including closed databases', async () => {
  let closed = false;
  const records = new Map([['report:one', { savedAt: Date.now() - 100000, value: { summary: 'old' } }]]);
  const indexedDB = { open() {
    const request = { result: { transaction() {
      if (closed) throw new Error('database closed');
      const tx = { objectStore: () => ({
        openCursor() { const cursor = { result: null }; queueMicrotask(() => { cursor.onsuccess(); tx.oncomplete(); }); return cursor; },
        get(key) { const entry = { result: records.get(key) }; queueMicrotask(() => entry.onsuccess()); return entry; },
        put() { queueMicrotask(() => tx.onabort()); }
      }) };
      return tx;
    } } };
    queueMicrotask(() => request.onsuccess()); return request;
  } };
  const storage = createAnalysisStorage(indexedDB);
  assert.deepEqual(await storage.get('report:one'), { summary: 'old' });
  assert.equal(await storage.set('report:one', { summary: 'fresh' }), false);
  assert.deepEqual(await storage.get('report:one'), { summary: 'fresh' });
  closed = true;
  assert.equal(await storage.set('paper:two', []), false);
  assert.deepEqual(await storage.get('paper:two'), []);
  assert.deepEqual(await storage.get('report:one'), { summary: 'fresh' });
});
