// @ts-nocheck
/**
 * R59 Media Admin — Centralized API Client
 *
 * Unified HTTP request handling: configurable base URL, cookie session (same-origin
 * credentials), JSON serialization, and normalized errors:
 * err.message (server message), err.status, err.isNetworkError.
 */
(function () {
    'use strict';
    // Auth is the HttpOnly session cookie only (sent automatically, shared by every tab).
    // Remove a token left by older builds of the admin.
    try {
        localStorage.removeItem('r59_admin_token');
    }
    catch {
        // ignore storage errors
    }
    // Configurable base URL: can be overridden via window.R59_API_URL or
    // window.APP_CONFIG.apiBaseUrl; defaults to '/api' (or localhost:8787/api on file://).
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
    // Kept for compatibility with older callers; the cookie is the only credential.
    function getAuthToken() { return ''; }
    function setAuthToken() { }
    function clearAuthToken() { }
    /**
     * Core request function wrapping fetch.
     *
     * @param {string} endpoint Relative or absolute path, e.g. '/admin/bookings'
     * @param {Object} options Fetch options: method, headers, body, params,
     *   suppressUnauthorized (true: a 401 does not fire the `r59:unauthorized` event)
     * @returns {Promise<any>} Parsed JSON response
     */
    async function request(endpoint, options = {}) {
        const { method = 'GET', headers: optHeaders = {}, body = null, params = null, suppressUnauthorized = false } = options;
        let url = endpoint.startsWith('http://') || endpoint.startsWith('https://')
            ? endpoint
            : `${getBaseUrl()}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
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
        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            ...(optHeaders || {}),
        };
        if (options.body instanceof FormData || body instanceof FormData) {
            delete headers['Content-Type'];
        }
        const fetchConfig = {
            method,
            credentials: 'same-origin',
            headers
        };
        if (body !== null && body !== undefined && method !== 'GET' && method !== 'HEAD') {
            if (typeof body === 'string' || body instanceof FormData || body instanceof Blob) {
                fetchConfig.body = body;
            }
            else {
                fetchConfig.body = JSON.stringify(body);
            }
        }
        else if (method === 'GET' || method === 'HEAD') {
            delete headers['Content-Type'];
        }
        try {
            const response = await fetch(url, fetchConfig);
            let responseData = null;
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                responseData = await response.json();
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
            if (!response.ok) {
                if (response.status === 401 && !suppressUnauthorized && !url.includes('/admin/login')) {
                    window.dispatchEvent(new CustomEvent('r59:unauthorized', {
                        detail: {
                            message: (responseData && responseData.error && responseData.error.message) || 'Session expired. Please sign in again.'
                        }
                    }));
                }
                const error = new Error((responseData && responseData.error && responseData.error.message) ||
                    (responseData && responseData.message) ||
                    `HTTP Error ${response.status}: ${response.statusText}`);
                error.status = response.status;
                error.data = responseData;
                error.isHttpError = true;
                throw error;
            }
            return responseData;
        }
        catch (err) {
            if (err.isHttpError) {
                throw err;
            }
            // Network or connection failure
            const networkError = new Error("Can't reach the server. Check your connection and try again.");
            networkError.url = url;
            networkError.isNetworkError = true;
            networkError.originalError = err;
            throw networkError;
        }
    }
    async function login(email, password) {
        const data = await request('/admin/login', {
            method: 'POST',
            body: { email, password }
        });
        if (data && (data.authenticated || data.status === 'success' || data.token)) {
            setSessionHint(true);
            return data;
        }
        throw new Error((data && (data.message || (data.error && data.error.message))) || 'Authentication failed: Invalid credentials.');
    }
    /**
     * Asks the server whether the session cookie is valid. Never fires `r59:unauthorized`.
     * Resolves true (signed in) or false (not signed in). Rejects when the server can't be reached
     * (err.isNetworkError) or answers with a server error (err.status >= 500), so the caller can
     * offer Retry instead of treating the user as signed out.
     */
    async function verifySession() {
        // No sign-in recorded in this browser: skip the request so a first visit shows the login
        // screen at once and doesn't log an expected 401. The hint is shared by every tab.
        if (!hasSessionHint())
            return false;
        try {
            const res = await request('/admin/verify', { suppressUnauthorized: true });
            const ok = !!(res && (res.authenticated || res.status === 'success'));
            if (!ok)
                setSessionHint(false);
            return ok;
        }
        catch (err) {
            if (err.isNetworkError || (err.status && err.status >= 500))
                throw err;
            setSessionHint(false);
            return false;
        }
    }
    /** Explicit user logout only: revokes the shared session cookie for every tab. Resolves true on 2xx. */
    async function logout() {
        try {
            await request('/admin/logout', { method: 'POST', body: {}, suppressUnauthorized: true });
            setSessionHint(false);
            return true;
        }
        catch {
            return false;
        }
    }
    // "This browser may hold a session cookie" — not a credential (the cookie is HttpOnly and is
    // what the server checks); it only decides whether the startup check is worth a request.
    const SESSION_HINT_KEY = 'r59_admin_session_hint';
    function hasSessionHint() {
        try {
            return localStorage.getItem(SESSION_HINT_KEY) === '1';
        }
        catch {
            return true;
        }
    }
    function setSessionHint(on) {
        try {
            if (on)
                localStorage.setItem(SESSION_HINT_KEY, '1');
            else
                localStorage.removeItem(SESSION_HINT_KEY);
        }
        catch { /* storage blocked: hasSessionHint() then always verifies */ }
    }
    // HTTP method convenience helpers
    const apiClient = {
        getBaseUrl,
        getAuthToken,
        setAuthToken,
        clearAuthToken,
        login,
        verifySession,
        logout,
        request,
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
