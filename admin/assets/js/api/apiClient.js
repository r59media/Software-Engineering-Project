/**
 * R59 Media Admin — Centralized API Client
 *
 * Provides unified HTTP request handling with configurable base URL,
 * authentication header injection, standard JSON serialization,
 * and normalized error responses for both HTTP and network failures.
 */
let isTabAuthenticated = false;
try {
    localStorage.removeItem('r59_admin_token');
    sessionStorage.removeItem('r59_admin_token');
    isTabAuthenticated = sessionStorage.getItem('r59_admin_logged_in') === '1';
}
catch {
    // ignore storage errors
}
// Configurable base URL: can be overridden via window.R59_API_URL or
// window.APP_CONFIG.apiBaseUrl; defaults to '/api' (or localhost:8787/api on file://).
const DEFAULT_BASE_URL = 'http://localhost:8787/api';
export function getBaseUrl() {
    if (typeof window !== 'undefined' && window.R59_API_URL) {
        return String(window.R59_API_URL).replace(/\/+$/, '');
    }
    if (typeof window !== 'undefined' && window.APP_CONFIG && window.APP_CONFIG.apiBaseUrl) {
        return window.APP_CONFIG.apiBaseUrl.replace(/\/+$/, '');
    }
    if (typeof window !== 'undefined' && window.location && window.location.protocol.startsWith('file')) {
        return DEFAULT_BASE_URL;
    }
    const isSeparateLocalServer = typeof window !== 'undefined' && window.location &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
        window.location.port !== '8787' &&
        window.location.port !== '';
    if (isSeparateLocalServer) {
        return DEFAULT_BASE_URL;
    }
    return '/api';
}
export function getAuthToken() {
    return isTabAuthenticated ? 'cookie' : '';
}
export function setAuthToken(token) {
    isTabAuthenticated = Boolean(token);
    try {
        localStorage.removeItem('r59_admin_token');
        sessionStorage.removeItem('r59_admin_token');
        if (isTabAuthenticated) {
            sessionStorage.setItem('r59_admin_logged_in', '1');
        }
        else {
            sessionStorage.removeItem('r59_admin_logged_in');
        }
    }
    catch {
        // ignore storage errors
    }
}
export function clearAuthToken() {
    setAuthToken('');
}
/**
 * Core request function wrapping fetch.
 *
 * @param endpoint Relative or absolute path, e.g. '/admin/bookings'
 * @param options Fetch options: method, headers, body, params
 * @returns Parsed JSON response
 */
export async function request(endpoint, options = {}) {
    const { method = 'GET', headers: optHeaders = {}, body = null, params = null } = options;
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
    if ((typeof FormData !== 'undefined' && body instanceof FormData) ||
        (options.body && typeof FormData !== 'undefined' && options.body instanceof FormData)) {
        delete headers['Content-Type'];
    }
    const token = getAuthToken();
    if (token && token !== 'cookie' && !headers['Authorization']) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    const fetchConfig = {
        method,
        credentials: 'same-origin',
        headers
    };
    if (body !== null && body !== undefined && method !== 'GET' && method !== 'HEAD') {
        if (typeof body === 'string' ||
            (typeof FormData !== 'undefined' && body instanceof FormData) ||
            (typeof Blob !== 'undefined' && body instanceof Blob)) {
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
            if (response.status === 401 && !url.includes('/admin/login')) {
                clearAuthToken();
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('r59:unauthorized', {
                        detail: {
                            message: (responseData && responseData.error && responseData.error.message) || 'Session expired. Please sign in again.'
                        }
                    }));
                }
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
        if (err && err.isHttpError) {
            throw err;
        }
        // Network or connection failure
        const networkError = new Error(`Unable to connect to server at ${url}. Please verify the backend is running.`);
        networkError.isNetworkError = true;
        networkError.originalError = err;
        throw networkError;
    }
}
export async function login(email, password) {
    const data = await request('/admin/login', {
        method: 'POST',
        body: { email, password }
    });
    if (data && (data.authenticated || data.status === 'success' || data.token)) {
        setAuthToken('1');
        return data;
    }
    throw new Error((data && (data.message || (data.error && data.error.message))) || 'Authentication failed: Invalid credentials.');
}
export async function verifySession() {
    const token = getAuthToken();
    if (!token)
        return false;
    try {
        const res = await request('/admin/verify');
        return !!(res && (res.authenticated || res.status === 'success'));
    }
    catch {
        clearAuthToken();
        return false;
    }
}
export async function logout() {
    await request('/admin/logout', { method: 'POST', body: {} }).catch(() => { });
    clearAuthToken();
}
// HTTP method convenience helpers
export const apiClient = {
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
if (typeof window !== 'undefined') {
    window.R59 = window.R59 || {};
    window.R59.apiClient = apiClient;
    window.R59.api = window.R59.api || {};
    window.R59.api.client = apiClient;
}
export default apiClient;
