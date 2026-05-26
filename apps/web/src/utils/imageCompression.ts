/**
 * Read an image File into a (possibly downscaled, possibly re-encoded) data URL.
 *
 * Used wherever the app inlines a picture into a Holosphere-replicated field
 * (task pictures, canvas drops): images larger than `maxDimension` are resized
 * proportionally and re-encoded as JPEG. Pass `alwaysReencode: true` to force
 * JPEG re-encoding even for already-small images — useful for federation
 * payloads where the worst-case wire size matters more than preserving PNG
 * transparency.
 *
 * Returns `null` if the file can't be decoded as an image.
 */

export interface DownscaleResult {
  /** Data URL of the (possibly downscaled) image. */
  src: string;
  width: number;
  height: number;
}

export interface DownscaleOpts {
  /** Max width/height in pixels — images above this are downscaled. Default 1600. */
  maxDimension?: number;
  /** JPEG quality 0..1. Default 0.85. */
  quality?: number;
  /**
   * When true, re-encode even images that are already within `maxDimension`,
   * so the output is always a normalized JPEG. Default false (preserve the
   * original encoding when it already fits).
   */
  alwaysReencode?: boolean;
}

export async function fileToDownscaledDataURL(
  file: File,
  opts: DownscaleOpts = {},
): Promise<DownscaleResult | null> {
  const maxDimension = opts.maxDimension ?? 1600;
  const quality = opts.quality ?? 0.85;
  const alwaysReencode = opts.alwaysReencode ?? false;

  try {
    const initialSrc: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
    const img: HTMLImageElement = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = initialSrc;
    });

    let w = img.naturalWidth;
    let h = img.naturalHeight;
    const maxSide = Math.max(w, h);
    const needsResize = maxSide > maxDimension;

    if (!needsResize && !alwaysReencode) {
      return { src: initialSrc, width: w, height: h };
    }

    if (needsResize) {
      const scale = maxDimension / maxSide;
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const ctx = off.getContext("2d");
    if (!ctx)
      return {
        src: initialSrc,
        width: img.naturalWidth,
        height: img.naturalHeight,
      };
    ctx.drawImage(img, 0, 0, w, h);
    const encoded = off.toDataURL("image/jpeg", quality);
    return { src: encoded, width: w, height: h };
  } catch (err) {
    console.error("[imageCompression] failed to process image:", err);
    return null;
  }
}
