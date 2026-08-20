import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api } from '@/lib/api';

/**
 * Global upload queue. Uploads keep running while the user navigates, which is
 * why the state lives in a context instead of inside <FileManager>.
 * Files above CHUNK_THRESHOLD are sent in 8 MB chunks and assembled server-side.
 */

const CHUNK_SIZE = 8 * 1024 * 1024;
const CHUNK_THRESHOLD = 16 * 1024 * 1024;

export interface UploadTask {
  id: string;
  serverId: string;
  filename: string;
  targetPath: string;
  size: number;
  uploaded: number;
  progress: number;
  status: 'queued' | 'uploading' | 'done' | 'error' | 'cancelled';
  error?: string;
  chunked: boolean;
  startedAt: number;
}

interface UploadContextValue {
  uploads: UploadTask[];
  activeCount: number;
  enqueue: (input: {
    serverId: string;
    file: File;
    targetPath: string;
    autoExtract?: boolean;
    onComplete?: () => void;
  }) => Promise<void>;
  cancel: (id: string) => void;
  clearFinished: () => void;
}

const UploadContext = createContext<UploadContextValue | null>(null);

export function UploadProvider({ children }: { children: ReactNode }) {
  const [uploads, setUploads] = useState<UploadTask[]>([]);
  const controllers = useRef(new Map<string, AbortController>());

  const patch = useCallback((id: string, changes: Partial<UploadTask>) => {
    setUploads((current) => current.map((task) => (task.id === id ? { ...task, ...changes } : task)));
  }, []);

  const enqueue = useCallback(
    async ({
      serverId,
      file,
      targetPath,
      autoExtract,
      onComplete,
    }: {
      serverId: string;
      file: File;
      targetPath: string;
      autoExtract?: boolean;
      onComplete?: () => void;
    }) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const chunked = file.size > CHUNK_THRESHOLD;

      const task: UploadTask = {
        id,
        serverId,
        filename: file.name,
        targetPath,
        size: file.size,
        uploaded: 0,
        progress: 0,
        status: 'uploading',
        chunked,
        startedAt: Date.now(),
      };
      setUploads((current) => [...current, task]);

      const controller = new AbortController();
      controllers.current.set(id, controller);

      try {
        if (!chunked) {
          const form = new FormData();
          form.append('files', file);
          form.append('path', targetPath);

          await api.post(`/servers/${serverId}/files/upload`, form, {
            signal: controller.signal,
            onUploadProgress: (event) => {
              const total = event.total ?? file.size;
              patch(id, {
                uploaded: event.loaded,
                progress: Math.min(100, Math.round((event.loaded / total) * 100)),
              });
            },
          });
        } else {
          const uploadId = `${id}-${file.name.replace(/[^a-z0-9.-]/gi, '_')}`.slice(0, 80);
          const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

          for (let index = 0; index < totalChunks; index += 1) {
            if (controller.signal.aborted) throw new Error('Upload cancelled');

            const start = index * CHUNK_SIZE;
            const blob = file.slice(start, Math.min(start + CHUNK_SIZE, file.size));

            const form = new FormData();
            form.append('chunk', blob, `${file.name}.part${index}`);
            form.append('uploadId', uploadId);
            form.append('chunkIndex', String(index));
            form.append('totalChunks', String(totalChunks));

            await api.post(`/servers/${serverId}/files/upload-chunk`, form, {
              signal: controller.signal,
              onUploadProgress: (event) => {
                const chunkLoaded = event.loaded ?? 0;
                const uploaded = Math.min(file.size, start + chunkLoaded);
                patch(id, {
                  uploaded,
                  progress: Math.min(99, Math.round((uploaded / file.size) * 100)),
                });
              },
            });
          }

          await api.post(`/servers/${serverId}/files/upload-complete`, {
            uploadId,
            filename: file.name,
            totalChunks,
            path: targetPath,
            autoExtract: Boolean(autoExtract),
          });
        }

        patch(id, { status: 'done', progress: 100, uploaded: file.size });
        onComplete?.();
      } catch (err) {
        const cancelled = controller.signal.aborted;
        patch(id, {
          status: cancelled ? 'cancelled' : 'error',
          error: cancelled ? 'Cancelled' : err instanceof Error ? err.message : 'Upload failed',
        });
      } finally {
        controllers.current.delete(id);
      }
    },
    [patch],
  );

  const cancel = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
  }, []);

  const clearFinished = useCallback(() => {
    setUploads((current) => current.filter((task) => task.status === 'uploading' || task.status === 'queued'));
  }, []);

  const value = useMemo<UploadContextValue>(
    () => ({
      uploads,
      activeCount: uploads.filter((u) => u.status === 'uploading' || u.status === 'queued').length,
      enqueue,
      cancel,
      clearFinished,
    }),
    [uploads, enqueue, cancel, clearFinished],
  );

  return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>;
}

export function useUploads(): UploadContextValue {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error('useUploads must be used inside <UploadProvider>');
  return ctx;
}
