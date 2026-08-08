'use client';

/**
 * Asset ingestion.
 *
 * Uploads are downscaled and re-encoded in the browser before they enter the
 * document. That keeps projects small enough to live in IndexedDB, makes
 * published output self-contained, and means the same pipeline can later hand
 * the bytes to R2 instead of inlining them — the document only ever sees a URL.
 */

import { createAsset } from '../document/factory';
import type { Asset, AssetType } from '../document/types';

/** Longest edge, in CSS pixels. Comfortably retina for a full-bleed hero. */
const MAX_DIMENSION = 2200;
const JPEG_QUALITY = 0.86;

export const ACCEPTED_TYPES = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,video/mp4';

export async function ingestFile(file: File): Promise<Asset> {
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

interface ProcessedImage {
  url: string;
  width: number;
  height: number;
  size: number;
  mimeType: string;
}

async function downscaleImage(file: File): Promise<ProcessedImage> {
  const dataUrl = await readAsDataUrl(file);
  const image = await loadImage(dataUrl);

  const scale = Math.min(1, MAX_DIMENSION / Math.max(image.width, image.height));
  // Animated GIFs would lose their animation on a canvas round-trip.
  if (scale === 1 && (file.type === 'image/webp' || file.type === 'image/gif')) {
    return {
      url: dataUrl,
      width: image.width,
      height: image.height,
      size: file.size,
      mimeType: file.type,
    };
  }

  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    return { url: dataUrl, width: image.width, height: image.height, size: file.size, mimeType: file.type };
  }
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);

  // Preserve transparency where the source had it.
  const hasAlpha = file.type === 'image/png' || file.type === 'image/webp';
  const mimeType = hasAlpha ? 'image/webp' : 'image/jpeg';
  const url = canvas.toDataURL(mimeType, JPEG_QUALITY);

  return { url, width, height, size: Math.round((url.length * 3) / 4), mimeType };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode image'));
    image.src = src;
  });
}
