/**
 * R59 Admin — In-Memory Auth Vault SharedWorker
 *
 * Runs in isolated SharedWorker context (SharedWorkerGlobalScope).
 * Holds the admin bearer token exclusively in-memory and proxies authenticated
 * HTTP requests to prevent credential leakage into DOM / window contexts.
 */
/// <reference lib="webworker" />
const ctx = self;
let bearerToken = null;
const connectedPorts = new Set();
/**
 * Broadcast an event payload to all connected tab MessagePorts.
 * Cleans up disconnected ports automatically on failure.
 */
function broadcast(message) {
    for (const port of Array.from(connectedPorts)) {
        try {
            port.postMessage(message);
        }
        catch {
            connectedPorts.delete(port);
        }
    }
}
ctx.onconnect = (event) => {
    const port = event.ports[0];
    if (!port)
        return;
    connectedPorts.add(port);
    port.start();
    port.onmessageerror = () => {
        connectedPorts.delete(port);
    };
    port.onmessage = async (e) => {
        const data = e.data;
        if (!data || typeof data !== 'object')
            return;
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
                }
                else {
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
                // Attach Authorization header if bearer token exists
                const headers = {};
                if (init && init.headers) {
                    if (typeof init.headers.forEach === 'function') {
                        init.headers.forEach((value, key) => {
                            headers[key] = value;
                        });
                    }
                    else if (Array.isArray(init.headers)) {
                        for (const [k, v] of init.headers) {
                            headers[k] = v;
                        }
                    }
                    else if (typeof init.headers === 'object') {
                        Object.assign(headers, init.headers);
                    }
                }
                if (bearerToken && !headers['Authorization'] && !headers['authorization']) {
                    headers['Authorization'] = `Bearer ${bearerToken}`;
                }
                const fetchInit = {
                    ...init,
                    headers,
                    credentials: 'omit'
                };
                try {
                    const response = await fetch(url, fetchInit);
                    const contentType = response.headers.get('content-type') || '';
                    let responseData = null;
                    if (init && (init.responseType === 'arraybuffer' || init.responseType === 'blob')) {
                        responseData = await response.arrayBuffer();
                    }
                    else if (contentType.includes('application/json')) {
                        try {
                            responseData = await response.json();
                        }
                        catch {
                            responseData = null;
                        }
                    }
                    else {
                        const text = await response.text();
                        try {
                            responseData = JSON.parse(text);
                        }
                        catch {
                            responseData = text;
                        }
                    }
                    const resHeaders = {};
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
                }
                catch (err) {
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
