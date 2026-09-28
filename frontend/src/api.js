// One place for every backend call.
//
// API base: VITE_API_URL if set, otherwise the same host the page was opened from, on
// port 8000. So a phone that opens http://10.80.79.72:5173/circle/<token> automatically
// talks to http://10.80.79.72:8000 with no configuration.
//
// Owner key: never baked into the bundle (anyone on the Wi-Fi could read it from the
// page source). Ramesh types it once on the unlock screen; it is kept in this browser.
export const API = (import.meta.env.VITE_API_URL || `${location.protocol}//${location.hostname}:8000`).replace(/\/$/, '');

const KEY_NAME = 'amanat_owner_key';
export const getKey = () => { try { return localStorage.getItem(KEY_NAME) || ''; } catch { return ''; } };
export const setKey = key => { try { key ? localStorage.setItem(KEY_NAME, key) : localStorage.removeItem(KEY_NAME); } catch { /* private mode: key lasts for this tab only */ } };

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function detailText(data, status) {
  const d = data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map(x => `${(x.loc || []).slice(1).join('.')}: ${x.msg}`).join('; ');
  return `Request failed (HTTP ${status})`;
}

export async function api(path, { method = 'GET', body, owner = true, timeout = 20000 } = {}) {
  const headers = {};
  if (owner && getKey()) headers['X-Amanat-Key'] = getKey();
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(API + path, { method, headers, body: payload, signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    if (e?.name === 'TimeoutError') throw new ApiError(0, 'The backend took too long to answer. Please try again.');
    throw new ApiError(0, `Can't reach the Amanat backend at ${API}. Is it running, and is this device on the same Wi-Fi?`);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, detailText(data, res.status));
  return data;
}

// Contact / family pages: the token in the URL is the credential, no owner key.
export const publicApi = (path, opts = {}) => api(path, { ...opts, owner: false });

// "http://10.80.79.72:5173/circle/abc" -> "/circle/abc" on whatever host this page is on,
// so links work from localhost, the laptop's IP, or a phone.
export const localLink = url => { try { const u = new URL(url); return location.origin + u.pathname; } catch { return url; } };
