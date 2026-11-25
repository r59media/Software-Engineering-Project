/**
 * R59 Admin — In-Memory Auth Vault SharedWorker
 * 
 * Runs in isolated SharedWorker context (SharedWorkerGlobalScope).
 * Holds the admin bearer token exclusively in-memory and proxies authenticated
 * HTTP requests to prevent credential leakage into DOM / window contexts.
 */

/// <reference lib="webworker" />

const ctx: SharedWorkerGlobalScope = self as unknown as SharedWorkerGlobalScope;

let bearerToken: string | null = null;
const connectedPorts: Set<MessagePort> = new Set<MessagePort>();

const LOCAL_DEV_HOSTNAMES = new Set(['localhost', '127.0.0.1']);
const ALLOWED_LOCAL_DEV_ORIGINS = new Set([
  'http://localhost:8787',
  'http://127.0.0.1:8787'
]);

/**
 * Verifies that a parsed PROXY_FETCH target uses HTTP(S) and belongs to a trusted origin:
 * same-origin as the worker, or local dev backend (:8787) when running on localhost/127.0.0.1.
 */
export function isTrustedProxyUrl(parsed: URL): boolean {
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  if (parsed.origin === self.location.origin) {
    return true;
  }

  if (
    LOCAL_DEV_HOSTNAMES.has(self.location.hostname) &&
    ALLOWED_LOCAL_DEV_ORIGINS.has(parsed.origin)
  ) {
    return true;
  }

  return false;
}

/**
 * Broadcast an event payload to all connected tab MessagePorts.
 * Cleans up disconnected ports automatically on failure.
 */
function broadcast(message: any): void {
  for (const port of Array.from(connectedPorts)) {
    try {
      port.postMessage(message);
    } catch {
      connectedPorts.delete(port);
    }
  }
}

ctx.onconnect = (event: MessageEvent) => {
  const port = event.ports[0];
  if (!port) return;

  connectedPorts.add(port);
  port.start();

  port.onmessageerror = () => {
    connectedPorts.delete(port);
  };

  port.onmessage = async (e: MessageEvent) => {
    const data = e.data;
    if (!data || typeof data !== 'object') return;

    const { type, id } = data;

    switch (type) {
      case 'SET_TOKEN': {
        const rawToken = data.token;
        bearerToken = typeof rawToken === 'string' && rawToken.trim().length > 0
          ? rawToken.trim()
          : null;

        // Broadcast auth state change without leaking token to window
        broadcast({
          event: 'AUTH_SYNC',
          authenticated: Boolean(bearerToken)
        });

        if (id) {
          port.postMessage({
            id,
            ok: true,
            authenticated: Boolean(bearerToken)
          });
        }
        break;
      }

      case 'CLEAR_TOKEN': {
        bearerToken = null;

        // Broadcast auth revocation to all tabs
        broadcast({
          event: 'AUTH_SYNC',
          authenticated: false
        });

        if (id) {
          port.postMessage({
            id,
            ok: true,
            authenticated: false
          });
        }
        break;
      }

      case 'CHECK_AUTH': {
        const authenticated = Boolean(bearerToken);
        if (id) {
          port.postMessage({
            id,
            ok: true,
            authenticated
          });
        } else {
          port.postMessage({
            type: 'CHECK_AUTH_RESPONSE',
            ok: true,
            authenticated
          });
        }
        break;
      }

      case 'PROXY_FETCH': {
        const { url, init } = data;
        if (!url || typeof url !== 'string') {
          if (id) {
            port.postMessage({
              id,
              ok: false,
              status: 400,
              statusText: 'Bad Request',
              error: 'Invalid or missing URL for proxy fetch'
            });
          }
          break;
        }

        let parsedUrl: URL;
        try {
          parsedUrl = new URL(url, self.location.origin);
        } catch {
          if (id) {
            port.postMessage({
              id,
              ok: false,
              status: 400,
              statusText: 'Bad Request',
              error: 'Invalid URL for proxy fetch'
            });
          }
          break;
        }

        if (!isTrustedProxyUrl(parsedUrl)) {
          if (id) {
            port.postMessage({
              id,
              ok: false,
              status: 403,
              statusText: 'Forbidden Origin',
              error: 'Cross-origin proxy fetch denied'
            });
          }
          break;
        }

        // Attach Authorization header if bearer token exists
        const headers: Record<string, string> = {};
        if (init && init.headers) {
          if (typeof (init.headers as any).forEach === 'function') {
            (init.headers as any).forEach((value: string, key: string) => {
              headers[key] = value;
            });
          } else if (Array.isArray(init.headers)) {
            for (const [k, v] of init.headers) {
              headers[k] = v;
            }
          } else if (typeof init.headers === 'object') {
            Object.assign(headers, init.headers);
          }
        }

        if (bearerToken && !headers['Authorization'] && !headers['authorization']) {
          headers['Authorization'] = `Bearer ${bearerToken}`;
        }

        const fetchInit: RequestInit = {
          ...init,
          headers,
          credentials: init?.credentials === 'same-origin' ? 'same-origin' : 'omit'
        };

        try {
          const response = await fetch(parsedUrl.toString(), fetchInit);
          const contentType = response.headers.get('content-type') || '';
          let responseData: any = null;

          if (init && (init.responseType === 'arraybuffer' || init.responseType === 'blob')) {
            responseData = await response.arrayBuffer();
          } else if (contentType.includes('application/json')) {
            try {
              responseData = await response.json();
            } catch {
              responseData = null;
            }
          } else {
            const text = await response.text();
            try {
              responseData = JSON.parse(text);
            } catch {
              responseData = text;
            }
          }

          const resHeaders: Record<string, string> = {};
          response.headers.forEach((value, key) => {
            resHeaders[key.toLowerCase()] = value;
          });

          if (id) {
            const transfer = responseData instanceof ArrayBuffer ? [responseData] : [];
            port.postMessage({
              id,
              ok: response.ok,
              status: response.status,
              statusText: response.statusText,
              data: responseData,
              headers: resHeaders
            }, transfer);
          }
        } catch (err: any) {
          if (id) {
            port.postMessage({
              id,
              ok: false,
              status: 0,
              statusText: 'Network Error',
              error: err?.message || 'Network request failed',
              isNetworkError: true
            });
          }
        }
        break;
      }

      default:
        break;
    }
  };
};
