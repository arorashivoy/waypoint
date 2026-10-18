/** How much one piece of evidence counts, by its depth. `rankEvidence` and the default base résumé use the same weights. */
export const DEPTH_WEIGHT: Record<string, number> = { mentioned: 0.5, used: 0.8, built: 1 };
