'use client';

import { useEffect, useRef } from 'react';

type Api = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: Api;
  }
}

const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<Api> | null = null;

/** Loads the Turnstile script one time for the page. */
function load(): Promise<Api> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<Api>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not load.')));
    s.onerror = () => {
      loading = null;
      reject(new Error('Turnstile did not load.'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * The Cloudflare browser check. It gives a token to onToken, and null when the
 * token expires. A token is good for one try, so the form changes `round` after
 * each failed try, and the check runs again.
 */
export default function Turnstile({ siteKey, round, onToken }: { siteKey: string; round: number; onToken: (token: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);
  const tokenCb = useRef(onToken);
  tokenCb.current = onToken;

  useEffect(() => {
    let gone = false;
    load().then(
      (ts) => {
        if (gone || !box.current) return;
        id.current = ts.render(box.current, {
          sitekey: siteKey,
          theme: 'auto',
          size: 'flexible',
          callback: (t: string) => tokenCb.current(t),
          'expired-callback': () => tokenCb.current(null),
          'error-callback': () => tokenCb.current(null),
        });
      },
      () => tokenCb.current(null),
    );
    return () => {
      gone = true;
      if (id.current) window.turnstile?.remove(id.current);
      id.current = null;
    };
  }, [siteKey]);

  useEffect(() => {
    if (round === 0 || !id.current) return;
    tokenCb.current(null);
    window.turnstile?.reset(id.current);
  }, [round]);

  return <div ref={box} className="login-turnstile" />;
}
