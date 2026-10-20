import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk('src');
const tsx = files.filter((f) => f.endsWith('.tsx'));
const cssFiles = files.filter((f) => f.endsWith('.css'));
const globals = readFileSync('src/app/globals.css', 'utf8');

/** Removes CSS comments, so a word in a comment cannot fail a check. */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Removes each block that starts with `head`, with its nested braces. */
function stripBlocks(css: string, head: string): string {
  let out = css;
  for (;;) {
    const start = out.indexOf(head);
    if (start === -1) return out;
    let depth = 0;
    let end = out.indexOf('{', start);
    for (; end < out.length; end++) {
      if (out[end] === '{') depth++;
      if (out[end] === '}' && --depth === 0) break;
    }
    out = out.slice(0, start) + out.slice(end + 1);
  }
}

/** The text of each block that starts with `head`, with its nested braces. */
function blocksOf(css: string, head: string): string {
  let out = '';
  for (let from = css.indexOf(head); from !== -1; from = css.indexOf(head, from + 1)) {
    let depth = 0;
    let end = css.indexOf('{', from);
    for (; end < css.length; end++) {
      if (css[end] === '{') depth++;
      if (css[end] === '}' && --depth === 0) break;
    }
    out += css.slice(from, end + 1) + '\n';
  }
  return out;
}
const coarseBlocks = (css: string) => blocksOf(css, '@media (pointer: coarse)');

/** Rules as [selector, body] pairs, flat (nested at-rules are searched too). */
function rules(css: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const m of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push([m[1].trim(), m[2]]);
  return out;
}

function px(value: string): number | null {
  const v = value.trim();
  let m = /^(\d+(?:\.\d+)?)px$/.exec(v);
  if (m) return Number(m[1]);
  m = /^(\d+(?:\.\d+)?)rem$/.exec(v);
  if (m) return Number(m[1]) * 16;
  m = /^var\(--t-(\d+)\)$/.exec(v);
  if (m) return Number(m[1]);
  return null;
}

type Jsx = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

function scan(file: string, check: (node: Jsx, ctx: { source: ts.SourceFile; labels: Set<string> }) => string | null): string[] {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  // The htmlFor of each <label>, as source text.
  const labels = new Set<string>();
  const visitLabels = (n: ts.Node) => {
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText(source) === 'label') {
      const a = attr(n, 'htmlFor');
      if (a?.initializer) labels.add(initText(a.initializer, source));
    }
    ts.forEachChild(n, visitLabels);
  };
  visitLabels(source);
  const hits: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const why = check(n, { source, labels });
      if (why) {
        const { line } = source.getLineAndCharacterOfPosition(n.getStart(source));
        hits.push(`${file}:${line + 1} ${why}`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(source);
  return hits;
}

function attr(n: Jsx, name: string): ts.JsxAttribute | undefined {
  for (const a of n.attributes.properties) if (ts.isJsxAttribute(a) && a.name.getText() === name) return a;
  return undefined;
}
const hasSpread = (n: Jsx) => n.attributes.properties.some((a) => ts.isJsxSpreadAttribute(a));
const initText = (i: ts.JsxAttribute['initializer'], source: ts.SourceFile) => (i ? i.getText(source).replace(/^\{|\}$/g, '') : '');
const tag = (n: Jsx, source: ts.SourceFile) => n.tagName.getText(source);

function ancestor(n: ts.Node, test: (a: ts.Node) => boolean): boolean {
  for (let p = n.parent; p; p = p.parent) if (test(p)) return true;
  return false;
}
const isElementNamed = (name: string, source: ts.SourceFile) => (a: ts.Node) =>
  ts.isJsxElement(a) && a.openingElement.tagName.getText(source) === name;

describe('static accessibility checks', () => {
  it('has no :hover selector outside @media (hover: hover)', () => {
    for (const f of cssFiles) {
      const css = stripBlocks(stripComments(readFileSync(f, 'utf8')), '@media (hover: hover)');
      expect({ f, hits: css.match(/[^{}]*:hover[^{}]*\{/g) ?? [] }).toEqual({ f, hits: [] });
    }
  });

  it('never uses 100vh', () => {
    const hits = files.filter((f) => /100vh/.test(stripComments(readFileSync(f, 'utf8'))));
    expect(hits).toEqual([]);
  });

  it('gives every input, select and textarea a label', () => {
    const hits = tsx.flatMap((f) =>
      scan(f, (n, { source, labels }) => {
        const name = tag(n, source);
        if (name !== 'input' && name !== 'select' && name !== 'textarea') return null;
        const type = attr(n, 'type');
        if (type && /["']hidden["']/.test(type.initializer?.getText(source) ?? '')) return null;
        if (attr(n, 'aria-label') || attr(n, 'aria-labelledby')) return null;
        if (ancestor(n, isElementNamed('Field', source))) return null;
        if (ancestor(n, isElementNamed('label', source))) return null;
        const id = attr(n, 'id');
        if (id && labels.has(initText(id.initializer, source))) return null;
        return `<${name}> has no label`;
      }),
    );
    expect(hits).toEqual([]);
  });

  it('sets a font size of at least 16 px on fields', () => {
    // The base rule sets the size on its own, not "inherit", so a small parent cannot shrink a field.
    const base = rules(globals).find(([sel]) => /^input, select, textarea$/.test(sel));
    expect(px(/font-size:\s*([^;]+)/.exec(base?.[1] ?? '')?.[1] ?? '') ?? 0).toBeGreaterThanOrEqual(16);
    const small: string[] = [];
    for (const f of cssFiles) {
      for (const [s, b] of rules(readFileSync(f, 'utf8'))) {
        if (!/(^|[\s,.>])(input|select|textarea|field|note-area)\b|\.field\b|\.note-area\b/.test(s)) continue;
        const m = /(?:^|;)\s*font-size:\s*([^;]+)/.exec(b);
        if (!m) continue;
        const size = px(m[1]);
        if (size !== null && size < 16) small.push(`${f}: ${s} { font-size: ${m[1].trim()} }`);
      }
    }
    expect(small).toEqual([]);
  });

  it('never uses dangerouslySetInnerHTML', () => {
    const hits = files.filter((f) => /\.(tsx?|jsx?)$/.test(f) && /dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML/.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });

  it('gives every img an alt', () => {
    const hits = tsx.flatMap((f) => scan(f, (n, { source }) => (tag(n, source) === 'img' && !attr(n, 'alt') && !hasSpread(n) ? '<img> has no alt' : null)));
    expect(hits).toEqual([]);
  });

  it('gives every button text or an aria-label', () => {
    const hits = tsx.flatMap((f) =>
      scan(f, (n, { source }) => {
        if (tag(n, source) !== 'button') return null;
        if (attr(n, 'aria-label') || attr(n, 'aria-labelledby') || hasSpread(n)) return null;
        if (ts.isJsxSelfClosingElement(n)) return '<button> has no name';
        const el = n.parent as ts.JsxElement;
        let named = false;
        const look = (c: ts.Node) => {
          if (ts.isJsxText(c) && c.text.trim() !== '') named = true;
          // An expression names the button when it is text: a string, a template or a plain name. A JSX icon in braces does not.
          if (ts.isJsxExpression(c) && c.expression && !ts.isJsxElement(c.expression) && !ts.isJsxSelfClosingElement(c.expression) && !ts.isJsxFragment(c.expression)) {
            const inner = c.expression;
            const iconOnly = ts.isBinaryExpression(inner) && (ts.isJsxElement(inner.right) || ts.isJsxSelfClosingElement(inner.right));
            if (!iconOnly) named = true;
          }
          ts.forEachChild(c, look);
        };
        el.children.forEach(look);
        return named ? null : '<button> has no name';
      }),
    );
    expect(hits).toEqual([]);
  });

  it('never sets a positive tabIndex', () => {
    const hits = tsx.flatMap((f) =>
      scan(f, (n, { source }) => {
        const a = attr(n, 'tabIndex');
        const v = a?.initializer ? initText(a.initializer, source) : '';
        if (/^-?\d+$/.test(v)) return Number(v) > 0 ? `tabIndex ${v}` : null;
        // A value from a variable: only a ternary of 0 and -1 is safe. A plain name is the limit of this check; it is flagged.
        if (v === '') return null;
        return /^[^?]+\?\s*-?[01]\s*:\s*-?[01]$/.test(v) ? null : `tabIndex {${v}} is not a literal 0, -1 or a ternary of them`;
      }),
    );
    expect(hits).toEqual([]);
  });
});

describe('iOS and touch rules in globals.css', () => {
  const css = stripComments(globals);

  it('stops iOS from resizing text', () => {
    expect(css).toMatch(/text-size-adjust:\s*100%/);
  });

  it('pads the tab bar, the apply bar and the sheets for the home indicator', () => {
    for (const sel of ['.sh-tabbar', '.jd-bar', '.ui-sheet-panel']) {
      const own = rules(globals).filter(([s, b]) => s.split(',').some((x) => x.trim().endsWith(sel)) && /safe-area-inset-bottom/.test(b));
      expect({ sel, covered: own.length > 0 }).toEqual({ sel, covered: true });
    }
  });

  // What the coarse-pointer rules give each selector: the largest min-height and min-width, in px.
  const coarse = new Map<string, { h: number; w: number }>();
  for (const [sel, body] of rules(coarseBlocks(css))) {
    const h = px(/(?:^|;)\s*min-height:\s*([^;]+)/.exec(body)?.[1] ?? '') ?? 0;
    const w = px(/(?:^|;)\s*min-width:\s*([^;]+)/.exec(body)?.[1] ?? '') ?? 0;
    for (const one of sel.split(',').map((x) => x.trim())) {
      const old = coarse.get(one) ?? { h: 0, w: 0 };
      coarse.set(one, { h: Math.max(old.h, h), w: Math.max(old.w, w) });
    }
  }

  it('gives each small control a min-height of 44 px on a coarse pointer', () => {
    const tall = ['.btn', '.ui-btn', '.ui-tab', '.ui-fold-head', '.ui-switch', '.chip', '.fs-chip', '.sh-nav-item', '.sh-tab', '.sh-rail-item', '.sh-collapse', '.sh-expand', '.ui-sheet-head .btn', '.pf-row .btn', '.pf-actions .btn', '.pf-check', '.ob .btn.link'];
    const low = tall.filter((sel) => (coarse.get(sel)?.h ?? 0) < 44);
    expect(low).toEqual([]);
  });

  it('gives each icon button and chip a min-width of 44 px on a coarse pointer', () => {
    const wide = ['.chip', '.fs-chip', '.sh-collapse', '.sh-expand'];
    expect(wide.filter((sel) => (coarse.get(sel)?.w ?? 0) < 44)).toEqual([]);
  });

  it('lists every control rule with a height under 44 px in a coarse rule', () => {
    const control = /\.(btn|chip|tab|switch|check|collapse|expand|fold-head|nav-item|rail-item)\b/;
    const missing: string[] = [];
    for (const [sel, body] of rules(stripBlocks(css, '@media (pointer: coarse)'))) {
      const h = px(/(?:^|;)\s*height:\s*([^;]+)/.exec(body)?.[1] ?? '');
      if (h === null || h >= 44) continue;
      for (const one of sel.split(',').map((x) => x.trim())) {
        if (control.test(one) && !/:hover|\[/.test(one) && (coarse.get(one)?.h ?? 0) < 44) missing.push(`${one} { height: ${h}px }`);
      }
    }
    expect(missing).toEqual([]);
  });
});
