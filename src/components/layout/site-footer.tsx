import { LogoMark } from "@/components/layout/logo";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-2 px-4 py-6 text-xs text-fg-muted sm:flex-row sm:items-center md:px-6 lg:px-8">
        <div className="flex items-center gap-2">
          <LogoMark size={20} className="text-fg-subtle" />
          <span>© {new Date().getFullYear()} RepoMap</span>
        </div>
        <p className="sm:ml-auto">
          Built on the GitHub REST API. Not affiliated with or endorsed by GitHub, Inc.
        </p>
      </div>
    </footer>
  );
}
