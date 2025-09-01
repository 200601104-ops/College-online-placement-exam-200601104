// api.js
export function setToken(t) { localStorage.setItem('token', t); }
export function getToken() { return localStorage.getItem('token'); }
export async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const token = getToken(); if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) { let m = res.statusText; try { const j = await res.json(); if (j.error) m = j.error; } catch {} throw new Error(m); }
  return res.json();
}
