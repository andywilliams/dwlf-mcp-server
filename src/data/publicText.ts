/**
 * Plain words for what agents read (DWLF-685). The bundled catalogue is generated from the packs repo's own docs and
 * carries references to files only that repo has (REGIMES.md, a job script): they point a reader nowhere, so every
 * bundled entry is served through `publicEntry`. The same rule as SPT's explain (src/services/eventExplain.js
 * publicText) and this repo's generator, so the offline copy and the live index say the same thing.
 */
import type { OnchainEventEntry } from './onchainCatalogue.js';

const INTERNAL_REFS = [/\s*\(jobs\/[^)]*\)/g, /[;,]?\s*[Ss]ee REGIMES\.md(?: §\d+)?\.?/g];

/** The text without the references; null when nothing else is left (or for null). */
export function publicText(v: string | null): string | null {
  if (typeof v !== 'string') return v;
  const out = INTERNAL_REFS.reduce((acc, re) => acc.replace(re, ''), v).trim();
  if (!out) return null;
  return v.trim().endsWith('.') && !/[.!?]$/.test(out) ? `${out}.` : out;
}

export const publicEntry = (e: OnchainEventEntry): OnchainEventEntry => ({
  ...e, meaning: publicText(e.meaning) ?? '', inputs: publicText(e.inputs), caveats: publicText(e.caveats),
});
