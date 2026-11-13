// Outbox: writes made with no signal wait here and send themselves later.
// Only writes that are safe to send late go in: notes, problem reports, clock
// events (the server de-duplicates by key) and photos. Money never queues.
// This app keeps its own queue; it never touches the current Trade App's.
import { api, putFile, ApiError } from './api.js';
import { getState, setState, local, invalidate } from './store.js';

const KEY = 'outbox';
const DB_NAME = 'crew-outbox';
let flushing = false;
const listeners = new Set();

function read() { return local.get(KEY, []); }
function write(items) { local.set(KEY, items); setState({ outbox: items.length }); listeners.forEach((fn) => fn()); }
export function outboxItems() { return read(); }
export function onOutbox(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function uid() { return (crypto.randomUUID ? crypto.randomUUID() : 'ob-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)); }

// ----- blobs (photos) live in IndexedDB; the list entry only holds the key -----
function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('blobs');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function blobPut(id, blob) { const d = await db(); return new Promise((res, rej) => { const tx = d.transaction('blobs', 'readwrite'); tx.objectStore('blobs').put(blob, id); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); }
async function blobGet(id) { const d = await db(); return new Promise((res, rej) => { const rq = d.transaction('blobs').objectStore('blobs').get(id); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => rej(rq.error); }); }
async function blobDel(id) { try { const d = await db(); d.transaction('blobs', 'readwrite').objectStore('blobs').delete(id); } catch { /* gone */ } }

/** Queue an ops-api write. `label` is what the trade sees in "waiting to send". */
export function queueWrite({ action, body, jobId = null, label }) {
  const item = { id: uid(), kind: 'api', action, body, jobId, label, ts: new Date().toISOString() };
  write([...read(), item]);
  return item;
}
/** Queue a photo (already compressed). */
export async function queuePhoto({ jobId, blob, name, type, phase, label, poId = null }) {
  const id = uid();
  await blobPut(id, blob);
  const item = { id, kind: 'photo', jobId, name, type, phase, label: label || '', poId, ts: new Date().toISOString() };
  write([...read(), item]);
  return item;
}

export async function sendPhoto({ jobId, blob, name, type, phase, label, poId }) {
  const up = await api('get_upload_url', null, { jobId, fileName: name, contentType: type });
  await putFile(up.uploadUrl, up.token, blob, type);
  const body = { jobId, publicUrl: up.publicUrl, path: up.path, label: label || '', phase };
  if (poId) body.po_id = poId;
  return api('confirm_upload', null, body);
}

/** Try to send everything waiting. Stops at the first no-signal failure. */
export async function flushOutbox() {
  if (flushing) return;
  if (!getState().user || !navigator.onLine) return;
  flushing = true;
  let sent = 0; const dropped = [];
  try {
    for (const item of read()) {
      try {
        if (item.kind === 'photo') {
          const blob = await blobGet(item.id);
          if (blob) await sendPhoto({ ...item, blob });
          await blobDel(item.id);
        } else {
          await api(item.action, null, item.body);
        }
        sent += 1;
      } catch (err) {
        if (err instanceof ApiError && err.refused) { dropped.push({ item, err }); if (item.kind === 'photo') await blobDel(item.id); } else break;
      }
      write(read().filter((x) => x.id !== item.id));
      if (item.jobId) invalidate('job:' + item.jobId);
    }
  } finally { flushing = false; }
  if (sent || dropped.length) {
    invalidate('myjobs');
    window.dispatchEvent(new CustomEvent('crew:outbox-flushed', { detail: { sent, dropped } }));
  }
}

export function startOutbox() {
  setState({ outbox: read().length });
  window.addEventListener('online', () => { setState({ online: true }); setTimeout(flushOutbox, 1500); });
  window.addEventListener('offline', () => setState({ online: false }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) flushOutbox(); });
  setInterval(flushOutbox, 60000);
}
