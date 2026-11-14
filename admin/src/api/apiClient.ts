// @ts-nocheck
/**
 * R59 Media Admin — Centralized API Client
 * 
 * In-Memory Auth Vault with SharedWorker and Cross-Tab Synchronization.
 * 
 * - Primary Path: SharedWorker ('/admin/assets/js/authWorker.js') keeps bearer token
 *   in an isolated worker context and proxies authenticated requests (PROXY_FETCH),
 *   never leaking the bearer token to the window DOM context.
 * - Fallback Path (iOS Safari): Private module closure (`closureToken`) synchronized
 *   across tabs via BroadcastChannel('r59_admin_sync').
 * - All client token storage is completely in-memory (no web storage).
 */

(function () {
  'use strict';

  // --- Private In-Memory Auth State ---
  let closureToken: string | null = null;
  let isWorkerMode = false;
  let sharedWorker: SharedWorker | null = null;
  let workerPort: MessagePort | null = null;
  let fallbackChannel: BroadcastChannel | null = null;
  let isWorkerAuthenticated = false;

  let reqIdCounter = 0;
  const pendingRequests = new Map();

  function sendWorkerMessage(type, payload = {}, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      if (!workerPort) {
        return reject(new Error('SharedWorker is not available'));
      }
      const id = `sw_${++reqIdCounter}_${Date.now()}`;
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error(`SharedWorker request timed out: ${type}`));
      }, timeoutMs);

      pendingRequests.set(id, { resolve, reject, timer });
      workerPort.postMessage({ id, type, ...payload });
    });
  }

  // --- Primary Path: Connect to SharedWorker ---
  if (typeof SharedWorker !== 'undefined') {
    try {
      sharedWorker = new SharedWorker('/admin/assets/js/authWorker.js', { type: 'module' });
      workerPort = sharedWorker.port;
      workerPort.start();
      isWorkerMode = true;

      workerPort.onmessage = (event) => {
        const data = event.data;
        if (!data || typeof data !== 'object') return;

        // Correlation response to a specific request
        if (data.id && pendingRequests.has(data.id)) {
          const req = pendingRequests.get(data.id);
          clearTimeout(req.timer);
          pendingRequests.delete(data.id);
          req.resolve(data);
          return;
        }

        // Broadcast event from SharedWorker
        if (data.event === 'AUTH_SYNC') {
          const authenticated = Boolean(data.authenticated);
          const wasAuthenticated = isWorkerAuthenticated;
          isWorkerAuthenticated = authenticated;
          if (!authenticated) {
            closureToken = null;
          }

          // Dispatch DOM event for open tabs to update UI automatically
          window.dispatchEvent(new CustomEvent('r59:auth-ready', {
            detail: { authenticated }
          }));

          if (!authenticated && wasAuthenticated) {
            window.dispatchEvent(new CustomEvent('r59:unauthorized', {
              detail: { message: 'Session ended or signed out in another tab.' }
            }));
          }
        }
      };

      workerPort.onmessageerror = (err) => {
        console.warn('[R59 Admin] SharedWorker message error:', err);
      };

      // Check worker initial auth status on mount
      sendWorkerMessage('CHECK_AUTH').then((res) => {
        if (res && res.authenticated) {
          isWorkerAuthenticated = true;
          window.dispatchEvent(new CustomEvent('r59:auth-ready', {
            detail: { authenticated: true }
          }));
        }
      }).catch(() => {});
    } catch (err) {
      console.warn('[R59 Admin] Failed to initialize SharedWorker, falling back:', err);
      sharedWorker = null;
      workerPort = null;
      isWorkerMode = false;
    }
  }

  // --- Fallback Path (iOS Safari): BroadcastChannel ---
  if (!isWorkerMode && typeof BroadcastChannel !== 'undefined') {
    try {
      fallbackChannel = new BroadcastChannel('r59_admin_sync');
      fallbackChannel.onmessage = (event) => {
        const data = event.data;
        if (!data || typeof data !== 'object') return;

        if (data.type === 'NEEDS_AUTH') {
          // Authenticated tab replies with the token
          if (closureToken) {
            fallbackChannel.postMessage({
              type: 'PROVIDE_AUTH',
              token: closureToken
            });
          }
        } else if (data.type === 'PROVIDE_AUTH') {
          if (data.token) {
            closureToken = String(data.token);
            window.dispatchEvent(new CustomEvent('r59:auth-ready', {
              detail: { authenticated: true }
            }));
          }
        } else if (data.type === 'CLEAR_AUTH') {
          const wasAuth = Boolean(closureToken);
          closureToken = null;
          window.dispatchEvent(new CustomEvent('r59:auth-ready', {
            detail: { authenticated: false }
          }));
          if (wasAuth) {
            window.dispatchEvent(new CustomEvent('r59:unauthorized', {
              detail: { message: 'Signed out in another tab.' }
            }));
          }
        }
      };

      // On tab mount: broadcast NEEDS_AUTH to sync from any already-open authenticated tab
      fallbackChannel.postMessage({ type: 'NEEDS_AUTH' });
    } catch (err) {
      console.warn('[R59 Admin] BroadcastChannel initialization failed:', err);
    }
  }

  // Auto-update UI when another tab authenticates
  window.addEventListener('r59:auth-ready', (e) => {
    if (e && e.detail && e.detail.authenticated) {
      if (document.body && document.body.classList.contains('is-login')) {
        window.R59?.app?.checkSession?.();
      }
    }
  });

  // Token accessors (in-memory closure)
  function getAuthToken() {
    return closureToken || '';
  }

  function setAuthToken(token) {
    if (isWorkerMode && workerPort) {
      if (token) {
        sendWorkerMessage('SET_TOKEN', { token: String(token) }).catch(() => {});
      } else {
        sendWorkerMessage('CLEAR_TOKEN').catch(() => {});
      }
    } else {
      closureToken = token ? String(token).trim() : null;
      if (fallbackChannel) {
        if (closureToken) {
          fallbackChannel.postMessage({ type: 'PROVIDE_AUTH', token: closureToken });
        } else {
          fallbackChannel.postMessage({ type: 'CLEAR_AUTH' });
        }
      }
      window.dispatchEvent(new CustomEvent('r59:auth-ready', {
        detail: { authenticated: Boolean(closureToken) }
      }));
    }
  }

  function clearMediaCache() {
    for (const objectUrl of mediaObjectUrlCache.values()) {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        // ignore revoke errors
      }
    }
    mediaObjectUrlCache.clear();
    mediaInflightRequests.clear();
  }

  function clearAuthToken() {
    clearMediaCache();
    if (isWorkerMode && workerPort) {
      sendWorkerMessage('CLEAR_TOKEN').catch(() => {});
    } else {
      closureToken = null;
      if (fallbackChannel) {
        fallbackChannel.postMessage({ type: 'CLEAR_AUTH' });
      }
      window.dispatchEvent(new CustomEvent('r59:auth-ready', {
        detail: { authenticated: false }
      }));
    }
  }

  // Configurable base URL
  const DEFAULT_BASE_URL = 'http://localhost:8787/api';

  function getBaseUrl() {
    if (window.R59_API_URL) {
      return String(window.R59_API_URL).replace(/\/+$/, '');
    }
    if (window.APP_CONFIG && window.APP_CONFIG.apiBaseUrl) {
      return window.APP_CONFIG.apiBaseUrl.replace(/\/+$/, '');
    }
    if (window.location && window.location.protocol.startsWith('file')) {
      return DEFAULT_BASE_URL;
    }
    const isSeparateLocalServer = window.location &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
      window.location.port !== '8787' &&
      window.location.port !== '';
    if (isSeparateLocalServer) {
      return DEFAULT_BASE_URL;
    }
    return '/api';
  }

  /**
   * Core request function wrapping SharedWorker PROXY_FETCH (primary) or window fetch (fallback).
   * 
   * @param {string} endpoint Relative or absolute path, e.g. '/admin/bookings'
   * @param {Object} options Fetch options: method, headers, body, params,
   *   suppressUnauthorized (true: a 401 does not fire the `r59:unauthorized` event)
   * @returns {Promise<any>} Parsed JSON response
   */
  /**
   * Core request function wrapping SharedWorker PROXY_FETCH (primary) or window fetch (fallback).
   * 
   * @param {string} endpoint Relative or absolute path, e.g. '/admin/bookings'
   * @param {Object} options Fetch options: method, headers, body, params,
   *   suppressUnauthorized (true: a 401 does not fire the `r59:unauthorized` event),
   *   responseType ('json' | 'blob' | 'arraybuffer' | 'text')
   * @returns {Promise<any>} Parsed JSON response or binary data
   */
  async function request<T = any>(endpoint: string, options: any = {}): Promise<T> {
    const {
      method = 'GET',
      headers: optHeaders = {},
      body = null,
      params = null,
      suppressUnauthorized = false,
      responseType = null
    } = options;

    const baseUrl = getBaseUrl();
    const isFullUrl = endpoint.startsWith('http://') || endpoint.startsWith('https://');
    const cleanEndpoint = isFullUrl ? endpoint : (endpoint.startsWith('/') ? endpoint : `/${endpoint}`);
    let url: string;
    if (isFullUrl) {
      url = cleanEndpoint;
    } else if (baseUrl.endsWith('/api') && cleanEndpoint.startsWith('/api/')) {
      url = `${baseUrl}${cleanEndpoint.slice(4)}`;
    } else {
      url = `${baseUrl}${cleanEndpoint}`;
    }

    if (params) {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') {
          searchParams.append(k, String(v));
        }
      });
      const queryString = searchParams.toString();
      if (queryString) {
        url += (url.includes('?') ? '&' : '?') + queryString;
      }
    }

    const headers: Record<string, string> = {
      'Accept': responseType ? '*/*' : 'application/json',
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...(optHeaders || {}),
    };

    if (options.body instanceof FormData || body instanceof FormData) {
      delete headers['Content-Type'];
    }

    if (method === 'GET' || method === 'HEAD') {
      delete headers['Content-Type'];
    }

    // --- PRIMARY PATH: Proxy fetch through SharedWorker ---
    if (isWorkerMode && workerPort && !(body instanceof FormData)) {
      let serializedBody = body;
      if (body !== null && body !== undefined && method !== 'GET' && method !== 'HEAD') {
        if (typeof body !== 'string' && !(body instanceof Blob)) {
          serializedBody = JSON.stringify(body);
        }
      } else {
        serializedBody = undefined;
      }

      try {
        const response: any = await sendWorkerMessage('PROXY_FETCH', {
          url,
          init: {
            method,
            headers,
            body: serializedBody,
            responseType
          }
        });

        if (!response.ok) {
          if (response.status === 401 && !suppressUnauthorized && !url.includes('/admin/login') && !url.includes('/admin/google-login')) {
            clearAuthToken();
            window.dispatchEvent(new CustomEvent('r59:unauthorized', {
              detail: {
                message: (response.data && response.data.error && response.data.error.message) ||
                         (response.data && response.data.message) ||
                         'Session expired. Please sign in again.'
              }
            }));
          }

          const error: any = new Error(
            (response.data && response.data.error && response.data.error.message) ||
            (response.data && response.data.message) ||
            `HTTP Error ${response.status}: ${response.statusText}`
          );
          error.status = response.status;
          error.data = response.data;
          error.isHttpError = true;
          throw error;
        }

        if (responseType === 'blob' && response.data instanceof ArrayBuffer) {
          return new Blob([response.data], { type: response.headers?.['content-type'] || 'application/octet-stream' }) as unknown as T;
        }

        return response.data as T;
      } catch (err: any) {
        if (err.isHttpError) {
          throw err;
        }
        const networkError: any = new Error("Can't reach the server. Check your connection and try again.");
        networkError.url = url;
        networkError.isNetworkError = true;
        networkError.originalError = err;
        throw networkError;
      }
    }

    // --- FALLBACK PATH: Direct Window fetch ---
    if (closureToken && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${closureToken}`;
    }

    const fetchConfig: RequestInit = {
      method,
      credentials: 'omit',
      headers
    };

    if (body !== null && body !== undefined && method !== 'GET' && method !== 'HEAD') {
      if (typeof body === 'string' || body instanceof FormData || body instanceof Blob) {
        fetchConfig.body = body;
      } else {
        fetchConfig.body = JSON.stringify(body);
      }
    }

    try {
      const response = await fetch(url, fetchConfig);

      if (!response.ok) {
        let responseData = null;
        try {
          const contentType = response.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            responseData = await response.json();
          } else {
            responseData = await response.text();
          }
        } catch {
          // ignore parsing error
        }

        if (response.status === 401 && !suppressUnauthorized && !url.includes('/admin/login') && !url.includes('/admin/google-login')) {
          clearAuthToken();
          window.dispatchEvent(new CustomEvent('r59:unauthorized', {
            detail: {
              message: (responseData && responseData.error && responseData.error.message) ||
                       (responseData && responseData.message) ||
                       'Session expired. Please sign in again.'
            }
          }));
        }

        const error: any = new Error(
          (responseData && responseData.error && responseData.error.message) ||
          (responseData && responseData.message) ||
          `HTTP Error ${response.status}: ${response.statusText}`
        );
        error.status = response.status;
        error.data = responseData;
        error.isHttpError = true;
        throw error;
      }

      if (responseType === 'arraybuffer') {
        return (await response.arrayBuffer()) as unknown as T;
      }
      if (responseType === 'blob') {
        return (await response.blob()) as unknown as T;
      }

      let responseData = null;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        responseData = await response.json();
      } else {
        const text = await response.text();
        try {
          responseData = JSON.parse(text);
        } catch {
          responseData = text;
        }
      }

      return responseData as T;
    } catch (err: any) {
      if (err.isHttpError) {
        throw err;
      }
      const networkError: any = new Error("Can't reach the server. Check your connection and try again.");
      networkError.url = url;
      networkError.isNetworkError = true;
      networkError.originalError = err;
      throw networkError;
    }
  }

  /**
   * Fetches the admin authentication configuration (e.g. Google Client ID).
   */
  async function fetchAuthConfig() {
    try {
      const data = await request('/admin/auth-config', { suppressUnauthorized: true });
      return {
        googleClientId: data?.googleClientId || data?.google_client_id || data?.clientId
      };
    } catch {
      return {};
    }
  }

  /**
   * Authenticates with Google Identity Services ID token and nonce.
   */
  async function loginWithGoogle(tokenOrPayload, maybeNonce) {
    let idToken = '';
    let nonce = '';
    if (tokenOrPayload && typeof tokenOrPayload === 'object') {
      idToken = tokenOrPayload.idToken;
      nonce = tokenOrPayload.nonce;
    } else {
      idToken = tokenOrPayload;
      nonce = maybeNonce;
    }
    try {
      const body: { idToken: string; nonce?: string } = { idToken };
      if (nonce) {
        body.nonce = nonce;
      }
      const data = await request('/admin/google-login', {
        method: 'POST',
        body,
        suppressUnauthorized: true
      });
      if (data && (data.ok !== false && !data.error)) {
        if (data.token) {
          setAuthToken(data.token);
        }
        setSessionHint(true);
        return { ok: true, email: data.email, token: data.token };
      }
      return {
        ok: false,
        error: (data && (data.error?.message || data.error || data.message)) || 'Authentication failed'
      };
    } catch (err) {
      return {
        ok: false,
        error: err?.data?.error?.message || err?.message || 'Authentication failed'
      };
    }
  }

  /** @deprecated Password-based login is deprecated in favor of loginWithGoogle */
  async function login(email, password) {
    throw new Error('Password login is deprecated. Please use Google Sign-In.');
  }

  /** @deprecated Deprecated in favor of Google Sign-In */
  async function forgotPassword() {
    throw new Error('Password reset is deprecated.');
  }

  /** @deprecated Deprecated in favor of Google Sign-In */
  async function resetPassword() {
    throw new Error('Password reset is deprecated.');
  }

  /** @deprecated Deprecated in favor of Google Sign-In */
  async function checkPasswordResetAvailable() {
    return { available: false };
  }

  /** @deprecated Deprecated in favor of Google Sign-In */
  async function updatePassword() {
    throw new Error('Password update is deprecated.');
  }

  /** @deprecated Deprecated in favor of Google Sign-In */
  async function updateRecoveryEmail() {
    throw new Error('Recovery email is deprecated.');
  }

  /**
   * Asks the server whether the session token is valid. Never fires `r59:unauthorized`.
   * Resolves true (signed in) or false (not signed in). Rejects when the server can't be reached
   * (err.isNetworkError) or answers with a server error (err.status >= 500).
   */
  async function verifySession() {
    if (isWorkerMode && workerPort) {
      try {
        const checkRes = await sendWorkerMessage('CHECK_AUTH');
        if (!checkRes || !checkRes.authenticated) {
          isWorkerAuthenticated = false;
          return false;
        }
        const res = await request('/admin/verify', { suppressUnauthorized: true });
        const ok = !!(res && (res.authenticated || res.status === 'success'));
        if (!ok) {
          clearAuthToken();
        } else {
          isWorkerAuthenticated = true;
        }
        return ok;
      } catch (err) {
        if (err.isNetworkError || (err.status && err.status >= 500)) throw err;
        clearAuthToken();
        return false;
      }
    }

    // Fallback path (iOS Safari)
    if (!closureToken && fallbackChannel) {
      // Allow brief window for PROVIDE_AUTH from another tab
      await new Promise((r) => setTimeout(r, 60));
    }

    if (!closureToken) {
      return false;
    }
    try {
      const res = await request('/admin/verify', { suppressUnauthorized: true });
      const ok = !!(res && (res.authenticated || res.status === 'success'));
      if (!ok) {
        clearAuthToken();
      }
      return ok;
    } catch (err) {
      if (err.isNetworkError || (err.status && err.status >= 500)) throw err;
      clearAuthToken();
      return false;
    }
  }

  /** Explicit user logout: revokes the token on the server and clears it. Resolves true on 2xx. */
  async function logout() {
    try {
      await request('/admin/logout', { method: 'POST', body: {}, suppressUnauthorized: true });
      clearAuthToken();
      return true;
    } catch {
      clearAuthToken();
      return false;
    }
  }

  // Fast check: whether an active session hint exists (in-memory only, purged storage calls)
  function hasSessionHint() {
    return Boolean(closureToken || isWorkerAuthenticated);
  }

  function setSessionHint(on) {
    if (on) {
      isWorkerAuthenticated = true;
    } else {
      isWorkerAuthenticated = false;
    }
  }

  const mediaObjectUrlCache = new Map<string, string>();
  const mediaInflightRequests = new Map<string, Promise<string>>();

  function resolveMediaRequestUrl(rawUrl: string): { fetchUrl: string; cacheKey: string } | null {
    const trimmed = typeof rawUrl === 'string' ? rawUrl.trim() : '';
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('//')) {
      return null;
    }

    const baseUrl = getBaseUrl();
    let backendOrigin = '';
    if (baseUrl.startsWith('http://') || baseUrl.startsWith('https://')) {
      try {
        backendOrigin = new URL(baseUrl).origin;
      } catch {
        backendOrigin = '';
      }
    } else if (typeof window !== 'undefined' && window.location?.origin) {
      backendOrigin = window.location.origin;
    }

    const backendRoot = baseUrl.endsWith('/api')
      ? baseUrl.slice(0, -4)
      : (baseUrl === '/' ? '' : baseUrl);

    if (trimmed.startsWith('/assets/') || trimmed.startsWith('/api/media/')) {
      const resolved = backendRoot ? `${backendRoot}${trimmed}` : trimmed;
      const fetchUrl = resolved.startsWith('/') && backendOrigin
        ? new URL(resolved, backendOrigin).toString()
        : resolved;
      return { fetchUrl, cacheKey: resolved };
    }

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      try {
        const parsed = new URL(trimmed);
        if (backendOrigin && parsed.origin === backendOrigin && (parsed.pathname.startsWith('/assets/') || parsed.pathname.startsWith('/api/media/'))) {
          const full = parsed.toString();
          return { fetchUrl: full, cacheKey: full };
        }
      } catch {
        return null;
      }
    }

    return null;
  }

  /**
   * Fetches protected media (/assets/* or /api/media/*) using the in-memory/SharedWorker
   * Bearer token and X-R59-Client header, returning a cached Blob object URL.
   * External, data:, and blob: URLs are returned as-is.
   */
  async function fetchAuthorizedMediaUrl(url: string): Promise<string> {
    const trimmed = typeof url === 'string' ? url.trim() : '';
    if (!trimmed) return '';

    const target = resolveMediaRequestUrl(trimmed);
    if (!target) return trimmed;

    const cached = mediaObjectUrlCache.get(target.cacheKey);
    if (cached) return cached;

    const inflight = mediaInflightRequests.get(target.cacheKey);
    if (inflight) return inflight;

    const promise = (async () => {
      try {
        const blob = await request<Blob>(target.fetchUrl, {
          method: 'GET',
          headers: { 'X-R59-Client': 'media-viewer' },
          responseType: 'blob',
          suppressUnauthorized: true
        });
        const objectUrl = URL.createObjectURL(blob);
        const prev = mediaObjectUrlCache.get(target.cacheKey);
        if (prev && prev !== objectUrl) {
          try {
            URL.revokeObjectURL(prev);
          } catch {
            // ignore revoke errors
          }
        }
        mediaObjectUrlCache.set(target.cacheKey, objectUrl);
        return objectUrl;
      } finally {
        mediaInflightRequests.delete(target.cacheKey);
      }
    })();

    mediaInflightRequests.set(target.cacheKey, promise);
    return promise;
  }

  /**
   * Applies an image URL to an <img> element, fetching protected backend media
   * with authorization headers when required and caching Blob object URLs.
   */
  async function applyAuthorizedImageSrc(img: HTMLImageElement | null, url: string): Promise<void> {
    if (!img) return;
    const trimmed = typeof url === 'string' ? url.trim() : '';
    if (!trimmed) {
      delete img.dataset.authMediaUrl;
      img.removeAttribute('src');
      return;
    }

    const target = resolveMediaRequestUrl(trimmed);
    if (!target) {
      delete img.dataset.authMediaUrl;
      if (img.getAttribute('src') !== trimmed) {
        img.src = trimmed;
      }
      return;
    }

    const cached = mediaObjectUrlCache.get(target.cacheKey);
    if (cached) {
      img.dataset.authMediaUrl = target.cacheKey;
      if (img.getAttribute('src') !== cached) {
        img.src = cached;
      }
      return;
    }

    img.dataset.authMediaUrl = target.cacheKey;
    try {
      const objectUrl = await fetchAuthorizedMediaUrl(trimmed);
      if (img.dataset.authMediaUrl === target.cacheKey && img.getAttribute('src') !== objectUrl) {
        img.src = objectUrl;
      }
    } catch {
      if (img.dataset.authMediaUrl === target.cacheKey) {
        img.dispatchEvent(new Event('error'));
      }
    }
  }

  /**
   * Fetches protected binary data via apiClient.request, wraps it in a Blob,
   * and generates an ephemeral Object URL.
   */
  async function fetchProtectedObjectUrl(endpoint: string, mimeType = 'application/octet-stream'): Promise<string> {
    const buffer = await apiClient.request<ArrayBuffer | Blob>(endpoint, {
      method: 'GET',
      responseType: 'arraybuffer'
    });
    const blob = new Blob([buffer], { type: mimeType });
    return URL.createObjectURL(blob);
  }

  /**
   * Triggers an authenticated signed asset download via short-lived media token.
   */
  async function triggerSignedDownload(fileKey: string, filename: string): Promise<void> {
    const res = await apiClient.request<{ url: string }>('/api/admin/media-token', {
      method: 'POST',
      body: JSON.stringify({ file_key: fileKey })
    });
    const signedUrl = res?.url;
    if (!signedUrl) {
      throw new Error('Failed to obtain signed URL for download');
    }
    const a = document.createElement('a');
    a.href = signedUrl;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // HTTP method convenience helpers
  const apiClient = {
    getBaseUrl,
    getAuthToken,
    setAuthToken,
    clearAuthToken,
    fetchAuthConfig,
    loginWithGoogle,
    login,
    forgotPassword,
    resetPassword,
    checkPasswordResetAvailable,
    updatePassword,
    updateRecoveryEmail,
    verifySession,
    logout,
    hasSessionHint,
    setSessionHint,
    request,
    fetchProtectedObjectUrl,
    fetchAuthorizedMediaUrl,
    applyAuthorizedImageSrc,
    triggerSignedDownload,
    get: (endpoint, params = null, headers = {}) => request(endpoint, { method: 'GET', params, headers }),
    post: (endpoint, body = null, headers = {}) => request(endpoint, { method: 'POST', body, headers }),
    put: (endpoint, body = null, headers = {}) => request(endpoint, { method: 'PUT', body, headers }),
    patch: (endpoint, body = null, headers = {}) => request(endpoint, { method: 'PATCH', body, headers }),
    delete: (endpoint, headers = {}) => request(endpoint, { method: 'DELETE', headers })
  };

  window.R59 = window.R59 || {};
  window.R59.apiClient = apiClient;
  window.R59.api = window.R59.api || {};
  window.R59.api.client = apiClient;
})();
