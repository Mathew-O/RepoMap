import Link from "next/link";

import { LogoMark } from "@/components/layout/logo";
import { HeaderSearch } from "@/components/repo-input/header-search";
import { TokenSettings } from "@/components/repo-input/token-settings";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-header-border bg-header text-header-fg">
      <div className="flex h-16 items-center gap-3 px-4 md:gap-4 md:px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 text-header-fg-strong hover:opacity-80"
          aria-label="RepoMap home"
        >
          <LogoMark size={30} />
          <span className="hidden text-base font-semibold sm:inline">RepoMap</span>
        </Link>
        <HeaderSearch />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <TokenSettings />
        </div>
      </div>
    </header>
  );
}
