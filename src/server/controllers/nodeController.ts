import type { Response } from 'express';
import { asyncHandler, httpError, requireString } from '../utils/http.js';
import type { AuthedRequest } from '../middleware/auth.js';
import {
  addCustomNode,
  addWingsNode,
  deleteCustomNode,
  deleteWingsNode,
  listAllNodes,
  localNode,
} from '../services/nodeService.js';
import { findWingsNode, listWingsNodes, wingsHealth } from '../runtime/wings.js';

/** GET /api/nodes */
export const list = asyncHandler<AuthedRequest>(async (_req, res: Response) => {
  res.json({ nodes: await listAllNodes() });
});

/** GET /api/nodes/local */
export const local = asyncHandler<AuthedRequest>(async (_req, res: Response) => {
  res.json({ node: await localNode() });
});

/** POST /api/nodes — custom (informational) node. */
export const create = asyncHandler<AuthedRequest>(async (req, res: Response) => {
  const node = await addCustomNode({
    name: requireString(req.body?.name, 'name'),
    hostname: requireString(req.body?.hostname ?? req.body?.host, 'hostname'),
    port: req.body?.port === undefined ? undefined : Number(req.body.port),
  });
  res.status(201).json({ node });
});

/** DELETE /api/nodes/:id */
export const remove = asyncHandler<AuthedRequest>(async (req, res: Response) => {
  if (req.params.id === 'local') throw httpError(400, 'The built-in node cannot be removed');

  // The id may belong to either collection.
  const wings = await findWingsNode(req.params.id);
  if (wings) {
    await deleteWingsNode(req.params.id);
  } else {
    await deleteCustomNode(req.params.id);
  }
  res.json({ success: true });
});

/** GET /api/nodes/wings */
export const listWings = asyncHandler<AuthedRequest>(async (_req, res: Response) => {
  const nodes = await listWingsNodes();
  // Never leak daemon tokens to the frontend.
  res.json({
    nodes: nodes.map(({ token, ...rest }) => ({ ...rest, tokenSet: Boolean(token) })),
  });
});

/** POST /api/nodes/wings */
export const createWings = asyncHandler<AuthedRequest>(async (req, res: Response) => {
  const node = await addWingsNode({
    name: requireString(req.body?.name, 'name'),
    url: requireString(req.body?.url, 'url'),
    token: requireString(req.body?.token, 'token'),
  });

  const health = await wingsHealth(node);
  const { token: _token, ...safe } = node;
  res.status(201).json({ node: safe, health });
});

/** DELETE /api/nodes/wings/:id */
export const removeWings = asyncHandler<AuthedRequest>(async (req, res: Response) => {
  await deleteWingsNode(req.params.id);
  res.json({ success: true });
});

/** GET /api/nodes/wings/:id/health */
export const wingsHealthHandler = asyncHandler<AuthedRequest>(async (req, res: Response) => {
  const node = await findWingsNode(req.params.id);
  if (!node) throw httpError(404, 'Wings node not found');
  res.json(await wingsHealth(node));
});
