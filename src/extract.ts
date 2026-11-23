// Reading reference images and pulling colours out of them (k-means in Lab, no AI).
import { hexToRgb, Lab, rgbToHex, rgbToLab, seeded, deltaE2000 } from "./color";

export interface Swatch { hex: string; x: number; y: number; share?: number }

const MAX_SIDE = 2000;
const THUMB_SIDE = 480;

export interface LoadedImage { full: Blob; thumb: Blob; ext: "jpg" | "webp"; w: number; h: number }

function decode(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => ok(i);
    i.onerror = () => fail(new Error("This file isn't an image the app can open."));
    i.src = src;
  });
}

function toBlob(c: HTMLCanvasElement, type: string, q: number): Promise<Blob> {
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("Couldn't store the image."))), type, q));
}

function draw(img: HTMLImageElement, side: number) {
  const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  return { c, ctx, w, h };
}

/** Reads an image file or blob, scales it down for storage and makes a small thumbnail. */
export async function loadImage(blob: Blob): Promise<LoadedImage> {
  const src = URL.createObjectURL(blob);
  try {
    const img = await decode(src);
    const big = draw(img, MAX_SIDE);
    // Images with see-through parts keep them (WebP with alpha); the rest are stored as JPEG.
    const data = big.ctx.getImageData(0, 0, big.w, big.h).data;
    let alpha = false;
    for (let i = 3; i < data.length; i += 16) if (data[i] < 250) { alpha = true; break; }
    const type = alpha ? "image/webp" : "image/jpeg";
    const small = draw(img, THUMB_SIDE);
    return { full: await toBlob(big.c, type, 0.9), thumb: await toBlob(small.c, type, 0.85), ext: alpha ? "webp" : "jpg", w: big.w, h: big.h };
  } finally {
    URL.revokeObjectURL(src);
  }
}

const pixelCache = new Map<string, { data: Uint8ClampedArray; w: number; h: number }>();

export async function pixels(url: string, side = 160) {
  const key = url + ":" + side;
  const hit = pixelCache.get(key);
  if (hit) return hit;
  const { ctx, w, h } = draw(await decode(url), side);
  const out = { data: ctx.getImageData(0, 0, w, h).data, w, h };
  if (pixelCache.size > 200) pixelCache.clear();
  pixelCache.set(key, out);
  return out;
}

/** The colour under a point (0–1 coordinates), averaged over a small area; null where the image is see-through. */
export async function sampleAt(url: string, x: number, y: number): Promise<string | null> {
  const { data, w, h } = await pixels(url, 600);
  const cx = Math.round(x * (w - 1)), cy = Math.round(y * (h - 1));
  let r = 0, g = 0, b = 0, n = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const px = Math.min(w - 1, Math.max(0, cx + dx)), py = Math.min(h - 1, Math.max(0, cy + dy));
      const i = (py * w + px) * 4;
      if (data[i + 3] < 128) continue;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
  return n ? rgbToHex([r / n, g / n, b / n]) : null;
}

export interface Block { lab: Lab; hex: string; x: number; y: number; share: number }

const BLOCKS = 32;
const blockCache = new Map<string, Block[]>();

/**
 * Every distinct colour area of an image, small ones included: about 30 groups found by k-means in Lab,
 * near-duplicates merged. Each keeps the real pixel closest to its centre, so the colour exists in the image
 * and the app can show where it came from. Worked out once per image.
 */
export async function colorBlocks(url: string): Promise<Block[]> {
  const hit = blockCache.get(url);
  if (hit) return hit;
  const { data, w, h } = await pixels(url, 200);
  const pts: { lab: Lab; x: number; y: number; i: number }[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] < 128) continue;
      pts.push({ lab: rgbToLab([data[i], data[i + 1], data[i + 2]]), x: (x + 0.5) / w, y: (y + 0.5) / h, i });
    }
  if (!pts.length) return [];
  const k = Math.min(BLOCKS, pts.length);
  const rand = seeded(pts.length * 7919 + k);
  const d2 = (a: Lab, b: Lab) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

  // k-means++ seeding spreads the starting centres, so small accent colours get their own group.
  const centres: Lab[] = [pts[Math.floor(rand() * pts.length)].lab];
  const dist = new Float64Array(pts.length).fill(Infinity);
  while (centres.length < k) {
    let sum = 0;
    const last = centres[centres.length - 1];
    for (let i = 0; i < pts.length; i++) {
      dist[i] = Math.min(dist[i], d2(pts[i].lab, last));
      sum += dist[i];
    }
    if (sum === 0) break;
    let r = rand() * sum;
    let pick = 0;
    for (; pick < pts.length - 1; pick++) {
      r -= dist[pick];
      if (r <= 0) break;
    }
    centres.push(pts[pick].lab);
  }
  const assign = new Int32Array(pts.length);
  for (let iter = 0; iter < 12; iter++) {
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pts.length; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < centres.length; c++) {
        const d = d2(pts[i].lab, centres[c]);
        if (d < bd) { bd = d; best = c; }
      }
      assign[i] = best;
      const s = sums[best];
      s[0] += pts[i].lab[0]; s[1] += pts[i].lab[1]; s[2] += pts[i].lab[2]; s[3]++;
    }
    centres.forEach((_c, i) => {
      const s = sums[i];
      if (s[3]) centres[i] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    });
  }
  const raw: Block[] = [];
  centres.forEach((c, ci) => {
    let best = -1, bd = Infinity, n = 0;
    for (let i = 0; i < pts.length; i++) {
      if (assign[i] !== ci) continue;
      n++;
      const d = d2(pts[i].lab, c);
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return;
    const p = pts[best];
    const rgb: [number, number, number] = [data[p.i], data[p.i + 1], data[p.i + 2]];
    raw.push({ lab: rgbToLab(rgb), hex: rgbToHex(rgb), x: p.x, y: p.y, share: n / pts.length });
  });
  // Merge groups that look the same (the bigger one absorbs the smaller), and drop specks.
  raw.sort((a, b) => b.share - a.share);
  const blocks: Block[] = [];
  for (const b of raw) {
    const twin = blocks.find((u) => deltaE2000(u.lab, b.lab) < 3);
    if (twin) twin.share += b.share;
    else if (b.share >= 0.0015) blocks.push({ ...b });
  }
  if (blockCache.size > 100) blockCache.clear();
  blockCache.set(url, blocks);
  return blocks;
}

/**
 * The main colours of an image. The first time (seed 0) it takes the biggest areas, each one clearly
 * different from the others. Resample (seed > 0) draws a different set from all the image's colour blocks,
 * small ones included, still clearly different from each other, and avoids the colours shown before.
 */
export async function extract(url: string, count: number, seed = 0, previous: string[] = []): Promise<Swatch[]> {
  if (count < 1) return [];
  const blocks = await colorBlocks(url);
  if (!blocks.length) return [];
  const n = Math.min(count, blocks.length);
  const prev = previous.map((h) => rgbToLab(hexToRgb(h) ?? [0, 0, 0]));
  const wasShown = (b: Block) => prev.some((p) => deltaE2000(p, b.lab) < 6);
  const rand = seeded(seed * 104729 + 17);
  const chosen: Block[] = [];
  const minDist = (b: Block) => (chosen.length ? Math.min(...chosen.map((c) => deltaE2000(c.lab, b.lab))) : 100);

  // Ask for colours at least `gap` apart; loosen the gap only when the image runs out of different ones.
  for (let gap = 14; chosen.length < n && gap >= 0; gap -= 3) {
    while (chosen.length < n) {
      const options = blocks.filter((b) => !chosen.includes(b) && minDist(b) >= gap);
      if (!options.length) break;
      let pick: Block;
      if (seed === 0) {
        // Biggest area first, then the area that adds the most difference.
        pick = options.reduce((a, b) => (Math.pow(b.share, 0.5) * (minDist(b) + 10) > Math.pow(a.share, 0.5) * (minDist(a) + 10) ? b : a));
      } else {
        // Small areas get a real chance; colours from the last set are much less likely.
        const weights = options.map((b) => Math.pow(b.share, 0.3) * (wasShown(b) ? 0.15 : 1) * (1 + Math.min(minDist(b), 40) / 20));
        let r = rand() * weights.reduce((a, b) => a + b, 0);
        let i = 0;
        for (; i < options.length - 1; i++) {
          r -= weights[i];
          if (r <= 0) break;
        }
        pick = options[i];
      }
      chosen.push(pick);
    }
  }
  return chosen
    .sort((a, b) => b.share - a.share)
    .map((b) => ({ hex: b.hex, x: b.x, y: b.y, share: b.share }));
}
