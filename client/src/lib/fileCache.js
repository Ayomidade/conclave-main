/**
 * A local, bounded copy of attachment bytes.
 *
 * IndexedDB rather than localStorage. The two reasons are not decorative:
 * localStorage only stores strings, so every file would be base64'd and grow
 * by a third before it is stored, and it is synchronously limited to a few
 * megabytes per origin — one 25MB upload would fill it. IndexedDB stores
 * `Blob`s as they are, asynchronously, and does not have that ceiling.
 *
 * The key is the file's URL, not its attachment id. The same Cloudinary asset
 * can be reached through two ids (a message and its decision copy, for one),
 * and the URL is also the only key the sender has at upload time, before any
 * message row exists. One key, two callers, no reconciliation step.
 *
 * The store is capped by bytes, not by count: entries are `Blob`s of wildly
 * different sizes, so a record limit would let a handful of videos occupy the
 * whole budget. Eviction is least-recently-*used* rather than oldest-inserted —
 * `lastUsedAt` is touched on every read, so a conversation the user scrolls
 * past daily keeps its images while a month-old PDF falls out.
 *
 * Everything is best-effort. Private modes, storage pressure and quota errors
 * all degrade to "no cache", never to a failed render: a file the user can see
 * but not open is worse than one that re-downloads.
 */

const DB_NAME = "conclave-files";
const MAX_BYTES = 250 * 1024 * 1024;

// Blobs and their bookkeeping live in separate stores. Marking a file as
// recently used then rewrites a few bytes of metadata, not the whole file.
let dbPromise = null;

function open() {
  if (typeof indexedDB === "undefined")
    return Promise.reject(new Error("IndexedDB unavailable"));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("files", { keyPath: "key" });
        request.result.createObjectStore("meta", { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error);
      };
    });
  }
  return dbPromise;
}

function transact(stores, mode, work) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(stores, mode);
        const out = work(transaction);
        transaction.oncomplete = () =>
          resolve(out && "result" in out ? out.result : out);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      }),
  );
}

let persistAsked = false;
function askToPersist() {
  if (persistAsked) return;
  persistAsked = true;
  navigator.storage?.persist?.().catch(() => {});
}

/** The stored file for this key, or null. Never throws: the cache is best effort. */
export async function readLocalFile(key) {
  if (!key) return null;
  try {
    const record = await transact(["files"], "readonly", (t) =>
      t.objectStore("files").get(key),
    );
    if (!record) return null;

    // Touch so eviction drops what is untouched, not what is popular.
    transact(["meta"], "readwrite", (t) => {
      const store = t.objectStore("meta");
      const request = store.get(key);
      request.onsuccess = () => {
        if (request.result)
          store.put({ ...request.result, lastUsed: Date.now() });
      };
    }).catch(() => {});

    return record.blob;
  } catch {
    return null;
  }
}

/** Store a file. Resolves once it is written, and swallows quota errors. */
export async function saveLocalFile(key, blob, info = {}) {
  if (!key || !blob) return;
  try {
    askToPersist();
    await transact(["files", "meta"], "readwrite", (t) => {
      t.objectStore("files").put({ key, blob });
      t.objectStore("meta").put({
        key,
        size: blob.size,
        filename: info.filename || null,
        mime: info.mime || blob.type || null,
        lastUsed: Date.now(),
      });
    });
    await trim();
  } catch {
    // Quota exceeded or storage blocked. The file will simply be fetched next time.
  }
}

async function trim(maxBytes = MAX_BYTES) {
  const all = await transact(["meta"], "readonly", (t) =>
    t.objectStore("meta").getAll(),
  );
  let total = all.reduce((sum, entry) => sum + (entry.size || 0), 0);
  if (total <= maxBytes) return;

  const oldestFirst = [...all].sort((a, b) => a.lastUsed - b.lastUsed);
  const drop = [];
  for (const entry of oldestFirst) {
    if (total <= maxBytes) break;
    drop.push(entry.key);
    total -= entry.size || 0;
  }

  await transact(["files", "meta"], "readwrite", (t) => {
    drop.forEach((key) => {
      t.objectStore("files").delete(key);
      t.objectStore("meta").delete(key);
    });
  });
}

export async function localFileUsage() {
  try {
    const all = await transact(["meta"], "readonly", (t) =>
      t.objectStore("meta").getAll(),
    );
    return all.reduce((sum, entry) => sum + (entry.size || 0), 0);
  } catch {
    return 0;
  }
}

/** For logout and for a "clear downloaded media" button in Settings. */
export async function clearLocalFiles() {
  try {
    await transact(["files", "meta"], "readwrite", (t) => {
      t.objectStore("files").clear();
      t.objectStore("meta").clear();
    });
  } catch {
    // Nothing stored, or storage unavailable.
  }
}