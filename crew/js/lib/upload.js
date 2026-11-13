// Photos: shrink on the phone, send, and if there is no signal keep them in
// the outbox so nothing taken on site is lost.
import { ApiError } from './api.js';
import { queuePhoto, sendPhoto } from './outbox.js';

const MAX_SIDE = 1600; // same picture size as the current Trade App and job-photos page
const QUALITY = 0.72;

export async function compressImage(file) {
  if (!file || !/^image\//.test(file.type) || file.size < 500 * 1024) return file;
  try {
    const bitmap = await loadBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale); const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', QUALITY));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch { return file; }
}
function loadBitmap(file) {
  if (window.createImageBitmap) return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => viaImg(file));
  return viaImg(file);
}
function viaImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable image')); };
    img.src = url;
  });
}

/**
 * Upload one photo. Resolves { ok, queued, media }.
 * A no-signal failure parks the photo in the outbox (queued: true).
 * A refusal from the server rejects with the reason.
 */
export async function uploadPhoto(jobId, file, { phase = 'completion', label = '', poId = null } = {}) {
  const small = await compressImage(file);
  const payload = { jobId, blob: small, name: small.name || `photo-${Date.now()}.jpg`, type: small.type || 'image/jpeg', phase, label, poId };
  try {
    const media = await sendPhoto(payload);
    return { ok: true, queued: false, media };
  } catch (err) {
    if (err instanceof ApiError && err.refused) throw err;
    await queuePhoto(payload);
    return { ok: true, queued: true, media: null };
  }
}

/** Open the camera or library and resolve the chosen files. */
export function pickPhotos({ multiple = true, camera = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.multiple = multiple;
    if (camera) input.capture = 'environment';
    input.style.display = 'none';
    input.onchange = () => { const files = [...(input.files || [])]; input.remove(); resolve(files); };
    input.oncancel = () => { input.remove(); resolve([]); };
    document.body.appendChild(input);
    input.click();
  });
}
