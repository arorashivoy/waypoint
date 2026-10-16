/**
 * The quote rule (spec 3.3): each item that a model drafts from a document
 * gives a quote, and the server keeps the item only if the quote is in the
 * document. The check ignores case, runs of white space and dash and quote
 * forms, because PDF text breaks lines and changes dashes.
 */

const norm = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

export function quoteCheck(source: string): (quote: string) => boolean {
  const text = norm(source);
  return (quote: string) => {
    const q = norm(quote);
    return q.length >= 8 && text.includes(q);
  };
}
