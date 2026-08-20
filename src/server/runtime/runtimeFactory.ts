import type { GameServer } from '../../types/index.js';
import { dockerRuntime, isDockerAvailable } from './docker.js';
import { localRuntime } from './local.js';
import { isWingsNode, wingsRuntime } from './wings.js';
import type { RuntimeProvider } from './types.js';

/**
 * Picks the provider for a server:
 *   wings node  → Wings
 *   runtimeType === 'local' → host process
 *   otherwise   → Docker (falls back to local when the daemon is unreachable)
 */
export async function getRuntime(server: GameServer): Promise<RuntimeProvider> {
  if (await isWingsNode(server.nodeId)) return wingsRuntime;
  if (server.runtimeType === 'local') return localRuntime;
  if (server.runtimeType === 'wings') return wingsRuntime;

  if (!(await isDockerAvailable())) {
    // Never hard-fail an existing server just because Docker went away.
    return localRuntime;
  }
  return dockerRuntime;
}

/** Runtime chosen strictly by type, used during creation and migrations. */
export function getRuntimeByType(type: 'docker' | 'local' | 'wings'): RuntimeProvider {
  if (type === 'local') return localRuntime;
  if (type === 'wings') return wingsRuntime;
  return dockerRuntime;
}

export { dockerRuntime, localRuntime, wingsRuntime };
export type { RuntimeProvider };
