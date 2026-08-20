import { Router } from 'express';
import multer from 'multer';
import fs from 'fs-extra';
import { TMP_DIR } from '../utils/paths.js';
import { config } from '../utils/config.js';
import { requireAdmin, requireAuth, requireScope } from '../middleware/auth.js';
import { loadServer } from '../middleware/serverAccess.js';
import { notFoundHandler } from '../utils/http.js';

import * as auth from '../controllers/authController.js';
import * as servers from '../controllers/serverController.js';
import * as files from '../controllers/fileController.js';
import * as backups from '../controllers/backupController.js';
import * as world from '../controllers/worldController.js';
import * as addons from '../controllers/addonController.js';
import * as players from '../controllers/playerController.js';
import * as properties from '../controllers/propertiesController.js';
import * as sftp from '../controllers/sftpController.js';
import * as playit from '../controllers/playitController.js';
import * as nodes from '../controllers/nodeController.js';
import * as system from '../controllers/systemController.js';
import * as apiKeys from '../controllers/apiKeyController.js';
import * as ai from '../controllers/aiController.js';

/** Uploads land in `.data/tmp/uploads` then get moved into the server dir. */
const uploadDir = `${TMP_DIR}/uploads`;
fs.ensureDirSync(uploadDir);

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: config.maxUploadBytes },
});

export function createApiRouter(): Router {
  const api = Router();

  // ── public ───────────────────────────────────────────────────────────────
  api.get('/settings', system.publicSettings);
  api.post('/auth/register', auth.register);
  api.post('/auth/login', auth.login);
  api.post('/webhook/github-update', system.githubWebhook);

  // ── authenticated ────────────────────────────────────────────────────────
  api.get('/auth/me', requireAuth, auth.me);
  api.put('/auth/me', requireAuth, auth.updateMe);

  // ── servers ──────────────────────────────────────────────────────────────
  const s = Router();
  s.use(requireAuth);

  s.get('/', requireScope('servers:read'), servers.list);
  s.get('/totals', requireScope('servers:read'), servers.totals);
  s.get('/check-port', requireScope('servers:read'), servers.checkPortHandler);
  s.get('/versions', requireScope('servers:read'), servers.versions);
  s.post('/', requireScope('servers:write'), servers.create);

  s.get('/:id', requireScope('servers:read'), loadServer(undefined, { allowSuspended: true }), servers.get);
  s.put('/:id', requireScope('servers:write'), loadServer('settings'), servers.update);
  s.delete('/:id', requireScope('servers:write'), loadServer(undefined, { allowSuspended: true }), servers.remove);

  // power
  s.post('/:id/start', requireScope('servers:power'), loadServer('power'), servers.start);
  s.post('/:id/stop', requireScope('servers:power'), loadServer('power'), servers.stop);
  s.post('/:id/restart', requireScope('servers:power'), loadServer('power'), servers.restart);
  s.post('/:id/command', requireScope('servers:power'), loadServer('console'), servers.command);

  // telemetry
  s.get('/:id/stats', requireScope('servers:read'), loadServer(undefined, { allowSuspended: true }), servers.stats);
  s.get('/:id/logs', requireScope('servers:read'), loadServer('console'), servers.logs);

  // configuration
  s.put('/:id/resources', requireScope('servers:write'), loadServer('settings'), servers.resources);
  s.put('/:id/version', requireScope('servers:write'), loadServer('settings'), servers.version);
  s.put('/:id/migrate-runtime', requireScope('servers:write'), loadServer('settings'), servers.migrate);
  s.put('/:id/ipalias', requireScope('servers:write'), loadServer('settings'), servers.ipAlias);
  s.post('/:id/redownload-jar', requireScope('servers:write'), loadServer('settings'), servers.reinstall);
  s.post('/:id/reinstall', requireScope('servers:write'), loadServer('settings'), servers.reinstall);

  // admin-only server mutations
  s.put('/:id/suspend', requireAdmin, loadServer(undefined, { allowSuspended: true }), servers.suspend);
  s.put('/:id/owner', requireAdmin, loadServer(undefined, { allowSuspended: true }), servers.owner);

  // sub-users
  s.get('/:id/subusers', loadServer('settings'), servers.listSubUsers);
  s.post('/:id/subusers', loadServer('settings'), servers.addSubUser);
  s.put('/:id/subusers/:userId', loadServer('settings'), servers.updateSubUser);
  s.delete('/:id/subusers/:userId', loadServer('settings'), servers.removeSubUser);

  // ── files ────────────────────────────────────────────────────────────────
  s.get('/:id/files', requireScope('files:read'), loadServer('files'), files.listDirectory);
  s.get('/:id/files/download', requireScope('files:read'), loadServer('files'), files.download);
  s.get('/:id/files/content', requireScope('files:read'), loadServer('files'), files.readContent);
  s.post(
    '/:id/files/upload',
    requireScope('files:write'),
    loadServer('files'),
    upload.array('files', 25),
    files.upload,
  );
  s.post(
    '/:id/files/upload-chunk',
    requireScope('files:write'),
    loadServer('files'),
    upload.single('chunk'),
    files.uploadChunk,
  );
  s.post('/:id/files/upload-complete', requireScope('files:write'), loadServer('files'), files.uploadComplete);
  s.post('/:id/files/rename', requireScope('files:write'), loadServer('files'), files.rename);
  s.post('/:id/files/save', requireScope('files:write'), loadServer('files'), files.save);
  s.post('/:id/files/create', requireScope('files:write'), loadServer('files'), files.createFile);
  s.post('/:id/files/mkdir', requireScope('files:write'), loadServer('files'), files.mkdir);
  s.post('/:id/files/unzip', requireScope('files:write'), loadServer('files'), files.unzip);
  s.post('/:id/files/zip', requireScope('files:write'), loadServer('files'), files.zip);
  s.delete('/:id/files', requireScope('files:write'), loadServer('files'), files.remove);

  // ── backups ──────────────────────────────────────────────────────────────
  s.get('/:id/backups', requireScope('backups:read'), loadServer('backups'), backups.list);
  s.post('/:id/backups', requireScope('backups:write'), loadServer('backups'), backups.create);
  s.get('/:id/backups/:filename', requireScope('backups:read'), loadServer('backups'), backups.download);
  s.delete('/:id/backups/:filename', requireScope('backups:write'), loadServer('backups'), backups.remove);
  s.post(
    '/:id/backups/:filename/restore',
    requireScope('backups:write'),
    loadServer('backups'),
    backups.restore,
  );

  // ── world ────────────────────────────────────────────────────────────────
  s.get('/:id/world/info', loadServer('world'), world.info);
  s.post('/:id/world/analyze', loadServer('world'), world.analyze);
  s.post('/:id/world/import', loadServer('world'), upload.single('world'), world.importWorldHandler);

  // ── plugins & mods ───────────────────────────────────────────────────────
  for (const kind of ['plugins', 'mods'] as const) {
    s.get(`/:id/${kind}`, loadServer('plugins'), addons.list);
    s.get(`/:id/${kind}/search`, loadServer('plugins'), addons.search);
    s.post(`/:id/${kind}`, loadServer('plugins'), addons.install);
    s.delete(`/:id/${kind}/:filename`, loadServer('plugins'), addons.remove);
    s.post(`/:id/${kind}/:filename/toggle`, loadServer('plugins'), addons.toggle);
  }

  // ── players ──────────────────────────────────────────────────────────────
  s.get('/:id/players', loadServer('players'), players.list);
  s.post('/:id/players/:action', loadServer('players'), players.action);

  // ── properties ───────────────────────────────────────────────────────────
  s.get('/:id/properties', loadServer('settings'), properties.get);
  s.put('/:id/properties', loadServer('settings'), properties.update);

  // ── sftp ─────────────────────────────────────────────────────────────────
  s.get('/:id/sftp', loadServer('sftp'), sftp.get);
  s.post('/:id/sftp', loadServer('sftp'), sftp.reset);
  s.delete('/:id/sftp', loadServer('sftp'), sftp.remove);

  // ── playit ───────────────────────────────────────────────────────────────
  s.get('/:id/playit', loadServer('settings'), playit.get);
  s.post('/:id/playit', loadServer('settings'), playit.start);
  s.put('/:id/playit', loadServer('settings'), playit.update);
  s.delete('/:id/playit', loadServer('settings'), playit.stop);

  // ── per-server AI ────────────────────────────────────────────────────────
  s.post('/:id/ai/analyze', loadServer('console'), ai.analyze);
  s.post('/:id/ai/optimize', loadServer('console'), ai.optimize);

  api.use('/servers', s);

  // ── nodes ────────────────────────────────────────────────────────────────
  const n = Router();
  n.use(requireAuth);
  n.get('/', requireScope('nodes:read'), nodes.list);
  n.get('/local', requireScope('nodes:read'), nodes.local);
  n.get('/wings', requireAdmin, nodes.listWings);
  n.post('/wings', requireAdmin, nodes.createWings);
  n.delete('/wings/:id', requireAdmin, nodes.removeWings);
  n.get('/wings/:id/health', requireAdmin, nodes.wingsHealthHandler);
  n.post('/', requireAdmin, nodes.create);
  n.delete('/:id', requireAdmin, nodes.remove);
  api.use('/nodes', n);

  // ── system ───────────────────────────────────────────────────────────────
  const sys = Router();
  sys.use(requireAuth);
  sys.get('/stats', system.stats);
  sys.put('/settings', requireAdmin, system.updateSettings);
  sys.post('/update', requireAdmin, system.update);
  sys.get('/update-status', requireAdmin, system.updateStatusStream);
  sys.get('/update-status.json', requireAdmin, system.updateStatusJson);
  sys.post('/reboot', requireAdmin, system.reboot);
  sys.get('/users', requireAdmin, system.listUsersHandler);
  sys.post('/users', requireAdmin, system.createUserHandler);
  sys.put('/users/:id', requireAdmin, system.updateUserHandler);
  sys.delete('/users/:id', requireAdmin, system.deleteUserHandler);
  api.use('/system', sys);

  // ── admin ────────────────────────────────────────────────────────────────
  const admin = Router();
  admin.use(requireAuth);
  admin.get('/servers', requireAdmin, servers.adminList);
  admin.get('/api-keys', apiKeys.list);
  admin.post('/api-keys', apiKeys.create);
  admin.put('/api-keys/:id', apiKeys.update);
  admin.delete('/api-keys/:id', apiKeys.remove);
  api.use('/admin', admin);

  // Convenience aliases used by the account page.
  api.get('/api-keys', requireAuth, apiKeys.list);
  api.post('/api-keys', requireAuth, apiKeys.create);
  api.delete('/api-keys/:id', requireAuth, apiKeys.remove);

  // ── ai ───────────────────────────────────────────────────────────────────
  api.get('/ai/status', requireAuth, ai.status);
  api.post('/ai/ask', requireAuth, ai.ask);
  api.post('/ai/explain-property', requireAuth, ai.explain);

  api.use(notFoundHandler);
  return api;
}
