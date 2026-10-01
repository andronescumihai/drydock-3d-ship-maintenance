import Link from 'next/link';
import TechText from '@/components/reactbits/TechText';
import WarpText from '@/components/reactbits/WarpText';
import { vesselModel } from '@/lib/data/loader';

export default function LandingPage(): React.ReactElement {
  const { vessel, components, systems } = vesselModel;

  return (
    <main className="hud-backdrop relative flex min-h-dvh items-center justify-center overflow-hidden px-6">
      <div className="relative z-10 flex w-full max-w-2xl flex-col items-center text-center">
        <p className="hud-label mb-2">Maintenance decision support</p>
        {/*
          The wordmark is React Bits TechText: hover a letter to lift it into a
          dashed engineering outline, drag it and it springs back. The real
          heading stays in the DOM for search engines and screen readers.
        */}
        <h1 className="sr-only">DryDock</h1>
        <div aria-hidden="true" className="h-32 w-full sm:h-40">
          <TechText
            text="DRYDOCK"
            fontFamily="'Inter Variable', ui-sans-serif, system-ui, sans-serif"
            fontWeight={700}
            fontSize={132}
            letterSpacing={-0.04}
            color="#e9f2f9"
            accentColor="#38d6f2"
            reach={170}
            specks={12}
          />
        </div>
        {/* React Bits WarpText: the tagline bends under the pointer like a heat haze over water. */}
        <WarpText
          text="Every failure has a path."
          color="#38d6f2"
          fontFamily="'Inter Variable', ui-sans-serif, system-ui, sans-serif"
          fontSize="clamp(1.6rem, 4.6vw, 2.6rem)"
          fontWeight={600}
          letterSpacing="-0.02em"
          warpStrength={0.05}
          speed={0.4}
          className="-mt-1 w-full"
          style={{ minHeight: '4.5rem', height: '4.5rem' }}
        />
        <p className="mt-4 max-w-xl text-base leading-relaxed text-ink-muted">
          An interactive digital twin of a vessel. Select a component, mark it as failed, and
          the graph engine traces which systems go down with it, what sits in danger nearby,
          what has to come apart to reach it, and how urgent the repair is.
        </p>

        <dl className="mt-10 grid w-full grid-cols-3 gap-px overflow-hidden rounded-sm border border-hairline bg-hairline">
          {[
            { label: 'Vessel', value: vessel.name },
            { label: 'Systems', value: String(systems.length) },
            { label: 'Components', value: String(components.length) },
          ].map((stat) => (
            <div key={stat.label} className="bg-panel px-4 py-4">
              <dt className="hud-label">{stat.label}</dt>
              <dd className="mt-1 truncate font-mono text-sm text-ink">{stat.value}</dd>
            </div>
          ))}
        </dl>

        <Link
          href="/twin"
          className="mt-10 inline-flex items-center gap-3 border border-accent/50 bg-accent/10 px-6 py-3 font-mono text-xs uppercase tracking-[0.18em] text-accent transition-colors hover:bg-accent/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Open digital twin
          <span aria-hidden="true">&rarr;</span>
        </Link>

        <p className="mt-10 max-w-xl border-t border-warm/40 pt-4 text-xs leading-relaxed text-ink-faint">
          <span className="font-mono uppercase tracking-[0.16em] text-warm">
            Modeled sample vessel
          </span>
          <br />
          {vessel.disclaimer}
        </p>
      </div>
    </main>
  );
}
