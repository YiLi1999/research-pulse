// Only public-paper notes and reports belong here. Credentials are never accepted.
export function createAnalysisStorage(indexedDB = globalThis.indexedDB) {
  const fallback = new Map();
  let connection;
  async function open() {
    if (!indexedDB) return null;
    connection ||= new Promise((resolve, reject) => {
      const request = indexedDB.open("research-pulse-analysis", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("results");
      request.onerror = () => reject(new Error("Browser cache unavailable"));
      request.onblocked = () => reject(new Error("Browser cache blocked"));
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); connection = undefined; };
        try {
          const tx = db.transaction("results", "readwrite");
          const cursor = tx.objectStore("results").openCursor();
          cursor.onsuccess = () => {
            const row = cursor.result;
            if (row) { if (Date.now() - row.value.savedAt > 30 * 86400000) row.delete(); row.continue(); }
          };
          tx.oncomplete = () => resolve(db);
          tx.onerror = tx.onabort = () => resolve(db);
        } catch { resolve(null); }
      };
    }).catch(() => null);
    return connection;
  }
  async function get(key) {
    const db = await open();
    let entry = fallback.get(key);
    if (db) entry = await new Promise(resolve => {
      try {
        const tx = db.transaction("results", "readonly");
        const request = tx.objectStore("results").get(key);
        request.onsuccess = () => {
          const disk = request.result;
          resolve(!disk || (entry && entry.savedAt >= disk.savedAt) ? entry : disk);
        };
        request.onerror = () => resolve(entry);
        tx.onabort = () => resolve(entry);
      } catch { resolve(entry); }
    });
    return entry && Date.now() - entry.savedAt <= 30 * 86400000 ? entry.value : null;
  }
  async function set(key, value) {
    const entry = { savedAt: Date.now(), value };
    const db = await open();
    if (!db) { fallback.set(key, entry); return false; }
    const saved = await new Promise(resolve => {
      try {
        const tx = db.transaction("results", "readwrite");
        tx.objectStore("results").put(entry, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = tx.onabort = () => resolve(false);
      } catch { resolve(false); }
    });
    if (!saved) fallback.set(key, entry);
    else fallback.delete(key);
    return saved;
  }
  return { get, set };
}
