import { useCallback, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { RotateCw, Upload, ZoomIn } from 'lucide-react';
import { Modal } from './Modal';
import { Spinner } from './Loaders';

/**
 * Avatar / logo / background cropper. Returns a base64 data-url, which is what
 * the backend stores for `avatar`, `panelLogo` and `panelBackgroundImage`.
 */

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that image'));
    reader.readAsDataURL(file);
  });
}

async function renderCrop(
  imageSrc: string,
  crop: Area,
  rotation: number,
  maxSize: number,
  quality: number,
): Promise<string> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.crossOrigin = 'anonymous';
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('Could not decode that image'));
    element.src = imageSrc;
  });

  const scale = Math.min(1, maxSize / Math.max(crop.width, crop.height));
  const outWidth = Math.max(1, Math.round(crop.width * scale));
  const outHeight = Math.max(1, Math.round(crop.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable in this browser');

  if (rotation) {
    // Rotate around the centre of the output canvas.
    ctx.translate(outWidth / 2, outHeight / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-outWidth / 2, -outHeight / 2);
  }

  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    outWidth,
    outHeight,
  );

  return canvas.toDataURL('image/jpeg', quality);
}

export function ImageCropper({
  open,
  onClose,
  onCropped,
  title = 'Crop image',
  aspect = 1,
  round = false,
  maxSize = 512,
  quality = 0.88,
  initialImage,
}: {
  open: boolean;
  onClose: () => void;
  onCropped: (dataUrl: string) => void | Promise<void>;
  title?: string;
  aspect?: number;
  round?: boolean;
  maxSize?: number;
  quality?: number;
  initialImage?: string;
}) {
  const [image, setImage] = useState<string | null>(initialImage ?? null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCropComplete = useCallback((_croppedArea: Area, croppedAreaPixels: Area) => {
    setArea(croppedAreaPixels);
  }, []);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('Image is too large (max 20 MB)');
      return;
    }
    setError(null);
    setImage(await readFileAsDataUrl(file));
    setZoom(1);
    setRotation(0);
    setCrop({ x: 0, y: 0 });
  };

  const apply = async () => {
    if (!image || !area) return;
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await renderCrop(image, area, rotation, maxSize, quality);
      await onCropped(dataUrl);
      setImage(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not crop that image');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <>
          <button type="button" className="panel-btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="panel-btn-primary"
            onClick={() => void apply()}
            disabled={!image || !area || busy}
          >
            {busy && <Spinner />}
            Apply
          </button>
        </>
      }
    >
      {!image ? (
        <label className="flex h-56 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-white/15 bg-black/30 transition hover:border-theme-500/40 hover:bg-theme-500/5">
          <Upload className="h-7 w-7 text-zinc-500" />
          <span className="text-sm text-zinc-400">Click to choose an image</span>
          <span className="text-xs text-zinc-600">PNG, JPG, WebP or GIF — up to 20 MB</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => void pick(event.target.files?.[0])}
          />
        </label>
      ) : (
        <div className="space-y-4">
          <div className="relative h-72 overflow-hidden rounded-xl bg-black">
            <Cropper
              image={image}
              crop={crop}
              zoom={zoom}
              rotation={rotation}
              aspect={aspect}
              cropShape={round ? 'round' : 'rect'}
              showGrid={!round}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              objectFit="contain"
            />
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex min-w-48 flex-1 items-center gap-2">
              <ZoomIn className="h-4 w-4 shrink-0 text-zinc-500" />
              <input
                type="range"
                min={1}
                max={4}
                step={0.01}
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10
                  [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
                  [&::-webkit-slider-thumb]:bg-theme-500"
              />
            </div>
            <button
              type="button"
              className="panel-btn-ghost px-3 py-1.5 text-xs"
              onClick={() => setRotation((current) => (current + 90) % 360)}
            >
              <RotateCw className="h-3.5 w-3.5" />
              Rotate
            </button>
            <label className="panel-btn-ghost cursor-pointer px-3 py-1.5 text-xs">
              Replace
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => void pick(event.target.files?.[0])}
              />
            </label>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
    </Modal>
  );
}
