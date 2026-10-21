// -----------------------------------------------------------------------------
// The optional image of a post: read from an http(s) address the container can
// reach (the snapshot address of a camera, Frigate, go2rtc, a Home page...).
// Gladys gives a device integration no access to its own camera images (only a
// communication integration receives them): an address typed by the user in
// the scene is the way.
// -----------------------------------------------------------------------------

import { ERROR_KINDS, MastodonError } from './mastodon/client.js';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // the image limit of a default Mastodon is 16 MB
export const IMAGE_TIMEOUT_MS = 15_000;
const TYPES = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

const imageError = (message) => new MastodonError(ERROR_KINDS.IMAGE, message);

/**
 * Downloads an image. The address may carry credentials (user:password@):
 * they are sent as Basic authentication, never logged.
 * @param {string} address
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ buffer: Buffer, contentType: string, extension: string }>}
 */
export async function fetchImage(address, { fetch: fetchImpl = globalThis.fetch, signal } = {}) {
  let url;
  try {
    url = new URL(String(address).trim());
  } catch {
    throw imageError('Image address not understood');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw imageError('Image address must be http(s)');
  }
  const headers = {};
  if (url.username || url.password) {
    const credentials = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
    headers.authorization = `Basic ${Buffer.from(credentials).toString('base64')}`;
    url.username = '';
    url.password = '';
  }
  let response;
  try {
    const timeout = AbortSignal.timeout(IMAGE_TIMEOUT_MS);
    response = await fetchImpl(url, {
      headers,
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    });
  } catch (err) {
    throw imageError(`Image not downloaded: ${err?.cause?.code ?? err?.name ?? 'error'}`);
  }
  if (!response.ok) {
    throw imageError(`Image not downloaded: HTTP ${response.status}`);
  }
  const contentType = String(response.headers.get('content-type') ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (!TYPES[contentType]) {
    throw imageError(`Not an image: ${contentType.slice(0, 40) || 'no content type'}`);
  }
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    throw imageError('Image too large');
  }
  // Read by chunks: a stream without end must not fill the 256 MB of the sandbox.
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > MAX_IMAGE_BYTES) {
      throw imageError('Image too large');
    }
    chunks.push(chunk);
  }
  if (size === 0) {
    throw imageError('Empty image');
  }
  return {
    buffer: Buffer.concat(chunks),
    contentType: contentType === 'image/jpg' ? 'image/jpeg' : contentType,
    extension: TYPES[contentType],
  };
}
