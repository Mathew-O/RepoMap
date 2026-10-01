"use client";

import { CheckIcon, KeyIcon, LinkExternalIcon, XIcon } from "@primer/octicons-react";
import { type FormEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  OPEN_TOKEN_SETTINGS_EVENT,
  TOKEN_CHANGED_EVENT,
  getStoredToken,
  setStoredToken,
} from "@/lib/client/token";

const NEW_TOKEN_URL =
  "https://github.com/settings/personal-access-tokens/new?name=RepoMap&description=Read-only+access+for+RepoMap&contents=read";

function subscribe(onChange: () => void) {
  window.addEventListener(TOKEN_CHANGED_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(TOKEN_CHANGED_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Header button + popover for the visitor's optional GitHub token. */
export function TokenSettings() {
  const token = useSyncExternalStore(subscribe, getStoredToken, () => null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [saveFailed, setSaveFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_TOKEN_SETTINGS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_TOKEN_SETTINGS_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function onSave(e: FormEvent) {
    e.preventDefault();
    const value = draft.trim();
    if (!value) return;
    const ok = setStoredToken(value);
    setSaveFailed(!ok);
    if (ok) {
      setDraft("");
      setOpen(false);
    }
  }

  function onRemove() {
    setStoredToken(null);
    setDraft("");
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="header-btn"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        title={token ? "GitHub token saved" : "Add a GitHub token"}
      >
        <KeyIcon />
        <span className="hidden md:inline">{token ? "Token" : "Add token"}</span>
        {token && <span className="size-2 rounded-full bg-success" aria-label="saved" />}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="GitHub token"
          className="fixed top-[72px] right-4 left-4 z-50 rounded-xl border border-border bg-canvas-overlay text-fg shadow-[var(--gh-overlay-shadow)] sm:absolute sm:top-full sm:right-0 sm:left-auto sm:mt-2 sm:w-[380px]"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">GitHub token</h2>
            <button type="button" className="btn-invisible btn btn-sm px-1!" onClick={() => setOpen(false)} aria-label="Close">
              <XIcon />
            </button>
          </div>

          <div className="space-y-3 p-4 text-sm">
            <p className="text-fg-muted">
              Optional. Raises GitHub&apos;s limit from 60 to 5,000 requests per hour and lets RepoMap
              open private repositories you can access.
            </p>

            {token ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-canvas-subtle px-3 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  <CheckIcon className="shrink-0 text-success" />
                  <span className="truncate font-mono text-xs">
                    Saved token ending in …{token.slice(-4)}
                  </span>
                </span>
                <button type="button" className="btn btn-sm btn-danger" onClick={onRemove}>
                  Remove
                </button>
              </div>
            ) : null}

            <form onSubmit={onSave} className="space-y-2">
              <label htmlFor="gh-token" className="block text-sm font-semibold">
                {token ? "Replace token" : "Personal access token"}
              </label>
              <input
                ref={inputRef}
                id="gh-token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="github_pat_… or ghp_…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="form-control w-full font-mono text-xs!"
              />
              {saveFailed && (
                <p className="text-xs text-danger">
                  Couldn&apos;t save. Your browser may be blocking local storage.
                </p>
              )}
              <div className="flex items-center justify-between gap-2 pt-1">
                <a href={NEW_TOKEN_URL} target="_blank" rel="noreferrer" className="Link inline-flex items-center gap-1 text-xs">
                  Create a read-only token <LinkExternalIcon size={12} />
                </a>
                <button type="submit" className="btn btn-primary btn-sm" disabled={!draft.trim()}>
                  Save token
                </button>
              </div>
            </form>

            <p className="border-t border-border pt-3 text-xs text-fg-muted">
              Stored only in this browser. It&apos;s sent to RepoMap&apos;s server with each request so it can
              call GitHub for you, and it&apos;s never saved on the server.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
