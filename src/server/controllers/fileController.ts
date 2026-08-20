import type { Response } from 'express';
import fs from 'fs-extra';
import path from 'node:path';
import archiver from 'archiver';
import AdmZip from 'adm-zip';
import type { FileEntry, FileListing } from '../../types/index.js';
import { asyncHandler, httpError, requireString } from '../utils/http.js';
import { currentServer, type ServerRequest } from '../middleware/serverAccess.js';
import { safeServerPath, serverDir, TMP_DIR } from '../utils/paths.js';
import { isTextFile, looksBinary, sanitizeFilename } from '../utils/fsUtils.js';

/**
 * Server file manager. Every path is resolved through `safeServerPath` so a
 * request can never escape `.data/servers/<id>/`.
 */

interface UploadRequest extends ServerRequest {
  file?: Express.Multer.File;
  files?: Express.Multer.File[] | { [field: string]: Express.Multer.File[] };
}

/** Normalise multer's single/array/fields shapes into a flat list. */
function uploadedFiles(req: UploadRequest): Express.Multer.File[] {
  const collected: Express.Multer.File[] = [];
  if (Array.isArray(req.files)) {
    collected.push(...req.files);
  } else if (req.files && typeof req.files === 'object') {
    for (const group of Object.values(req.files)) collected.push(...group);
  }
  if (req.file) collected.push(req.file);
  return collected;
}

function relative(serverId: string, absolute: string): string {
  const rel = path.relative(serverDir(serverId), absolute).replace(/\\/g, '/');
  return `/${rel}`.replace(/\/+$/, '') || '/';
}

async function toEntry(serverId: string, dir: string, name: string): Promise<FileEntry | null> {
  const absolute = path.join(dir, name);
  try {
    const stats = await fs.lstat(absolute);
    const isSymlink = stats.isSymbolicLink();
    const target = isSymlink ? await fs.stat(absolute).catch(() => null) : stats;
    return {
      name,
      path: relative(serverId, absolute),
      isDirectory: target?.isDirectory() ?? false,
      size: target?.size ?? 0,
      modifiedAt: (target ?? stats).mtime.toISOString(),
      mode: ((target ?? stats).mode & 0o777).toString(8),
      isSymlink,
    };
  } catch {
    return null;
  }
}

/** GET /api/servers/:id/files?path=/ */
export const listDirectory = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  const requested = String(req.query.path ?? '/');
  const absolute = safeServerPath(server.id, requested);

  await fs.ensureDir(serverDir(server.id));
  const stats = await fs.stat(absolute).catch(() => null);
  if (!stats) throw httpError(404, 'Directory not found');
  if (!stats.isDirectory()) throw httpError(400, 'Not a directory');

  const names = await fs.readdir(absolute);
  const entries = (await Promise.all(names.map((name) => toEntry(server.id, absolute, name))))
    .filter((entry): entry is FileEntry => entry !== null)
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });

  const currentPath = relative(server.id, absolute);
  const listing: FileListing = {
    path: currentPath,
    parent: currentPath === '/' ? null : path.posix.dirname(currentPath) || '/',
    entries,
  };
  res.json(listing);
});

/** GET /api/servers/:id/files/download?path=/logs/latest.log */
export const download = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  const absolute = safeServerPath(server.id, String(req.query.path ?? ''));
  const stats = await fs.stat(absolute).catch(() => null);
  if (!stats) throw httpError(404, 'File not found');

  if (stats.isDirectory()) {
    // Directories stream as a zip so the UI can offer "download folder".
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${sanitizeFilename(path.basename(absolute) || 'folder')}.zip"`,
    );
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => res.destroy(err));
    archive.pipe(res);
    archive.directory(absolute, false);
    await archive.finalize();
    return;
  }

  res.download(absolute, path.basename(absolute));
});

/** GET /api/servers/:id/files/content?path=/server.properties */
export const readContent = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  const requested = String(req.query.path ?? '');
  const absolute = safeServerPath(server.id, requested);

  const stats = await fs.stat(absolute).catch(() => null);
  if (!stats) throw httpError(404, 'File not found');
  if (stats.isDirectory()) throw httpError(400, 'Cannot open a directory in the editor');
  if (stats.size > 8 * 1024 * 1024) throw httpError(413, 'File is too large to edit (max 8 MB)');

  if (!isTextFile(absolute) && (await looksBinary(absolute))) {
    throw httpError(415, 'This looks like a binary file and cannot be edited as text');
  }

  const content = await fs.readFile(absolute, 'utf8');
  res.json({
    path: relative(server.id, absolute),
    content,
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
  });
});

/** POST /api/servers/:id/files/upload — single/multi file via multer. */
export const upload = asyncHandler<UploadRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  const targetDir = safeServerPath(server.id, String(req.body?.path ?? '/'));
  await fs.ensureDir(targetDir);

  const files = uploadedFiles(req);
  if (!files.length) throw httpError(400, 'No file was uploaded');

  const saved: string[] = [];
  for (const file of files) {
    const destination = path.join(targetDir, sanitizeFilename(file.originalname));
    await fs.move(file.path, destination, { overwrite: true });
    saved.push(relative(server.id, destination));
  }

  res.status(201).json({ success: true, files: saved });
});

/**
 * POST /api/servers/:id/files/upload-chunk
 * Body: uploadId, chunkIndex, totalChunks, filename, path + `chunk` file field.
 */
export const uploadChunk = asyncHandler<UploadRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  const uploadId = sanitizeFilename(requireString(req.body?.uploadId, 'uploadId'));
  const chunkIndex = Number.parseInt(String(req.body?.chunkIndex ?? ''), 10);
  const totalChunks = Number.parseInt(String(req.body?.totalChunks ?? ''), 10);

  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) throw httpError(400, 'Invalid chunkIndex');
  if (!Number.isInteger(totalChunks) || totalChunks < 1) throw httpError(400, 'Invalid totalChunks');
  if (!req.file) throw httpError(400, 'No chunk was uploaded');

  const chunkDir = path.join(TMP_DIR, 'chunks', server.id, uploadId);
  await fs.ensureDir(chunkDir);
  await fs.move(req.file.path, path.join(chunkDir, String(chunkIndex).padStart(6, '0')), {
    overwrite: true,
  });

  const received = (await fs.readdir(chunkDir)).length;
  res.json({
    success: true,
    uploadId,
    chunkIndex,
    received,
    totalChunks,
    complete: received >= totalChunks,
  });
});

/** POST /api/servers/:id/files/upload-complete — assemble the chunks. */
export const uploadComplete = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  const uploadId = sanitizeFilename(requireString(req.body?.uploadId, 'uploadId'));
  const filename = sanitizeFilename(requireString(req.body?.filename, 'filename'));
  const totalChunks = Number.parseInt(String(req.body?.totalChunks ?? ''), 10);

  const chunkDir = path.join(TMP_DIR, 'chunks', server.id, uploadId);
  if (!(await fs.pathExists(chunkDir))) throw httpError(404, 'Upload session not found');

  const chunks = (await fs.readdir(chunkDir)).sort();
  if (Number.isInteger(totalChunks) && chunks.length !== totalChunks) {
    throw httpError(409, `Missing chunks: expected ${totalChunks}, received ${chunks.length}`);
  }

  const targetDir = safeServerPath(server.id, String(req.body?.path ?? '/'));
  await fs.ensureDir(targetDir);
  const destination = path.join(targetDir, filename);

  const writeStream = fs.createWriteStream(destination);
  try {
    for (const chunk of chunks) {
      const buffer = await fs.readFile(path.join(chunkDir, chunk));
      await new Promise<void>((resolve, reject) => {
        writeStream.write(buffer, (err) => (err ? reject(err) : resolve()));
      });
    }
  } finally {
    await new Promise<void>((resolve) => writeStream.end(() => resolve()));
    await fs.remove(chunkDir).catch(() => undefined);
  }

  const stats = await fs.stat(destination);

  // Auto-extract world/modpack archives when the client asks for it.
  if (req.body?.autoExtract === true || req.body?.autoExtract === 'true') {
    if (destination.toLowerCase().endsWith('.zip')) {
      const zip = new AdmZip(destination);
      zip.extractAllTo(targetDir, true);
    }
  }

  res.status(201).json({
    success: true,
    file: relative(server.id, destination),
    size: stats.size,
  });
});

/** POST /api/servers/:id/files/rename */
export const rename = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  const from = safeServerPath(server.id, requireString(req.body?.from ?? req.body?.path, 'from'));
  const to = safeServerPath(server.id, requireString(req.body?.to ?? req.body?.newPath, 'to'));

  if (!(await fs.pathExists(from))) throw httpError(404, 'Source file not found');
  if (await fs.pathExists(to)) throw httpError(409, 'A file with that name already exists');

  await fs.ensureDir(path.dirname(to));
  await fs.move(from, to);
  res.json({ success: true, path: relative(server.id, to) });
});

/** POST /api/servers/:id/files/save — write editor content. */
export const save = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  const absolute = safeServerPath(server.id, requireString(req.body?.path, 'path'));
  const content = typeof req.body?.content === 'string' ? req.body.content : '';

  await fs.ensureDir(path.dirname(absolute));
  await fs.writeFile(absolute, content, 'utf8');

  const stats = await fs.stat(absolute);
  res.json({
    success: true,
    path: relative(server.id, absolute),
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
  });
});

/** POST /api/servers/:id/files/create — new empty file. */
export const createFile = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  const absolute = safeServerPath(server.id, requireString(req.body?.path, 'path'));
  if (await fs.pathExists(absolute)) throw httpError(409, 'File already exists');

  await fs.ensureDir(path.dirname(absolute));
  await fs.writeFile(absolute, typeof req.body?.content === 'string' ? req.body.content : '', 'utf8');
  res.status(201).json({ success: true, path: relative(server.id, absolute) });
});

/** POST /api/servers/:id/files/mkdir */
export const mkdir = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  const absolute = safeServerPath(server.id, requireString(req.body?.path, 'path'));
  if (await fs.pathExists(absolute)) throw httpError(409, 'That folder already exists');
  await fs.ensureDir(absolute);
  res.status(201).json({ success: true, path: relative(server.id, absolute) });
});

/** POST /api/servers/:id/files/unzip */
export const unzip = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  const absolute = safeServerPath(server.id, requireString(req.body?.path, 'path'));
  if (!(await fs.pathExists(absolute))) throw httpError(404, 'Archive not found');
  if (!absolute.toLowerCase().endsWith('.zip')) throw httpError(400, 'Only .zip archives are supported');

  const destination = req.body?.destination
    ? safeServerPath(server.id, String(req.body.destination))
    : path.dirname(absolute);

  await fs.ensureDir(destination);

  const zip = new AdmZip(absolute);
  // Reject archives containing traversal entries.
  for (const entry of zip.getEntries()) {
    const resolved = path.resolve(destination, entry.entryName);
    if (!resolved.startsWith(path.resolve(destination))) {
      throw httpError(400, `Archive contains an unsafe path: ${entry.entryName}`);
    }
  }
  zip.extractAllTo(destination, true);

  res.json({ success: true, path: relative(server.id, destination) });
});

/** POST /api/servers/:id/files/zip — zip selected paths. */
export const zip = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  const rawPaths: unknown = req.body?.paths ?? req.body?.files;
  const targets = Array.isArray(rawPaths) ? rawPaths.map(String) : [];
  if (!targets.length) throw httpError(400, 'At least one path is required');

  const destinationDir = safeServerPath(server.id, String(req.body?.destination ?? '/'));
  await fs.ensureDir(destinationDir);

  const suggested = String(req.body?.name ?? '').trim();
  const archiveName = sanitizeFilename(
    suggested ||
      (targets.length === 1
        ? `${path.basename(targets[0]) || 'archive'}.zip`
        : `archive-${Date.now()}.zip`),
  );
  const finalName = archiveName.toLowerCase().endsWith('.zip') ? archiveName : `${archiveName}.zip`;
  const archivePath = path.join(destinationDir, finalName);

  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(archivePath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);

    void (async () => {
      try {
        for (const target of targets) {
          const absolute = safeServerPath(server.id, target);
          const stats = await fs.stat(absolute).catch(() => null);
          if (!stats) continue;
          if (stats.isDirectory()) {
            archive.directory(absolute, path.basename(absolute));
          } else {
            archive.file(absolute, { name: path.basename(absolute) });
          }
        }
        await archive.finalize();
      } catch (err) {
        reject(err);
      }
    })();
  });

  const stats = await fs.stat(archivePath);
  res.status(201).json({
    success: true,
    path: relative(server.id, archivePath),
    size: stats.size,
  });
});

/** DELETE /api/servers/:id/files?path=/foo — accepts a single path or a list. */
export const remove = asyncHandler<ServerRequest>(async (req, res: Response) => {
  const server = currentServer(req);
  const bodyPaths: unknown = req.body?.paths;
  const targets = Array.isArray(bodyPaths)
    ? bodyPaths.map(String)
    : [String(req.query.path ?? req.body?.path ?? '')];

  if (!targets.filter(Boolean).length) throw httpError(400, 'path is required');

  const deleted: string[] = [];
  for (const target of targets.filter(Boolean)) {
    const absolute = safeServerPath(server.id, target);
    if (absolute === serverDir(server.id)) {
      throw httpError(400, 'The server root cannot be deleted');
    }
    if (!(await fs.pathExists(absolute))) continue;
    await fs.remove(absolute);
    deleted.push(relative(server.id, absolute));
  }

  res.json({ success: true, deleted });
});
