import { LightBulbIcon, ProjectIcon, RocketIcon } from "@primer/octicons-react";

import { RepoUrlForm } from "@/components/repo-input/repo-url-form";

const FEATURES = [
  {
    icon: ProjectIcon,
    title: "Interactive map",
    body: "Every folder and file as a navigable graph, color-coded by source, tests, config, docs and build/CI.",
  },
  {
    icon: RocketIcon,
    title: "Start here",
    body: "Entry points like main files, binaries, cmd/ packages and Dockerfiles are flagged, with a suggested reading order.",
  },
  {
    icon: LightBulbIcon,
    title: "Grounded explanations",
    body: "Short AI summaries of each file and folder, written from the actual source. If something is unclear, it says so.",
  },
];

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-border">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(60% 80% at 20% 0%, var(--hero-glow-1), transparent 70%), radial-gradient(50% 70% at 85% 10%, var(--hero-glow-2), transparent 70%)",
          }}
        />
        <div className="relative mx-auto flex max-w-[760px] flex-col items-center px-4 pt-16 pb-14 text-center md:pt-24 md:pb-20">
          <span className="Label mb-5 gap-1.5 bg-canvas">
            <span className="size-1.5 rounded-full bg-success" />
            Works with any public GitHub repository
          </span>
          <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl">
            Find your way around any repository
          </h1>
          <p className="mt-4 max-w-[600px] text-base text-pretty text-fg-muted md:text-lg">
            Paste a GitHub link to get a map of the codebase, see where to start reading, and get plain-language
            explanations of every folder and file.
          </p>
          <div className="mt-8 w-full">
            <RepoUrlForm />
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-[1012px] gap-4 px-4 py-12 md:grid-cols-3 md:py-16">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <div key={title} className="Box p-5">
            <div className="mb-3 inline-flex size-9 items-center justify-center rounded-md border border-border bg-canvas-subtle text-fg-muted">
              <Icon size={18} />
            </div>
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-fg-muted">{body}</p>
          </div>
        ))}
      </section>
    </>
  );
}
