'use client';

import { useEffect, useState } from 'react';

const WIDE = '(min-width: 640px)';

/**
 * True from 640 px: the sections of Profile and Settings are a list on the left. Under 640 px they are tabs across the top.
 * The first paint already has the right layout: these screens mount in the browser only, after the data of the user loads.
 */
export function useSideList() {
  const [side, setSide] = useState(() => typeof window !== 'undefined' && window.matchMedia(WIDE).matches);
  useEffect(() => {
    const q = window.matchMedia(WIDE);
    const update = () => setSide(q.matches);
    update();
    q.addEventListener('change', update);
    return () => q.removeEventListener('change', update);
  }, []);
  return side;
}

/** On a phone a soft fade shows on the edge of the tab strip that has more tabs behind it. CSS reads --fade-l and --fade-r. */
export function useTabFade(selector: string, deps: unknown[]) {
  useEffect(() => {
    const list = document.querySelector<HTMLElement>(selector);
    if (!list) return;
    const update = () => {
      list.style.setProperty('--fade-l', list.scrollLeft > 2 ? '28px' : '0px');
      list.style.setProperty('--fade-r', list.scrollLeft + list.clientWidth < list.scrollWidth - 2 ? '28px' : '0px');
    };
    update();
    list.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      list.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
    // The caller names what changes the strip.
  }, [selector, ...deps]);
}
