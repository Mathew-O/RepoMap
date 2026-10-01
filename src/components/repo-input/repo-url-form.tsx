"use client";

import { AlertFillIcon, ArrowRightIcon, RepoIcon } from "@primer/octicons-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState, useTransition } from "react";

import { useSlashShortcut } from "@/components/repo-input/use-slash-shortcut";
import { explorerPath, parseRepoUrl } from "@/lib/github/parse-url";

const EXAMPLES = ["pallets/flask", "sindresorhus/ky", "gin-gonic/gin", "BurntSushi/ripgrep", "tj/commander.js"];

/** The landing page's large URL input. */
export function RepoUrlForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  useSlashShortcut(inputRef);

  function go(raw: string) {
    const result = parseRepoUrl(raw);
    if (!result.ok) {
      setError(result.error);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    startTransition(() => router.push(explorerPath(result.value)));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    go(value);
  }

  return (
    <div className="w-full">
      <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row" noValidate>
        <div className="relative flex-1">
          <label htmlFor="repo-url" className="sr-only">
            GitHub repository URL
          </label>
          <RepoIcon size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-fg-muted" />
          <input
            ref={inputRef}
            id="repo-url"
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            placeholder="https://github.com/owner/repo"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "repo-url-error" : "repo-url-help"}
            className="form-control h-12! w-full pl-10! text-base! shadow-sm"
          />
        </div>
        <button type="submit" className="btn btn-primary h-12! px-5! text-base!" disabled={pending}>
          {pending ? "Opening…" : "Map repository"}
          {!pending && <ArrowRightIcon />}
        </button>
      </form>

      {error ? (
        <p id="repo-url-error" role="alert" className="mt-2 flex items-start gap-1.5 text-left text-sm font-semibold text-danger">
          <AlertFillIcon size={16} className="mt-0.5 shrink-0" />
          {error}
        </p>
      ) : (
        <p id="repo-url-help" className="mt-2 text-left text-xs text-fg-muted">
          Accepts repo, branch, folder and file links, as well as <code className="font-mono">owner/repo</code> and SSH clone URLs.
          Press <kbd>/</kbd> to focus.
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <span className="text-xs text-fg-muted">Try:</span>
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            className="topic-tag cursor-pointer"
            onClick={() => {
              setValue(example);
              go(example);
            }}
          >
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}
