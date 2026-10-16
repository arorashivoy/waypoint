import AdmZip from 'adm-zip';
import Papa from 'papaparse';
import { HttpError } from './auth/http';

export const MAX_EXPORT_BYTES = 50 * 1024 * 1024;
/** The largest total size of the CSV files in an archive, after unpacking. */
export const MAX_UNPACKED_BYTES = 200 * 1024 * 1024;
const TOO_LARGE = 'The file is larger than 50 MB.';

/**
 * Checks the Content-Length of an upload before the body is read. A missing
 * or false length is refused too, so a client cannot send a body of any size.
 * The 1 MB extra is room for the multipart framing around the file.
 */
export function checkUploadLength(headers: Headers): void {
  const raw = headers.get('content-length');
  const length = raw && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
  if (!Number.isFinite(length) || length > MAX_EXPORT_BYTES + 1024 * 1024) throw new HttpError(413, TOO_LARGE);
}

/**
 * Checks a LinkedIn upload before it is parsed: 50 MB or less, and the bytes
 * must be a zip archive (PK\x03\x04) or a text CSV file. The name alone
 * proves nothing.
 */
export async function checkExportUpload(file: File): Promise<Buffer> {
  if (file.size > MAX_EXPORT_BYTES) throw new HttpError(413, TOO_LARGE);
  const buf = Buffer.from(await file.arrayBuffer());
  const isZip = buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  const head = buf.subarray(0, 4096);
  const isCsv = /\.csv$/i.test(file.name) && !head.includes(0) && !head.subarray(0, 5).equals(Buffer.from('%PDF-'));
  if (!isZip && !isCsv) throw new HttpError(400, 'Upload the LinkedIn export as a .zip file, or Connections.csv.');
  return buf;
}

/**
 * Parses a LinkedIn "Get a copy of your data" export.
 *
 * Sign in with LinkedIn (OpenID Connect) returns name, email and picture — and
 * nothing else. Experience, education, projects and, critically, connections
 * only exist in the export archive, so this is the only way Waypoint can find a
 * 1st-degree contact at a hiring company.
 */

export type ImportedProfile = {
  headline: string;
  positions: { title: string; company: string; location: string | null; startedAt: Date | null; endedAt: Date | null; summary: string | null }[];
  educations: { school: string; degree: string | null; field: string | null; years: string | null }[];
  projects: { title: string; org: string | null; description: string | null; url: string | null }[];
  skills: string[];
  contacts: { firstName: string; lastName: string; company: string | null; position: string | null; profileUrl: string | null; connectedAt: Date | null }[];
  counts: Record<string, number>;
  /** False for a bare Connections.csv, which says nothing about the rest of the profile. */
  archive: boolean;
};

/** LinkedIn writes dates as "Mar 2024", "2024", or occasionally "3/15/2024". */
function parseDate(v: string | undefined): Date | null {
  const s = (v || '').trim();
  if (!s) return null;
  const d = new Date(s.length === 4 ? `Jan ${s}` : s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Connections.csv ships with a three-line "Notes:" preamble above the real
 * header, so a naive parse yields one garbage column. Drop everything before the
 * line that looks like the header.
 */
function rows(csv: string): Record<string, string>[] {
  // A CSV re-saved from Excel gains a BOM, which would otherwise glue itself to "First Name".
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => /^"?(First Name|Company Name|School Name|Title|Name|Notes",?$)/i.test(l.trim()) && !/^Notes:/i.test(l));
  const body = lines.slice(Math.max(headerIdx, 0)).join('\n');
  const out = Papa.parse<Record<string, string>>(body, { header: true, skipEmptyLines: true });
  return (out.data || []).filter((r) => Object.values(r).some((v) => (v || '').trim()));
}

const pick = (entries: { name: string; text: string }[], ...names: string[]) => {
  for (const n of names) {
    const hit = entries.find((e) => e.name.toLowerCase() === n.toLowerCase());
    if (hit) return rows(hit.text);
  }
  return [];
};

export function parseExport(buffer: Buffer): ImportedProfile {
  // Every zip starts with the local-file-header magic "PK"; anything else is
  // taken to be Connections.csv on its own, uploaded to refresh contacts.
  const archive = buffer.subarray(0, 2).toString('latin1') === 'PK';
  let entries: { name: string; text: string }[];
  if (archive) {
    const csvs = new AdmZip(buffer).getEntries().filter((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith('.csv'));
    // The header sizes come from the central directory. Check them before
    // any entry unpacks, so a small zip cannot fill the memory.
    const unpacked = csvs.reduce((sum, e) => sum + e.header.size, 0);
    if (unpacked > MAX_UNPACKED_BYTES) throw new HttpError(413, 'The CSV files in the archive are larger than 200 MB after unpacking.');
    entries = csvs.map((e) => ({ name: e.entryName.split('/').pop() || e.entryName, text: e.getData().toString('utf8') }));
  } else {
    entries = [{ name: 'Connections.csv', text: buffer.toString('utf8') }];
  }

  const profileRows = pick(entries, 'Profile.csv');
  const headline = profileRows[0]?.['Headline'] || '';

  const positions = pick(entries, 'Positions.csv').map((r) => ({
    title: r['Title'] || '',
    company: r['Company Name'] || '',
    location: r['Location'] || null,
    startedAt: parseDate(r['Started On']),
    endedAt: parseDate(r['Finished On']),
    summary: r['Description'] || null,
  })).filter((p) => p.title && p.company);

  const educations = pick(entries, 'Education.csv').map((r) => ({
    school: r['School Name'] || '',
    degree: r['Degree Name'] || null,
    field: r['Notes'] || null,
    years: [r['Start Date'], r['End Date']].filter(Boolean).join(' – ') || null,
  })).filter((e) => e.school);

  const projects = pick(entries, 'Projects.csv').map((r) => ({
    title: r['Title'] || '',
    org: null,
    description: r['Description'] || null,
    url: r['Url'] || null,
  })).filter((p) => p.title);

  const skills = pick(entries, 'Skills.csv').map((r) => r['Name'] || '').filter(Boolean);

  const contacts = pick(entries, 'Connections.csv').map((r) => ({
    firstName: (r['First Name'] || '').trim(),
    lastName: (r['Last Name'] || '').trim(),
    company: (r['Company'] || '').trim() || null,
    position: (r['Position'] || '').trim() || null,
    profileUrl: (r['URL'] || '').trim() || null,
    connectedAt: parseDate(r['Connected On']),
  })).filter((c) => c.firstName || c.lastName);

  return {
    headline,
    positions,
    educations,
    projects,
    skills,
    contacts,
    counts: {
      positions: positions.length,
      educations: educations.length,
      projects: projects.length,
      skills: skills.length,
      contacts: contacts.length,
    },
    archive,
  };
}
