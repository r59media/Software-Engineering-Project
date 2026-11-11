"use strict";
// @ts-nocheck
/**
 * @deprecated Password reset is deprecated in favor of Google Sign-In.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.passwordReset = void 0;
exports.passwordReset = {
    init: () => { },
    showSignIn: () => { },
    startFromLink: () => false,
    checkAvailability: () => Promise.resolve({ available: false })
};
if (typeof window !== 'undefined') {
    window.R59 = window.R59 || {};
    window.R59.passwordReset = exports.passwordReset;
}
exports.default = exports.passwordReset;
