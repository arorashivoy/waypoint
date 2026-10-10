// The npm scripts pass the port as `next -p`, which the shell expands before Next
// loads .env, so a PORT written in .env would never reach it. Precedence matches
// Next's own: the shell's PORT, then .env, then the default.
import { readFileSync } from 'node:fs';

let port = process.env.PORT;
if (!port) {
  try {
    port = readFileSync('.env', 'utf8').match(/^PORT=["']?(\d+)["']?\s*$/m)?.[1];
  } catch {}
}
process.stdout.write(port || '3117');
