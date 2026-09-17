import AdmZip from 'adm-zip';
import Papa from 'papaparse';

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
  const lines = csv.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => /^"?(First Name|Company Name|School Name|Title|Name|Notes",?$)/i.test(l.trim()) && !/^Notes:/i.test(l));
  const body = headerIdx > 0 ? lines.slice(headerIdx).join('\n') : csv;
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
  const zip = new AdmZip(buffer);
  const entries = zip
    .getEntries()
    .filter((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith('.csv'))
    .map((e) => ({ name: e.entryName.split('/').pop() || e.entryName, text: e.getData().toString('utf8') }));

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
  };
}
