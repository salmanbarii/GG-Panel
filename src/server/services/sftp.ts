import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'fs-extra';
import bcrypt from 'bcryptjs';
import ssh2 from 'ssh2';
import type { Attributes, Server as SSH2Server } from 'ssh2';
import type { SftpCredentials, SftpUser } from '../../types/index.js';
import { FILES, readJSON, updateJSON } from '../utils/jsonStore.js';
import { SSH_DIR, safeJoin, serverDir } from '../utils/paths.js';
import { config } from '../utils/config.js';

// ssh2 is CommonJS: destructure at runtime so Node's ESM loader stays happy.
const { Server: SSHServer, utils: sshUtils } = ssh2;

/**
 * Built-in SFTP server.
 *
 * Each panel server gets an SFTP account whose session is chrooted to
 * `.data/servers/<id>/`. Passwords are bcrypt hashed in sftp_users.json.
 * Runs on 6868 (prod) / 6869 (dev).
 */

const SFTP_STATUS = sshUtils.sftp.STATUS_CODE;
const OPEN_MODE = sshUtils.sftp.OPEN_MODE;

interface OpenHandle {
  type: 'file';
  fd: number;
  filePath: string;
}

interface DirHandle {
  type: 'dir';
  dirPath: string;
  entries: string[] | null;
  offset: number;
}

type Handle = OpenHandle | DirHandle;

// ── host key ───────────────────────────────────────────────────────────────
export async function ensureHostKey(): Promise<Buffer> {
  await fs.ensureDir(SSH_DIR);
  const keyPath = path.join(SSH_DIR, 'ssh_host_rsa_key');

  if (await fs.pathExists(keyPath)) {
    return fs.readFile(keyPath);
  }

  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    // ssh2 expects a traditional PKCS#1 "RSA PRIVATE KEY" PEM, not PKCS#8.
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });

  await fs.writeFile(keyPath, privateKey, { mode: 0o600 });
  await fs.writeFile(`${keyPath}.pub`, publicKey, { mode: 0o644 });
  return Buffer.from(privateKey);
}

// ── user store ─────────────────────────────────────────────────────────────
export async function listSftpUsers(): Promise<SftpUser[]> {
  return readJSON<SftpUser[]>(FILES.sftpUsers, []);
}

export async function findSftpUserByServer(serverId: string): Promise<SftpUser | undefined> {
  return (await listSftpUsers()).find((u) => u.serverId === serverId);
}

export async function findSftpUserByUsername(username: string): Promise<SftpUser | undefined> {
  const lower = username.trim().toLowerCase();
  return (await listSftpUsers()).find((u) => u.username.toLowerCase() === lower);
}

function generatePassword(): string {
  // Avoid ambiguous characters so credentials can be typed by hand.
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(20))
    .map((byte) => alphabet[byte % alphabet.length])
    .join('');
}

export function sftpUsernameFor(serverName: string, serverId: string): string {
  const slug = serverName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 12) || 'server';
  return `${slug}.${serverId.slice(0, 8)}`;
}

/** Create or reset the SFTP account for a server; returns the plaintext password once. */
export async function upsertSftpUser(
  serverId: string,
  serverName: string,
): Promise<SftpCredentials & { password: string }> {
  const existing = await findSftpUserByServer(serverId);
  const username = existing?.username ?? sftpUsernameFor(serverName, serverId);
  const password = generatePassword();
  const record: SftpUser = {
    serverId,
    username,
    password_hash: await bcrypt.hash(password, 10),
    homePath: serverDir(serverId),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };

  await updateJSON<SftpUser[]>(FILES.sftpUsers, [], (current) => [
    ...current.filter((u) => u.serverId !== serverId),
    record,
  ]);

  return {
    host: config.publicHost || '',
    port: config.sftpPort,
    username,
    password,
    exists: true,
  };
}

export async function deleteSftpUser(serverId: string): Promise<void> {
  await updateJSON<SftpUser[]>(FILES.sftpUsers, [], (current) =>
    current.filter((u) => u.serverId !== serverId),
  );
}

export async function getSftpCredentials(serverId: string): Promise<SftpCredentials> {
  const user = await findSftpUserByServer(serverId);
  return {
    host: config.publicHost || '',
    port: config.sftpPort,
    username: user?.username ?? '',
    exists: Boolean(user),
  };
}

// ── protocol helpers ───────────────────────────────────────────────────────
function statsToAttrs(stats: fs.Stats): Attributes {
  return {
    mode: stats.mode,
    uid: stats.uid,
    gid: stats.gid,
    size: stats.size,
    atime: Math.floor(stats.atimeMs / 1000),
    mtime: Math.floor(stats.mtimeMs / 1000),
  };
}

function longname(name: string, stats: fs.Stats): string {
  const type = stats.isDirectory() ? 'd' : stats.isSymbolicLink() ? 'l' : '-';
  const perms = (stats.mode & 0o777).toString(8).padStart(3, '0');
  const rwx = perms
    .split('')
    .map((digit) => {
      const n = Number(digit);
      return `${n & 4 ? 'r' : '-'}${n & 2 ? 'w' : '-'}${n & 1 ? 'x' : '-'}`;
    })
    .join('');
  const date = stats.mtime.toISOString().slice(0, 16).replace('T', ' ');
  return `${type}${rwx} 1 panel panel ${String(stats.size).padStart(12)} ${date} ${name}`;
}

function flagsToFsMode(flags: number): string {
  if (flags & OPEN_MODE.APPEND) return 'a';
  if (flags & OPEN_MODE.WRITE) {
    if (flags & OPEN_MODE.READ) return flags & OPEN_MODE.TRUNC ? 'w+' : 'r+';
    return flags & OPEN_MODE.EXCL ? 'wx' : 'w';
  }
  return 'r';
}

// ── server ─────────────────────────────────────────────────────────────────
let sftpServer: SSH2Server | null = null;

export interface SftpServerHandle {
  close: () => Promise<void>;
  port: number;
}

export async function startSftpServer(): Promise<SftpServerHandle | null> {
  if (sftpServer) return { close: stopSftpServer, port: config.sftpPort };

  const hostKey = await ensureHostKey();

  const server = new SSHServer(
    {
      hostKeys: [hostKey],
      banner: 'JTG Panel SFTP',
      ident: 'JTG-Panel-SFTP',
    },
    (client) => {
      let sftpUser: SftpUser | null = null;

      client.on('authentication', (ctx) => {
        void (async () => {
          try {
            if (ctx.method !== 'password') {
              ctx.reject(['password'], false);
              return;
            }
            const user = await findSftpUserByUsername(ctx.username);
            if (!user) {
              // Constant-ish time rejection to avoid username probing.
              await bcrypt.compare(ctx.password, '$2a$10$invalidsaltinvalidsaltiv');
              ctx.reject(['password'], false);
              return;
            }
            const ok = await bcrypt.compare(ctx.password, user.password_hash);
            if (!ok) {
              ctx.reject(['password'], false);
              return;
            }
            sftpUser = user;
            ctx.accept();
          } catch {
            ctx.reject(['password'], false);
          }
        })();
      });

      client.on('ready', () => {
        client.on('session', (acceptSession) => {
          const session = acceptSession();

          session.on('sftp', (acceptSftp) => {
            const sftp = acceptSftp();
            const jail = sftpUser ? sftpUser.homePath : '/nonexistent';
            void fs.ensureDir(jail).catch(() => undefined);

            const handles = new Map<number, Handle>();
            let nextHandle = 0;

            const allocate = (handle: Handle): Buffer => {
              const id = nextHandle++;
              handles.set(id, handle);
              const buffer = Buffer.alloc(4);
              buffer.writeUInt32BE(id, 0);
              return buffer;
            };

            const lookup = (raw: Buffer): Handle | undefined => {
              if (raw.length !== 4) return undefined;
              return handles.get(raw.readUInt32BE(0));
            };

            const release = (raw: Buffer): Handle | undefined => {
              if (raw.length !== 4) return undefined;
              const id = raw.readUInt32BE(0);
              const handle = handles.get(id);
              handles.delete(id);
              return handle;
            };

            const resolve = (requestPath: string): string => safeJoin(jail, requestPath);

            const fail = (reqId: number, err: unknown) => {
              const code = (err as NodeJS.ErrnoException)?.code;
              if (code === 'ENOENT') return sftp.status(reqId, SFTP_STATUS.NO_SUCH_FILE);
              if (code === 'EACCES' || code === 'EPERM') {
                return sftp.status(reqId, SFTP_STATUS.PERMISSION_DENIED);
              }
              if (code === 'EEXIST') return sftp.status(reqId, SFTP_STATUS.FAILURE);
              return sftp.status(reqId, SFTP_STATUS.FAILURE);
            };

            // OPEN
            sftp.on('OPEN', (reqId, filename, flags) => {
              void (async () => {
                try {
                  const target = resolve(filename);
                  await fs.ensureDir(path.dirname(target));
                  const fd = await fs.open(target, flagsToFsMode(flags));
                  sftp.handle(reqId, allocate({ type: 'file', fd, filePath: target }));
                } catch (err) {
                  fail(reqId, err);
                }
              })();
            });

            // READ
            sftp.on('READ', (reqId, rawHandle, offset, length) => {
              void (async () => {
                const handle = lookup(rawHandle);
                if (!handle || handle.type !== 'file') {
                  sftp.status(reqId, SFTP_STATUS.FAILURE);
                  return;
                }
                try {
                  const buffer = Buffer.alloc(length);
                  const { bytesRead } = await fs.read(handle.fd, buffer, 0, length, offset);
                  if (bytesRead === 0) {
                    sftp.status(reqId, SFTP_STATUS.EOF);
                    return;
                  }
                  sftp.data(reqId, buffer.subarray(0, bytesRead));
                } catch (err) {
                  fail(reqId, err);
                }
              })();
            });

            // WRITE
            sftp.on('WRITE', (reqId, rawHandle, offset, data) => {
              void (async () => {
                const handle = lookup(rawHandle);
                if (!handle || handle.type !== 'file') {
                  sftp.status(reqId, SFTP_STATUS.FAILURE);
                  return;
                }
                try {
                  await fs.write(handle.fd, data, 0, data.length, offset);
                  sftp.status(reqId, SFTP_STATUS.OK);
                } catch (err) {
                  fail(reqId, err);
                }
              })();
            });

            // CLOSE
            sftp.on('CLOSE', (reqId, rawHandle) => {
              void (async () => {
                const handle = release(rawHandle);
                if (handle?.type === 'file') {
                  await fs.close(handle.fd).catch(() => undefined);
                }
                sftp.status(reqId, SFTP_STATUS.OK);
              })();
            });

            // STAT / LSTAT / FSTAT
            const doStat = (reqId: number, target: string, useLstat: boolean) => {
              void (async () => {
                try {
                  const stats = useLstat ? await fs.lstat(target) : await fs.stat(target);
                  sftp.attrs(reqId, statsToAttrs(stats));
                } catch (err) {
                  fail(reqId, err);
                }
              })();
            };

            sftp.on('STAT', (reqId, filename) => {
              try {
                doStat(reqId, resolve(filename), false);
              } catch (err) {
                fail(reqId, err);
              }
            });

            sftp.on('LSTAT', (reqId, filename) => {
              try {
                doStat(reqId, resolve(filename), true);
              } catch (err) {
                fail(reqId, err);
              }
            });

            sftp.on('FSTAT', (reqId, rawHandle) => {
              const handle = lookup(rawHandle);
              if (!handle) {
                sftp.status(reqId, SFTP_STATUS.FAILURE);
                return;
              }
              doStat(reqId, handle.type === 'file' ? handle.filePath : handle.dirPath, false);
            });

            // SETSTAT / FSETSTAT — apply chmod/utimes where possible.
            const applyAttrs = (reqId: number, target: string, attrs: Attributes) => {
              void (async () => {
                try {
                  if (typeof attrs.mode === 'number') {
                    await fs.chmod(target, attrs.mode & 0o777).catch(() => undefined);
                  }
                  if (typeof attrs.atime === 'number' && typeof attrs.mtime === 'number') {
                    await fs.utimes(target, attrs.atime, attrs.mtime).catch(() => undefined);
                  }
                  sftp.status(reqId, SFTP_STATUS.OK);
                } catch (err) {
                  fail(reqId, err);
                }
              })();
            };

            sftp.on('SETSTAT', (reqId, filename, attrs) => {
              try {
                applyAttrs(reqId, resolve(filename), attrs);
              } catch (err) {
                fail(reqId, err);
              }
            });

            sftp.on('FSETSTAT', (reqId, rawHandle, attrs) => {
              const handle = lookup(rawHandle);
              if (!handle) {
                sftp.status(reqId, SFTP_STATUS.FAILURE);
                return;
              }
              applyAttrs(reqId, handle.type === 'file' ? handle.filePath : handle.dirPath, attrs);
            });

            // OPENDIR
            sftp.on('OPENDIR', (reqId, dirPath) => {
              void (async () => {
                try {
                  const target = resolve(dirPath);
                  const stats = await fs.stat(target);
                  if (!stats.isDirectory()) {
                    sftp.status(reqId, SFTP_STATUS.FAILURE);
                    return;
                  }
                  sftp.handle(
                    reqId,
                    allocate({ type: 'dir', dirPath: target, entries: null, offset: 0 }),
                  );
                } catch (err) {
                  fail(reqId, err);
                }
              })();
            });

            // READDIR — paged, returns EOF once exhausted.
            sftp.on('READDIR', (reqId, rawHandle) => {
              void (async () => {
                const handle = lookup(rawHandle);
                if (!handle || handle.type !== 'dir') {
                  sftp.status(reqId, SFTP_STATUS.FAILURE);
                  return;
                }
                try {
                  if (handle.entries === null) {
                    handle.entries = await fs.readdir(handle.dirPath);
                  }
                  if (handle.offset >= handle.entries.length) {
                    sftp.status(reqId, SFTP_STATUS.EOF);
                    return;
                  }

                  const page = handle.entries.slice(handle.offset, handle.offset + 50);
                  handle.offset += page.length;

                  const names = [];
                  for (const name of page) {
                    try {
                      const stats = await fs.lstat(path.join(handle.dirPath, name));
                      names.push({
                        filename: name,
                        longname: longname(name, stats),
                        attrs: statsToAttrs(stats),
                      });
                    } catch {
                      /* entry vanished between readdir and lstat */
                    }
                  }
                  sftp.name(reqId, names);
                } catch (err) {
                  fail(reqId, err);
                }
              })();
            });

            // REMOVE
            sftp.on('REMOVE', (reqId, filename) => {
              void (async () => {
                try {
                  await fs.unlink(resolve(filename));
                  sftp.status(reqId, SFTP_STATUS.OK);
                } catch (err) {
                  fail(reqId, err);
                }
              })();
            });

            // RMDIR
            sftp.on('RMDIR', (reqId, dirPath) => {
              void (async () => {
                try {
                  await fs.rmdir(resolve(dirPath));
                  sftp.status(reqId, SFTP_STATUS.OK);
                } catch (err) {
                  fail(reqId, err);
                }
              })();
            });

            // MKDIR
            sftp.on('MKDIR', (reqId, dirPath) => {
              void (async () => {
                try {
                  await fs.ensureDir(resolve(dirPath));
                  sftp.status(reqId, SFTP_STATUS.OK);
                } catch (err) {
                  fail(reqId, err);
                }
              })();
            });

            // RENAME
            sftp.on('RENAME', (reqId, oldPath, newPath) => {
              void (async () => {
                try {
                  await fs.move(resolve(oldPath), resolve(newPath), { overwrite: false });
                  sftp.status(reqId, SFTP_STATUS.OK);
                } catch (err) {
                  fail(reqId, err);
                }
              })();
            });

            // REALPATH — everything is relative to the jail root.
            sftp.on('REALPATH', (reqId, requestPath) => {
              void (async () => {
                try {
                  const target = resolve(requestPath);
                  const rel = `/${path.relative(jail, target).replace(/\\/g, '/')}`.replace(
                    /\/+$/,
                    '',
                  );
                  const normalized = rel === '' ? '/' : rel;
                  let attrs: Attributes = {
                    mode: 0o755,
                    size: 0,
                    uid: 0,
                    gid: 0,
                    atime: 0,
                    mtime: 0,
                  };
                  try {
                    attrs = statsToAttrs(await fs.stat(target));
                  } catch {
                    /* path may not exist yet (e.g. upload target) */
                  }
                  sftp.name(reqId, [{ filename: normalized, longname: normalized, attrs }]);
                } catch (err) {
                  fail(reqId, err);
                }
              })();
            });

            sftp.on('READLINK', (reqId, linkPath) => {
              void (async () => {
                try {
                  const target = await fs.readlink(resolve(linkPath));
                  const attrs: Attributes = {
                    mode: 0o777,
                    uid: 0,
                    gid: 0,
                    size: 0,
                    atime: 0,
                    mtime: 0,
                  };
                  sftp.name(reqId, [{ filename: target, longname: target, attrs }]);
                } catch (err) {
                  fail(reqId, err);
                }
              })();
            });

            // Symlinks are intentionally refused: they could escape the jail.
            sftp.on('SYMLINK', (reqId) => sftp.status(reqId, SFTP_STATUS.OP_UNSUPPORTED));

            const cleanup = () => {
              for (const handle of handles.values()) {
                if (handle.type === 'file') void fs.close(handle.fd).catch(() => undefined);
              }
              handles.clear();
            };

            sftp.on('end', cleanup);
            sftp.on('close', cleanup);
          });

          // Reject shell/exec: this is an SFTP-only endpoint.
          session.on('shell', (_accept, reject) => reject());
          session.on('exec', (_accept, reject) => reject());
        });
      });

      client.on('error', () => undefined);
    },
  );

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.sftpPort, config.sftpHost, () => {
      server.off('error', reject);
      resolve();
    });
  });

  sftpServer = server;
  console.log(`[sftp] listening on ${config.sftpHost}:${config.sftpPort}`);
  return { close: stopSftpServer, port: config.sftpPort };
}

export async function stopSftpServer(): Promise<void> {
  if (!sftpServer) return;
  await new Promise<void>((resolve) => sftpServer?.close(() => resolve()));
  sftpServer = null;
}

/** Exposed for tests / diagnostics. */
export function isSftpRunning(): boolean {
  return sftpServer !== null;
}

export { sshUtils };
