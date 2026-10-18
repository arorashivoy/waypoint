/**
 * A one-page PDF with Helvetica text lines. `size` is the font size in points,
 * `y` the baseline from the bottom of a 792 pt page. `angle` (degrees) turns the line. `color` is the text colour as red, green and blue from 0 to 1. Only for tests.
 */
export function makePdf(lines: { text: string; size: number; y: number; angle?: number; color?: [number, number, number] }[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = lines.map((l) => {
    const a = ((l.angle ?? 0) * Math.PI) / 180;
    const pos = l.angle ? `${Math.cos(a).toFixed(4)} ${Math.sin(a).toFixed(4)} ${(-Math.sin(a)).toFixed(4)} ${Math.cos(a).toFixed(4)} 300 ${l.y} Tm` : `72 ${l.y} Td`;
    const rg = l.color ? `${l.color.join(' ')} rg ` : '';
    return `BT ${rg}/F1 ${l.size} Tf ${pos} (${esc(l.text)}) Tj ET`;
  }).join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
