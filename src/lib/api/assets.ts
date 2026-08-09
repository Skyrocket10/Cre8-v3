'use client';

/**
 * Asset ingestion.
 *
 * Uploads are decoded, downscaled and re-encoded in the browser before they
 * enter the document. That keeps projects small enough to live in IndexedDB,
 * makes published output self-contained, and means the same pipeline can hand
 * the bytes to R2 instead of inlining them — the document only ever sees a URL.
 *
 * Doing it here rather than at the edge is not a compromise. A Worker has no
 * image codecs; the browser has fast ones already loaded, the file is already
 * in memory, and the person who chose the file is the one who waits. What it
 * costs is that everything below has to degrade rather than throw: a browser
 * that cannot encode WebP still has to be able to upload a photograph.
 */

import { createAsset } from '../document/factory';
import type { Asset, AssetType, AssetSource } from '../document/types';

/** Longest edge, in CSS pixels. Comfortably retina for a full-bleed hero. */
const MAX_DIMENSION = 2200;
const QUALITY = 0.82;

/**
 * The widths a responsive image is offered at.
 *
 * Four, not eight. Each one is a real object in R2, a row in the database and
 * a line in every `srcset` that references it, and the gap between adjacent
 * rungs is what decides how much a browser over-fetches — halving is close
 * enough that the waste is small and few enough that the cost stays honest.
 * A rung wider than the source is skipped rather than upscaled.
 */
const LADDER = [480, 960, 1440];

export const ACCEPTED_TYPES = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,video/mp4';

/**
 * Turn a processed asset's data URL back into bytes.
 *
 * Used only on the hosted path, to hand the already-downscaled image to R2
 * instead of leaving it inlined in the document.
 */
export async function assetBytes(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}

export interface IngestOptions {
  /**
   * Also encode the narrower rungs of the ladder.
   *
   * Hosted only. With no backend every variant would be another data URL in
   * the document, so a page of photographs would triple the size of something
   * that has to fit in IndexedDB — to buy a `srcset` whose entries all point
   * at the same origin the page is already inlining from.
   */
  variants?: boolean;
}

export async function ingestFile(file: File, options: IngestOptions = {}): Promise<Asset> {
  const type = classify(file);

  if (type === 'svg') {
    const text = await file.text();
    return createAsset({
      name: cleanName(file.name),
      type: 'svg',
      url: `data:image/svg+xml;utf8,${encodeURIComponent(text)}`,
      size: file.size,
      mimeType: file.type,
    });
  }

  if (type === 'video') {
    return createAsset({
      name: cleanName(file.name),
      type: 'video',
      url: await readAsDataUrl(file),
      size: file.size,
      mimeType: file.type,
    });
  }

  const processed = await downscaleImage(file);
  return createAsset({
    name: cleanName(file.name),
    type: 'image',
    url: processed.url,
    width: processed.width,
    height: processed.height,
    size: processed.size,
    mimeType: processed.mimeType,
    ...(options.variants && processed.image
      ? { sources: await ladderFor(processed.image, processed.width, processed.mimeType) }
      : {}),
  });
}

function classify(file: File): AssetType {
  if (file.type === 'image/svg+xml' || file.name.endsWith('.svg')) return 'svg';
  if (file.type.startsWith('video/')) return 'video';
  return 'image';
}

function cleanName(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 48) || 'Asset';
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

/* --------------------------------------------------------------------------
 * Encoding
 * ----------------------------------------------------------------------- */

let webpSupport: boolean | null = null;

/**
 * Whether this browser can actually encode WebP.
 *
 * `toDataURL` does not throw for a format it does not know — it silently
 * returns a PNG. Shipping that under a `.webp` name would produce a file the
 * server labels one thing and the bytes say is another, which mostly works
 * until something along the path believes the label.
 */
function canEncodeWebp(): boolean {
  if (webpSupport !== null) return webpSupport;
  const probe = document.createElement('canvas');
  probe.width = 1;
  probe.height = 1;
  webpSupport = probe.toDataURL('image/webp').startsWith('data:image/webp');
  return webpSupport;
}

/** The format everything becomes, and the extension that goes with it. */
export function outputFormat(): { mimeType: string; extension: string } {
  return canEncodeWebp()
    ? { mimeType: 'image/webp', extension: 'webp' }
    : { mimeType: 'image/jpeg', extension: 'jpg' };
}

function encode(image: CanvasImageSource, width: number, height: number): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL(outputFormat().mimeType, QUALITY);
}

/** Rough byte count of a base64 payload, without decoding it. */
const dataUrlBytes = (url: string) => Math.round((url.length * 3) / 4);

interface ProcessedImage {
  url: string;
  width: number;
  height: number;
  size: number;
  mimeType: string;
  /** Kept so the ladder can be encoded from the same decode. Absent for a passthrough. */
  image?: HTMLImageElement;
}

async function downscaleImage(file: File): Promise<ProcessedImage> {
  const dataUrl = await readAsDataUrl(file);
  const image = await loadImage(dataUrl);

  const scale = Math.min(1, MAX_DIMENSION / Math.max(image.width, image.height));

  // Two files come through untouched, for reasons that are not about size. A
  // GIF loses its animation on a canvas round-trip — the canvas holds one
  // frame — and a WebP that is already small enough would be re-encoded from
  // an image that has already been through a lossy codec once.
  const passthrough =
    scale === 1 && (file.type === 'image/gif' || file.type === 'image/webp');
  if (passthrough) {
    return {
      url: dataUrl,
      width: image.width,
      height: image.height,
      size: file.size,
      mimeType: file.type,
      ...(file.type === 'image/webp' ? { image } : {}),
    };
  }

  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);
  const url = encode(image, width, height);
  if (!url) {
    return { url: dataUrl, width: image.width, height: image.height, size: file.size, mimeType: file.type };
  }

  return { url, width, height, size: dataUrlBytes(url), mimeType: outputFormat().mimeType, image };
}

/**
 * The narrower copies, widest first.
 *
 * Only rungs below the source: a browser asked to choose between a 960px file
 * and a 960px file upscaled to 1440 will sometimes take the larger one, and it
 * would be paying for pixels that were invented.
 */
async function ladderFor(
  image: HTMLImageElement,
  fullWidth: number,
  _mimeType: string
): Promise<AssetSource[]> {
  const out: AssetSource[] = [];
  const ratio = image.naturalHeight / image.naturalWidth || 1;
  for (const width of LADDER) {
    if (width >= fullWidth) continue;
    const url = encode(image, width, Math.round(width * ratio));
    if (url) out.push({ width, url });
  }
  return out;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode image'));
    image.src = src;
  });
}
