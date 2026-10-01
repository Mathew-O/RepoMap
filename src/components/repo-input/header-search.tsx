"use client";

import { RepoIcon } from "@primer/octicons-react";
import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";

import { useSlashShortcut } from "@/components/repo-input/use-slash-shortcut";
import { explorerPath, parseRepoUrl } from "@/lib/github/parse-url";

/** Compact URL box in the header. Hidden on the landing page, which has its own. */
export function HeaderSearch() {
  const pathname = usePathname();
  if (pathname === "/") return <div className="flex-1" />;
  // Re-mount on navigation so the field shows the current repo.
  return <HeaderSearchField key={pathname} initial={currentRepo(pathname)} />;
}

function HeaderSearchField({ initial }: { initial: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  useSlashShortcut(inputRef);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const result = parseRepoUrl(value);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    inputRef.current?.blur();
    router.push(explorerPath(result.value));
  }

  return (
    <form onSubmit={onSubmit} role="search" className="relative min-w-0 flex-1 md:max-w-[480px]">
      <label htmlFor="header-repo-url" className="sr-only">
        GitHub repository URL
      </label>
      <RepoIcon className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-header-fg" />
      <input
        ref={inputRef}
        id="header-repo-url"
        type="text"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (error) setError(null);
        }}
        placeholder="Paste a GitHub repo URL…"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "header-repo-url-error" : undefined}
        className="header-search w-full pr-8"
      />
      <kbd className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 border-header-border! text-header-fg! shadow-none! sm:inline-block">
        /
      </kbd>
      {error && (
        <p
          id="header-repo-url-error"
          role="alert"
          className="absolute top-full right-0 left-0 mt-2 rounded-md border border-[var(--gh-danger-border)] bg-canvas-overlay px-3 py-2 text-xs text-danger shadow-[var(--gh-overlay-shadow)]"
        >
          {error}
        </p>
      )}
    </form>
  );
}

function currentRepo(pathname: string): string {
  try {
    return decodeURIComponent(pathname.replace(/^\/+/, ""));
  } catch {
    return pathname.replace(/^\/+/, "");
  }
}
