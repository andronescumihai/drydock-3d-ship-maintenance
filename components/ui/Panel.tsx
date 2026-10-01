'use client';

interface PanelProps {
  readonly title?: string;
  readonly aside?: React.ReactNode;
  readonly className?: string;
  readonly children: React.ReactNode;
}

/** The one glass surface every HUD panel is built from. */
export function Panel({ title, aside, className = '', children }: PanelProps): React.ReactElement {
  return (
    <section className={`glass-panel hud-brackets pointer-events-auto rounded-sm ${className}`}>
      {title ? (
        <header className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-2.5">
          <h2 className="hud-label text-ink-muted">{title}</h2>
          {aside}
        </header>
      ) : null}
      {children}
    </section>
  );
}
