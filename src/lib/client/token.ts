/**
 * The visitor's optional GitHub token. It lives only in this browser's
 * localStorage and is sent to RepoMap's own API in a header (never in a URL).
 * The server uses it for that one request and never stores it.
 */

const STORAGE_KEY = "repomap:github-token";
export const TOKEN_CHANGED_EVENT = "repomap:token-changed";
export const OPEN_TOKEN_SETTINGS_EVENT = "repomap:open-token-settings";

export function getStoredToken(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): boolean {
  try {
    if (token) window.localStorage.setItem(STORAGE_KEY, token);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    return false;
  }
  window.dispatchEvent(new Event(TOKEN_CHANGED_EVENT));
  return true;
}

export function openTokenSettings() {
  window.dispatchEvent(new Event(OPEN_TOKEN_SETTINGS_EVENT));
}
