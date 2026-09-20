import { fetchText } from '../utils/http.js';

let pending = Promise.resolve(), lastRequest = 0;
// One shared queue also spaces retries and requests from overlapping refreshes.
export function fetchArxivText(url) {
  const task = pending.then(async () => {
    const delay = Math.max(0, 3100 - (Date.now() - lastRequest));
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    lastRequest = Date.now();
    return fetchText(url);
  });
  pending = task.catch(() => {});
  return task;
}
