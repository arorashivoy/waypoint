/** After a fold opens, bring its section to the top of the pane. No animation when the user asks for less motion. */
export function showSection(el: HTMLElement | null) {
  if (!el) return;
  requestAnimationFrame(() => {
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' });
  });
}
