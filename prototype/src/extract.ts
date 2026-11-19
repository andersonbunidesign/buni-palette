// Reading reference images and pulling colours out of them (k-means in Lab, no AI).
import { hexToRgb, Lab, rgbToHex, rgbToLab, seeded, deltaE2000 } from "./color";

export interface Swatch { hex: string; x: number; y: number; share?: number }

const MAX_SIDE = 1400;

/** Reads an image file or blob, scales it down for storage and returns a JPEG data URL. */
export async function loadImage(blob: Blob): Promise<{ url: string; w: number; h: number }> {
  const src = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fail(new Error("This file isn't an image the browser can open."));
      i.src = src;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);
    // Images with see-through parts keep them (WebP with alpha); the rest are stored as JPEG.
    const data = ctx.getImageData(0, 0, w, h).data;
    let alpha = false;
    for (let i = 3; i < data.length; i += 16) if (data[i] < 250) { alpha = true; break; }
    if (alpha) return { url: c.toDataURL("image/webp", 0.9), w, h };
    return { url: c.toDataURL("image/jpeg", 0.88), w, h };
  } finally {
    URL.revokeObjectURL(src);
  }
}

const pixelCache = new Map<string, { data: Uint8ClampedArray; w: number; h: number }>();

async function pixels(url: string, side = 160) {
  const key = url.length + ":" + url.slice(-64) + ":" + side;
  const hit = pixelCache.get(key);
  if (hit) return hit;
  const img = await new Promise<HTMLImageElement>((ok, fail) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = fail;
    i.src = url;
  });
  const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const out = { data: ctx.getImageData(0, 0, w, h).data, w, h };
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

/**
 * The `count` main colours of an image, largest area first. Each colour keeps the
 * position of a pixel that matches it, so the app can show where it came from.
 */
export async function extract(url: string, count: number): Promise<Swatch[]> {
  const { data, w, h } = await pixels(url);
  const pts: { lab: Lab; x: number; y: number }[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] < 128) continue;
      pts.push({ lab: rgbToLab([data[i], data[i + 1], data[i + 2]]), x: (x + 0.5) / w, y: (y + 0.5) / h });
    }
  if (!pts.length) return [];
  const k = Math.min(count, pts.length);
  const rand = seeded(pts.length * 7919 + k);
  const d2 = (a: Lab, b: Lab) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

  // k-means++ seeding: spread the starting centres so small accent colours get a chance.
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
  for (let iter = 0; iter < 14; iter++) {
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
    centres.forEach((c, i) => {
      const s = sums[i];
      if (s[3]) centres[i] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    });
  }

  // Each centre becomes the real pixel closest to it, so the colour exists in the image.
  const result: Swatch[] = centres.map((c, ci) => {
    let best = -1, bd = Infinity, n = 0;
    for (let i = 0; i < pts.length; i++) {
      if (assign[i] !== ci) continue;
      n++;
      const d = d2(pts[i].lab, c);
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return null as unknown as Swatch;
    const p = pts[best];
    const i = (Math.min(h - 1, Math.floor(p.y * h)) * w + Math.min(w - 1, Math.floor(p.x * w))) * 4;
    return { hex: rgbToHex([data[i], data[i + 1], data[i + 2]]), x: p.x, y: p.y, share: n / pts.length };
  }).filter(Boolean);

  // Drop near-duplicates, then largest first.
  const unique: Swatch[] = [];
  for (const s of result.sort((a, b) => (b.share ?? 0) - (a.share ?? 0))) {
    const lab = rgbToLab(hexToRgb(s.hex)!);
    if (!unique.some((u) => deltaE2000(lab, rgbToLab(hexToRgb(u.hex)!)) < 2.5)) unique.push(s);
  }
  return unique;
}
