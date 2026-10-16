/**
 * Maintenance commands, run inside the container:
 *
 *   docker compose exec app node dist/cli.js reset-admin [username]
 *
 * reset-admin: for a forgotten admin password. Re-enables and unlocks the account, makes sure
 * it is an ADMIN, sets a temporary password (printed once) and signs out its sessions.
 * Without a username it uses INITIAL_ADMIN_USERNAME, or else the oldest admin.
 */
import dotenv from 'dotenv';
import { parseConfig } from './config.js';
import { loginThrottle } from './db/schema.js';
import { logger } from './logger.js';
import { createServices } from './services.js';
import { eq } from 'drizzle-orm';

dotenv.config({ quiet: true });

const [command, arg] = process.argv.slice(2);

function usage(): never {
  console.log('Usage: node dist/cli.js reset-admin [username]');
  process.exit(command ? 1 : 0);
}

if (command !== 'reset-admin') usage();

const parsed = parseConfig(process.env);
if (!parsed.ok) {
  console.error('Settings problems:\n' + parsed.errors.map((e) => '  • ' + e).join('\n'));
  process.exit(1);
}
logger.level = 'warn';
const svc = createServices(parsed.config, logger);
const ctx = { actor: { userId: null, username: 'system', role: null }, userAgent: 'cli reset-admin' } as const;

const target = svc.users.findAdminForRecovery(arg);
if (!target) {
  console.error(arg ? `No user called "${arg}".` : 'No admin account exists yet. Start the app once with INITIAL_ADMIN_* set.');
  svc.sqlite.close();
  process.exit(1);
}

svc.users.restoreAdmin(ctx, target.id);
svc.db.delete(loginThrottle).where(eq(loginThrottle.username, target.username.toLowerCase())).run();
const temp = await svc.users.resetPassword(ctx, target.id, 'cli');
svc.sqlite.close();

console.log(`
Admin account "${target.username}" is ready.

  Temporary password:  ${temp}

Sign in with it; you will be asked to choose a new password straight away.
This reset was written to the audit log.
`);
