import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { basename } from 'path';

/**
 * Uploads a tailored CV to Google Drive and returns a link a recruiter can open.
 *
 * OAuth as him rather than a service account: a service account has no consumer
 * Drive quota, so uploads into a personal Drive fail unless a Workspace shared
 * drive exists. A refresh token makes every file owned by him, stored against
 * his own 15 GB, revocable from his Google account page, and deletable by hand.
 *
 * The scope is `drive.file` — this app can only ever see the files it created
 * itself. It cannot read the rest of his Drive, and asking for a wider scope to
 * upload one PDF would be the wrong trade even though it is easier.
 *
 * Talks to the REST API through `fetch` rather than pulling in `googleapis`,
 * which is a very large dependency for three endpoints.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink';
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';

const env = (k: string) => {
  const v = (process.env[k] || '').trim();
  return v ? v : null;
};

export type DriveConfig = { clientId: string; clientSecret: string; refreshToken: string; folderId: string | null };

export function driveConfig(): DriveConfig | null {
  const clientId = env('GDRIVE_CLIENT_ID');
  const clientSecret = env('GDRIVE_CLIENT_SECRET');
  const refreshToken = env('GDRIVE_REFRESH_TOKEN');
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken, folderId: env('GDRIVE_FOLDER_ID') };
}

/** Access tokens last an hour; one is cached per process rather than minted per
 *  upload, with a minute of slack so a token never expires mid-request. */
let token: { value: string; expires: number } | null = null;

async function accessToken(cfg: DriveConfig): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data: any = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || `token request failed (${res.status})`);
  token = { value: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 };
  return token.value;
}

/** A filename a referrer can make sense of in their downloads folder. */
const safe = (s: string) => s.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

export type Shared = { url: string; id: string; name: string };

/**
 * Uploads one PDF and makes it readable by anyone holding the link.
 *
 * "Anyone with the link" is what makes the link work in a LinkedIn message, and
 * it is also genuinely public to whoever it is forwarded to — his phone number
 * and email are in that document. It is deliberately not "public on the web":
 * Drive does not index these, and any one of them can be revoked later from
 * the file's sharing menu.
 */
export async function uploadResume(pdfPath: string, company: string, role: string): Promise<Shared> {
  const cfg = driveConfig();
  if (!cfg) throw new Error('Google Drive is not configured');

  const bytes = readFileSync(pdfPath);
  // Owner name comes from WAYPOINT_NAME in .env, e.g. "Jane Doe" -> "JaneDoe-CV-...".
  const owner = safe((process.env.WAYPOINT_NAME || '').replace(/\s+/g, ''));
  const name = `${owner ? `${owner}-` : ''}CV-${safe(company)}-${safe(role)}.pdf`;
  const metadata: Record<string, unknown> = { name, mimeType: 'application/pdf' };
  if (cfg.folderId) metadata.parents = [cfg.folderId];

  const boundary = `waypoint-${createHash('sha1').update(name).digest('hex').slice(0, 16)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);

  const at = await accessToken(cfg);
  const res = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${at}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: new Uint8Array(Buffer.concat([head, new Uint8Array(bytes), tail])),
  });
  const file: any = await res.json();
  if (!res.ok) throw new Error(file?.error?.message || `upload failed (${res.status})`);

  const perm = await fetch(`${FILES_URL}/${file.id}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });
  if (!perm.ok) {
    const e: any = await perm.json().catch(() => ({}));
    throw new Error(e?.error?.message || `uploaded, but could not share it (${perm.status})`);
  }

  return { url: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`, id: file.id, name };
}

/**
 * The link for one built CV, uploading it the first time and reusing it after.
 *
 * The record sits in a `.link.json` beside the PDF, whose own filename already
 * contains a hash of the rendered LaTeX. So a rebuild that selects the same
 * order reuses the same Drive file, and a genuinely different CV gets a new
 * one — which is the behaviour the per-job choice needs: a referrer who opens
 * last month's link still sees the CV that was tailored for their company.
 *
 * Never throws. A failed upload costs the link, not the referral.
 */
export async function shareResume(pdfPath: string, company: string, role: string): Promise<{ url: string | null; reason: string | null }> {
  if (!driveConfig()) return { url: null, reason: 'Google Drive is not configured — see GDRIVE_* in .env.example' };
  if (!pdfPath || !existsSync(pdfPath)) return { url: null, reason: 'there is no CV file to upload' };

  const sidecar = `${pdfPath}.link.json`;
  if (existsSync(sidecar)) {
    try {
      const cached = JSON.parse(readFileSync(sidecar, 'utf8'));
      if (cached?.url) return { url: cached.url, reason: null };
    } catch {
      // corrupt sidecar; fall through and upload again
    }
  }

  try {
    const shared = await uploadResume(pdfPath, company, role);
    writeFileSync(sidecar, JSON.stringify({ ...shared, file: basename(pdfPath), at: new Date().toISOString() }, null, 2));
    return { url: shared.url, reason: null };
  } catch (e) {
    return { url: null, reason: `Drive upload failed: ${(e as Error).message}` };
  }
}
