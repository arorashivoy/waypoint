import { createInterface } from 'node:readline';
import { currentAdmin, setupAdmin } from '../src/lib/auth/admin-setup';
import { db } from '../src/lib/db';

/**
 * Sets up the admin account. Run it after `prisma migrate deploy`:
 *   npm run user:create-admin
 * It asks for the email, the name and the password. The password does not show.
 */

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
let muted = false;
const writer = rl as unknown as { _writeToOutput: (s: string) => void };
const write = writer._writeToOutput.bind(rl);
writer._writeToOutput = (s: string) => (muted ? process.stdout.write(s.includes('\n') ? '\n' : '') : write(s));

// Lines that arrive before a question is asked wait in `lines`. This lets piped input answer each prompt in order.
const lines: string[] = [];
let waiting: ((line: string) => void) | null = null;
let closed = false;
rl.on('line', (line) => {
  if (waiting) {
    const resolve = waiting;
    waiting = null;
    resolve(line);
  } else {
    lines.push(line);
  }
});
rl.on('close', () => {
  closed = true;
});

function ask(q: string): Promise<string> {
  process.stdout.write(q);
  if (lines.length > 0) return Promise.resolve(lines.shift() as string);
  if (closed) return Promise.reject(new Error('No more input.'));
  return new Promise<string>((resolve) => {
    waiting = resolve;
  });
}

async function askHidden(q: string): Promise<string> {
  muted = true;
  const answer = await ask(q);
  muted = false;
  return answer;
}

async function main() {
  const now = await currentAdmin();
  const email = (await ask(`Admin email${now ? ` [${now.email}]` : ''}: `)).trim() || now?.email || '';
  const name = (await ask(`Name${now ? ` [${now.name}]` : ''}: `)).trim() || now?.name || '';
  const password = await askHidden('Password (12 characters or more): ');
  const again = await askHidden('Type the password again: ');
  if (password !== again) throw new Error('The 2 passwords are not the same.');
  const r = await setupAdmin({ email, name, password });
  const shown = email.trim().toLowerCase();
  console.log(r.action === 'created' ? `Made the admin account ${shown}.` : `Updated the admin account ${shown}. Its old sessions are ended.`);
}

main()
  .catch((e) => {
    console.error(`Error: ${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await db.$disconnect();
  });
