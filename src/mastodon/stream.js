// -----------------------------------------------------------------------------
// The streaming API of Mastodon over a WebSocket (stream user:notification):
// every new notification arrives as `{ event: "notification", payload }`,
// the payload being a JSON string. The token travels in the
// Sec-WebSocket-Protocol header (accepted by Mastodon and GoToSocial), never in
// the address, which servers and proxies write in their logs.
//
// Node 22 has a global WebSocket (undici): no dependency.
// -----------------------------------------------------------------------------

export const OPEN_TIMEOUT_MS = 15_000;

/**
 * Opens the stream. Resolves once it is open; rejects when it cannot open.
 * @param {object} options
 * @param {string} options.url ws:// or wss:// address of /api/v1/streaming
 * @param {string} options.token
 * @param {typeof WebSocket} [options.WebSocket]
 * @param {(notification: object) => void} options.onNotification
 * @param {(code: number) => void} options.onClose called once, after an open
 * @returns {Promise<{ close(): void }>}
 */
export function openStream({
  url,
  token,
  WebSocket: WebSocketImpl = globalThis.WebSocket,
  onNotification,
  onClose,
}) {
  return new Promise((resolve, reject) => {
    let opened = false;
    let closed = false;
    const socket = new WebSocketImpl(url, [token]);
    const timer = setTimeout(() => {
      if (!opened) {
        closed = true;
        socket.close();
        reject(new Error('The streaming API did not open in time'));
      }
    }, OPEN_TIMEOUT_MS);
    timer.unref?.();

    socket.addEventListener('open', () => {
      if (closed) {
        return;
      }
      opened = true;
      clearTimeout(timer);
      resolve({
        close() {
          if (!closed) {
            closed = true;
            socket.close();
            onClose?.(1000);
          }
        },
      });
    });
    socket.addEventListener('message', (message) => {
      let event;
      try {
        event = JSON.parse(String(message.data));
      } catch {
        return;
      }
      if (event?.event !== 'notification') {
        return; // delete, filters_changed, notifications_merged: nothing to do
      }
      let notification = event.payload;
      if (typeof notification === 'string') {
        try {
          notification = JSON.parse(notification);
        } catch {
          return;
        }
      }
      if (notification && typeof notification === 'object') {
        onNotification(notification);
      }
    });
    socket.addEventListener('close', (event) => {
      clearTimeout(timer);
      if (closed) {
        return;
      }
      closed = true;
      if (opened) {
        onClose?.(event?.code ?? 1006);
      } else {
        // A refused token closes the socket before it opens (1006, no reason).
        reject(new Error(`The streaming API closed (${event?.code ?? 1006})`));
      }
    });
  });
}
