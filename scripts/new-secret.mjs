// Prints a new WAYPOINT_SECRET_KEY line. Append it to .env; do not replace the file.
import { randomBytes } from 'node:crypto';
console.log(`WAYPOINT_SECRET_KEY=${randomBytes(32).toString('base64')}`);
