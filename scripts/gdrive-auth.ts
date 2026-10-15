/**
 * One-time Google Drive consent, to get the refresh token Waypoint uploads with.
 *
 *   npm run gdrive:auth
 *
 * Before running it, once, at https://console.cloud.google.com:
 *   1. create a project (any name),
 *   2. APIs & Services → Library → enable "Google Drive API",
 *   3. Google Auth Platform → Audience → External, then Publish app ("In production").
 *      Left in "Testing", Google expires the refresh token after 7 days;
 *      drive.file is a non-sensitive scope, so publishing needs no review,
 *   4. Credentials → Create credentials → OAuth client ID → Desktop app,
 *   5. put the client id and secret in .env as GDRIVE_CLIENT_ID / _SECRET.
 *
 * The scope requested is `drive.file`: Waypoint can only ever touch files it
 * created itself. It cannot read anything else in your Drive, and Google's
 * consent screen will say so.
 *
 * The refresh token this prints is a long-lived credential. It goes in .env,
 * which is gitignored, and nowhere else. Revoke it any time at
 * https://myaccount.google.com/permissions.
 */
import { createServer } from 'http';

const CLIENT_ID = (process.env.GDRIVE_CLIENT_ID || '').trim();
const CLIENT_SECRET = (process.env.GDRIVE_CLIENT_SECRET || '').trim();
const PORT = Number(process.env.GDRIVE_AUTH_PORT) || 3119;
const REDIRECT = `http://localhost:${PORT}/callback`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set GDRIVE_CLIENT_ID and GDRIVE_CLIENT_SECRET in .env first — see the comment at the top of this file.');
  process.exit(1);
}

const url =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/drive.file',
    // Google only returns a refresh token on the first consent, so force the
    // prompt: a second run that silently returned none is a confusing failure.
    access_type: 'offline',
    prompt: 'consent',
  });

const server = createServer(async (req, res) => {
  const code = new URL(req.url || '', `http://localhost:${PORT}`).searchParams.get('code');
  if (!code) {
    res.writeHead(400).end('No code in the callback.');
    return;
  }
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT,
        grant_type: 'authorization_code',
      }),
    });
    const data: any = await r.json();
    if (!r.ok || !data.refresh_token) throw new Error(data.error_description || data.error || 'no refresh token returned');

    res.writeHead(200, { 'Content-Type': 'text/html' }).end(
      '<h2>Done.</h2><p>The refresh token is in your terminal. You can close this tab.</p>',
    );
    console.log('\nAdd this to .env:\n');
    console.log(`GDRIVE_REFRESH_TOKEN=${data.refresh_token}\n`);
    console.log('Optional — upload into one folder instead of the Drive root. Create a folder,');
    console.log('open it, and copy the id out of the URL:\n');
    console.log('GDRIVE_FOLDER_ID=1AbC...\n');
  } catch (e) {
    res.writeHead(500).end(String((e as Error).message));
    console.error('Failed:', (e as Error).message);
  } finally {
    server.close();
    setTimeout(() => process.exit(0), 100);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Listening on ${REDIRECT}\nOpen this URL in a browser on this machine:\n\n${url}\n`);
});
