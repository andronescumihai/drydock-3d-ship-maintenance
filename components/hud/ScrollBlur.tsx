'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import GradualBlur from '@/components/reactbits/GradualBlur';

interface ScrollBlurProps {
  /** Classes for the scrolling element itself (padding, max-height, …). */
  readonly className?: string;
  /** Classes for the outer wrapper that positions the blur bands. */
  readonly wrapperClassName?: string;
  readonly children: React.ReactNode;
  /** Height of the bands, as CSS lengths. */
  readonly top?: string;
  readonly bottom?: string;
}

/**
 * A scroll area whose edges dissolve into a progressive blur (React Bits
 * GradualBlur) wherever there is more content in that direction, so a cut-off
 * line reads as "keep scrolling" rather than as a clipping bug. At rest at the
 * top, only the bottom band shows; once scrolled to the end, only the top one.
 */
export const ScrollBlur = forwardRef<HTMLDivElement, ScrollBlurProps>(function ScrollBlur(
  { className = '', wrapperClassName = '', children, top = '1.75rem', bottom = '2.75rem' },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => scrollRef.current as HTMLDivElement);
  const [edges, setEdges] = useState({ above: false, below: false });

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const above = el.scrollTop > 2;
    const below = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
    setEdges((prev) => (prev.above === above && prev.below === below ? prev : { above, below }));
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    // Content swaps (tabs, folding branches) change the height without resizing
    // the scroller, so watch the subtree too.
    const mutations = new MutationObserver(() => requestAnimationFrame(measure));
    mutations.observe(el, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  }, [measure]);

  return (
    <div className={`relative flex min-h-0 flex-col ${wrapperClassName}`}>
      <div ref={scrollRef} onScroll={measure} onTransitionEnd={measure} className={`hud-scroll min-h-0 flex-1 overflow-y-auto ${className}`}>
        {children}
      </div>
      {/*
        The fade is the blur layers' own opacity: an opacity below 1 on an
        ancestor would make it a backdrop root and the blur would see nothing.
      */}
      <GradualBlur className="dd-blur-edge" position="top" height={top} strength={1.4} divCount={5} curve="bezier" exponential zIndex={5} opacity={edges.above ? 1 : 0} />
      <GradualBlur className="dd-blur-edge" position="bottom" height={bottom} strength={1.8} divCount={6} curve="bezier" exponential zIndex={5} opacity={edges.below ? 1 : 0} />
    </div>
  );
});
