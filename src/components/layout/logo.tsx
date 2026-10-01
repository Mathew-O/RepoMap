/** RepoMap mark: a root node branching to two children, drawn in octicon style. */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="8.5" y="2.5" width="7" height="5.5" rx="1.75" />
      <rect x="2" y="16" width="7" height="5.5" rx="1.75" />
      <rect x="15" y="16" width="7" height="5.5" rx="1.75" />
      <path d="M12 8v4M5.5 16v-2a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
