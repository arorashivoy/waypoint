'use client';

import { useRef, useState } from 'react';
import { Button } from '../ui';

/** A button that opens the file picker. The input is hidden, and `accept` limits the files. */
export default function FileButton({ label, accept, run, variant = 'plain' }: { label: string; accept: string; run: (f: File) => Promise<void>; variant?: 'plain' | 'go' }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button variant={variant} busy={busy} onClick={() => input.current?.click()}>{busy ? 'Reading…' : label}</Button>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        aria-label={label}
        tabIndex={-1}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setBusy(true);
          try { await run(f); } finally { setBusy(false); }
        }}
      />
    </>
  );
}
