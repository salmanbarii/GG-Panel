import { createUser, findUserByUsername } from '../src/server/services/userStore.js';
import { ensureDataDirs } from '../src/server/utils/paths.js';
import type { UserRole } from '../src/types/index.js';

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const ALLOWED_ROLES = ['user', 'admin', 'owner'] as const;

interface Args {
  username?: string;
  password?: string;
  email?: string;
  role?: UserRole;
  help: boolean;
}

function parseArgs(): Args {
  const args: Args = { help: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--username':
        args.username = argv[++i];
        break;
      case '--password':
        args.password = argv[++i];
        break;
      case '--email':
        args.email = argv[++i];
        break;
      case '--role':
        args.role = argv[++i] as UserRole;
        break;
      default:
        if (a.startsWith('-')) {
          console.error(`Unknown flag: ${a}`);
          usage();
          process.exit(1);
        }
    }
  }
  return args;
}

function usage(): void {
  console.log(`
GG Panel — create user script

Usage:
  tsx scripts/createuser.ts [flags]

Flags:
  --username <u>   Username (min 3 chars)
  --password <p>   Password (min 6 chars)
  --email <e>      Optional email address
  --role <r>       Role: user | admin | owner (default: user)
  --help, -h       Show this help
`);
}

async function prompt(question: string, hide = false): Promise<string> {
  const rl = readline.createInterface({ input, output, terminal: true });
  try {
    if (hide && input.isTTY) {
      // Mask keystrokes for password entry.
      const muted = output as typeof output & { muted?: boolean };
      const originalWrite = output.write.bind(output);
      let masking = false;
      (output as unknown as { write: typeof output.write }).write = ((
        chunk: string | Uint8Array,
        ...rest: unknown[]
      ) => {
        if (masking && typeof chunk === 'string' && !chunk.includes('\n')) {
          return originalWrite('*');
        }
        return (originalWrite as (c: string | Uint8Array, ...r: unknown[]) => boolean)(
          chunk,
          ...rest,
        );
      }) as typeof output.write;

      const pending = rl.question(question);
      masking = true;
      const answer = await pending;
      masking = false;
      (output as unknown as { write: typeof output.write }).write = originalWrite;
      output.write('\n');
      void muted;
      return answer;
    }

    return await rl.question(question);
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    usage();
    process.exit(0);
  }

  await ensureDataDirs();

  // ── interactive mode ─────────────────────────────────────────────────────
  let username = args.username;
  let password = args.password;
  let email = args.email;
  let role: UserRole = args.role ?? 'user';

  if (!username) {
    username = await prompt('Username: ');
  }
  if (!password) {
    password = await prompt('Password: ');
  }
  if (!email) {
    email = await prompt('Email (optional): ');
    if (!email.trim()) email = undefined;
  }
  if (!args.role) {
    const inputRole = await prompt('Role (user|admin|owner) [user]: ');
    role = (inputRole.trim() || 'user') as UserRole;
  }

  // ── validate ─────────────────────────────────────────────────────────────
  const errors: string[] = [];
  if (!username || username.trim().length < 3) {
    errors.push('Username must be at least 3 characters.');
  }
  if (!password || password.length < 6) {
    errors.push('Password must be at least 6 characters.');
  }
  if (!ALLOWED_ROLES.includes(role)) {
    errors.push(`Role must be one of: ${ALLOWED_ROLES.join(', ')}.`);
  }

  if (errors.length > 0) {
    console.error('[createuser] ✖');
    for (const e of errors) {
      console.error(`  ${e}`);
    }
    process.exit(1);
  }

  // ── duplicate check ──────────────────────────────────────────────────────
  const existing = await findUserByUsername(username.trim());
  if (existing) {
    console.error(`[createuser] ✖ Username "${username.trim()}" is already taken.`);
    process.exit(1);
  }

  // ── create ───────────────────────────────────────────────────────────────
  const user = await createUser({
    username: username.trim(),
    password,
    email: email?.trim(),
    role,
  });

  console.log(`[createuser] ✔ User created successfully.`);
  console.log(`  id       : ${user.id}`);
  console.log(`  username : ${user.username}`);
  console.log(`  role     : ${user.role}`);
}

main().catch((err) => {
  console.error(`[createuser] ✖ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
