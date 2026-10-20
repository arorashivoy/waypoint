'use client';
import { useEffect, useState } from 'react';

export function useToast() {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);
  return [toast, setToast] as const;
}
