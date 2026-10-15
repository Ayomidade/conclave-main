const KEY = 'conclave-media-preferences';
const DEFAULTS = { images: true, video: false, documents: false };

export function getMediaPreferences() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return DEFAULTS; }
}

export function saveMediaPreferences(value) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...DEFAULTS, ...value })); } catch { /* device storage can be disabled */ }
}
