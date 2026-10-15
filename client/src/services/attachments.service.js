import { api } from "../lib/api";
import { readLocalFile, saveLocalFile } from "../lib/fileCache";
import { getMediaPreferences } from "../lib/mediaPreferences";

/**
 * Fetching an attachment.
 *
 * Two levels in front of the network: a synchronous module-level map of
 * promises, and the IndexedDB store in `fileCache`. The map exists because the
 * same image is requested many times in one session — every re-render of a
 * message row restarts its effect — and an IDB round trip, however fast, is
 * still async work per render. The store exists because the map dies with the
 * tab. Neither is a correctness concern: a miss falls through to the network,
 * which is where the file lives anyway.
 *
 * Documents are still fetched on click rather than prefetched. Prefetching
 * every PDF in a transcript would spend the same budget the image cache is
 * designed to protect, on files nobody has asked to see.
 */

// url -> Promise<Blob>. Keyed by URL for the same reason as fileCache.
async function readError(error) {
  const data = error.response?.data;
  // With responseType "blob", a JSON error body arrives as a Blob.
  if (data instanceof Blob) {
    try {
      return JSON.parse(await data.text()).message;
    } catch {
      return null;
    }
  }
  return data?.message || null;
}

async function fetchFromServer(attachment, onProgress) {
  try {
    const response = await api.get(`/attachments/${attachment.id}`, {
      responseType: "blob",
      onDownloadProgress: (event) => {
        const total = event.total || attachment.size;
        if (total) onProgress?.(Math.min(1, event.loaded / total));
      },
    });
    return response.data;
  } catch (error) {
    throw new Error((await readError(error)) || "Could not load this file.");
  }
}

function shouldCacheAttachment(attachment) {
  const preferences = getMediaPreferences();
  const type = attachment.mime_type || '';
  if (type.startsWith('image/')) return preferences.images;
  if (type.startsWith('video/')) return preferences.video;
  return preferences.documents;
}

// One request per attachment at a time, however many components ask for it.
const inflight = new Map();

/**
 * The file's bytes, from this device when we have them, from the server
 * otherwise. Whatever the server returns is kept for next time. The key is the
 * attachment's `url`, which is unique per upload and identical for the sender
 * (who stored it at upload time) and for everyone who receives it.
 */
export function getAttachmentBlob(attachment, { onProgress } = {}) {
  const key = attachment.url || attachment.id;
  const existing = inflight.get(key);
  if (existing) {
    if (onProgress) existing.listeners.add(onProgress);
    return existing.promise;
  }

  const listeners = new Set(onProgress ? [onProgress] : []);
  const emit = (fraction) => listeners.forEach((listener) => listener(fraction));

  const promise = (async () => {
    const local = await readLocalFile(attachment.url);
    if (local) return local;

    const blob = await fetchFromServer(attachment, emit);
    if (attachment.url && shouldCacheAttachment(attachment)) {
      saveLocalFile(attachment.url, blob, {
        filename: attachment.filename,
        mime: attachment.mime_type,
      });
    }
    return blob;
  })().finally(() => inflight.delete(key));

  inflight.set(key, { promise, listeners });
  return promise;
}

/** The copy already on this device, or null. Never touches the network. */
export function getCachedAttachmentBlob(attachment) {
  return readLocalFile(attachment.url);
}

export async function getAttachmentStreamUrl(attachment) {
  const { data } = await api.get(`/attachments/${attachment.id}/url`);
  return data.data;
}

/**
 * Called by the composer right after a successful upload, before the message is
 * sent. Awaited, so the copy is on disk before the server's echo comes back and
 * the bubble finds it instead of downloading what we just uploaded.
 */
export function rememberUploadedFile(url, file) {
  return saveLocalFile(url, file, { filename: file.name, mime: file.type });
}

export async function downloadAttachment(attachment) {
  const blob = await getAttachmentBlob(attachment);
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = attachment.filename || "download";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
}
