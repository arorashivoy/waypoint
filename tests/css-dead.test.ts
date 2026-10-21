import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Dead CSS: a class selector in globals.css that no file in src/ uses.
 * Class names live in string literals and template literals of the .ts and .tsx files.
 * A template such as `ui-badge-${tone}` makes a prefix ("ui-badge-"): every class that starts with it counts as used.
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Classes that no literal in src/ names, with the reason. Keep this list short. */
const ALLOW: Record<string, string> = {};

function usedNames() {
  const used = new Set<string>();
  const prefixes = new Set<string>();
  const add = (text: string, open: boolean) => {
    const parts = text.split(/\s+/).filter(Boolean);
    parts.forEach((t, i) => {
      used.add(t);
      // The last word before a ${…} part is the start of a class name, when nothing separates them.
      if (open && i === parts.length - 1 && !/\s$/.test(text) && /^[a-z][\w-]*-$/.test(t)) prefixes.add(t);
    });
  };
  for (const f of walk('src').filter((x) => /\.tsx?$/.test(x))) {
    const source = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, f.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (n: ts.Node) => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) add(n.text, false);
      if (ts.isTemplateExpression(n)) {
        add(n.head.text, true);
        for (const span of n.templateSpans) add(span.literal.text, !ts.isTemplateTail(span.literal));
      }
      ts.forEachChild(n, visit);
    };
    visit(source);
  }
  return { used, prefixes };
}

/** The class names in the selectors of a style sheet. Comments and attribute values do not count. */
function classNames(css: string): Set<string> {
  const names = new Set<string>();
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/([^{}]+)\{/g)) {
    const sel = m[1].trim();
    if (sel.startsWith('@')) continue;
    for (const c of sel.replace(/\[[^\]]*\]/g, '').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) names.add(c[1]);
  }
  return names;
}

describe('dead CSS', () => {
  it('reads the class names of selectors only', () => {
    expect([...classNames('/* .gone */ .a, .b > .c[data-x=".d"] { color: red; width: 0.5rem; } @media (min-width: 1px) { .e:hover { } }')]).toEqual(['a', 'b', 'c', 'e']);
  });

  it('finds a class that nothing uses', () => {
    const { used, prefixes } = usedNames();
    const dead = (name: string) => !used.has(name) && ![...prefixes].some((p) => name.startsWith(p));
    expect(dead('wp-no-such-class')).toBe(true);
    expect(dead('jd-flag')).toBe(false);
    expect(dead('ui-badge-coral')).toBe(false); // from `ui-badge-${tone}`
  });

  it('has no class selector in globals.css that src/ does not use', () => {
    const { used, prefixes } = usedNames();
    const dead = [...classNames(readFileSync('src/app/globals.css', 'utf8'))].filter(
      (name) => !used.has(name) && ![...prefixes].some((p) => name.startsWith(p)) && !(name in ALLOW),
    );
    expect(dead).toEqual([]);
  });
});
