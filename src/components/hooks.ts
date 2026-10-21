'use client';
import { useCallback, useState } from 'react';

export function useToast() {
  const [state, setState] = useState<{ message: string | null; nonce: number }>({ message: null, nonce: 0 });
  // The same text twice is a new toast: the nonce restarts the timer and the live region.
  const show = useCallback((message: string) => setState((s) => ({ message, nonce: s.nonce + 1 })), []);
  const hide = useCallback(() => setState((s) => ({ ...s, message: null })), []);
  return { message: state.message, nonce: state.nonce, show, hide };
}
