// @ts-nocheck
/**
 * @deprecated Password reset is deprecated in favor of Google Sign-In.
 */
export const passwordReset = {
    init: () => { },
    showSignIn: () => { },
    startFromLink: () => false,
    checkAvailability: () => Promise.resolve({ available: false })
};
if (typeof window !== 'undefined') {
    window.R59 = window.R59 || {};
    window.R59.passwordReset = passwordReset;
}
export default passwordReset;
