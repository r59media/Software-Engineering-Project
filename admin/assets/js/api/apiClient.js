/**
 * R59 Media Admin — Centralized API Client
 * 
 * Provides unified HTTP request handling with configurable base URL,
 * authentication header injection, standard JSON serialization,
 * and normalized error responses for both HTTP and network failures.
 */

(function () {
  'use strict';

  // Configurable base URL: can be overridden via window.APP_CONFIG.apiBaseUrl,
  // localStorage 'r59_api_url', or defaults to standard backend development URL.
  const DEFAULT_BASE_URL = 'http://localhost:8787/api';

  function getBaseUrl() {
    if (window.APP_CONFIG && window.APP_CONFIG.apiBaseUrl) {
      return window.APP_CONFIG.apiBaseUrl.replace(/\/+$/, '');
    }
    const stored = localStorage.getItem('r59_api_url');
    if (stored) {
      return stored.replace(/\/+$/, '');
    }
    if (window.location && window.location.hostname && !window.location.hostname.includes('localhost') && !window.location.hostname.includes('127.0.0.1') && !window.location.protocol.startsWith('file')) {
      return `${window.location.origin}/api`;
    }
    return DEFAULT_BASE_URL;
  }

  function getAuthToken() {
    if (window.APP_CONFIG && window.APP_CONFIG.adminSecret) {
      return window.APP_CONFIG.adminSecret;
    }
    return localStorage.getItem('r59_admin_token') || '';
  }

  function setAuthToken(token) {
    if (token) {
      localStorage.setItem('r59_admin_token', token);
    } else {
      localStorage.removeItem('r59_admin_token');
    }
  }

  /**
   * Core request function wrapping fetch.
   * 
   * @param {string} endpoint Relative or absolute path, e.g. '/admin/bookings'
   * @param {Object} options Fetch options: method, headers, body, params
   * @returns {Promise<any>} Parsed JSON response
   */
  async function request(endpoint, options = {}) {
    const {
      method = 'GET',
      headers = {},
      body = null,
      params = null
    } = options;

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

    const requestHeaders = {
      'Accept': 'application/json',
      ...headers
    };

    const token = getAuthToken();
    if (token && !requestHeaders['Authorization']) {
      requestHeaders['Authorization'] = `Bearer ${token}`;
    }

    const fetchConfig = {
      method,
      headers: requestHeaders
    };

    if (body !== null && body !== undefined && method !== 'GET' && method !== 'HEAD') {
      if (typeof body === 'string' || body instanceof FormData || body instanceof Blob) {
        fetchConfig.body = body;
      } else {
        requestHeaders['Content-Type'] = 'application/json';
        fetchConfig.body = JSON.stringify(body);
      }
    }

    try {
      const response = await fetch(url, fetchConfig);

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

      if (!response.ok) {
        const error = new Error(
          (responseData && responseData.error && responseData.error.message) ||
          (responseData && responseData.message) ||
          `HTTP Error ${response.status}: ${response.statusText}`
        );
        error.status = response.status;
        error.data = responseData;
        error.isHttpError = true;
        throw error;
      }

      return responseData;
    } catch (err) {
      if (err.isHttpError) {
        throw err;
      }
      // Network or connection failure
      const networkError = new Error(
        `Unable to connect to server at ${url}. Please verify the backend is running.`
      );
      networkError.isNetworkError = true;
      networkError.originalError = err;
      throw networkError;
    }
  }

  // HTTP method convenience helpers
  const apiClient = {
    getBaseUrl,
    getAuthToken,
    setAuthToken,
    request,
    get: (endpoint, params = null, headers = {}) => request(endpoint, { method: 'GET', params, headers }),
    post: (endpoint, body = null, headers = {}) => request(endpoint, { method: 'POST', body, headers }),
    put: (endpoint, body = null, headers = {}) => request(endpoint, { method: 'PUT', body, headers }),
    patch: (endpoint, body = null, headers = {}) => request(endpoint, { method: 'PATCH', body, headers }),
    delete: (endpoint, headers = {}) => request(endpoint, { method: 'DELETE', headers })
  };

  window.R59 = window.R59 || {};
  window.R59.apiClient = apiClient;
})();
