// Draws a palette as a 1200 px wide PNG: name, colours, and under each one hex, RGB and Pantone.
import type { Gradient, Palette } from "./store";
import { paint, sorted } from "./gradient";
import { paletteTag } from "./store";
import { formatValue } from "./color";

const UI = '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif';
const MONO = 'ui-monospace, "Cascadia Mono", Consolas, monospace';

function fit(ctx: CanvasRenderingContext2D, text: string, max: number, weight: string, size: number, family: string) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (s > 9 && ctx.measureText(text).width > max) {
    s -= 0.5;
    ctx.font = `${weight} ${s}px ${family}`;
  }
}

export async function paletteImage(p: Palette): Promise<Blob> {
  const W = 1200, pad = 48, stripH = 340, gap = 0;
  const hasPms = p.colors.some((c) => c.pantone || c.label);
  const labelH = hasPms ? 96 : 72;
  const H = pad + 44 + 24 + stripH + 16 + labelH + 30 + pad - 16;
  const scale = 2;
  const c = document.createElement("canvas");
  c.width = W * scale;
  c.height = H * scale;
  const ctx = c.getContext("2d")!;
  ctx.scale(scale, scale);
  // Transparent background, so the image sits on whatever it's pasted into.

  // Title and Pantone tag
  ctx.fillStyle = "#343434";
  ctx.textBaseline = "alphabetic";
  fit(ctx, p.name, W - pad * 2 - 260, "600", 30, UI);
  ctx.fillText(p.name, pad, pad + 30);
  if (p.colors.some((c) => c.pantone)) {
    const tag = paletteTag(p);
    const tx = pad + ctx.measureText(p.name).width + 16;
    ctx.font = `700 13px ${UI}`;
    const tw = ctx.measureText(tag).width + 20;
    ctx.fillStyle = "#343434";
    roundRect(ctx, tx, pad + 9, tw, 26, 13);
    ctx.fill();
    ctx.fillStyle = "#FFBF00";
    ctx.fillText(tag, tx + 10, pad + 27);
  }

  // Colours, touching each other
  const top = pad + 44 + 24;
  const n = p.colors.length;
  const colW = (W - pad * 2 - gap * (n - 1)) / n;
  ctx.save();
  roundRect(ctx, pad, top, W - pad * 2, stripH, 14);
  ctx.clip();
  p.colors.forEach((col, i) => {
    ctx.fillStyle = col.hex;
    ctx.fillRect(pad + i * (colW + gap) - 0.5, top, colW + 1, stripH);
  });
  ctx.restore();

  // Values under each colour
  const ly = top + stripH + 16;
  p.colors.forEach((col, i) => {
    const x = pad + i * (colW + gap) + 2;
    const max = colW - 10;
    let y = ly + 18;
    if (col.pantone || col.label) {
      ctx.fillStyle = "#343434";
      const name = col.pantone ? col.pantone.replace(/^PANTONE /, "") : col.label!;
      fit(ctx, name, max, "700", 16, UI);
      ctx.fillText(name, x, y);
      y += 24;
    }
    ctx.fillStyle = "#343434";
    fit(ctx, col.hex, max, "700", 16, MONO);
    ctx.fillText(col.hex, x, y);
    y += 22;
    ctx.fillStyle = "#5E5B57";
    const rgb = "RGB " + formatValue(col.hex, "rgb");
    fit(ctx, rgb, max, "400", 14, MONO);
    ctx.fillText(rgb, x, y);
  });

  ctx.fillStyle = "#A39E97";
  ctx.font = `500 12px ${UI}`;
  ctx.textAlign = "right";
  ctx.fillText("Buni Palette", W - pad, H - pad + 16);

  return await new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("Couldn't draw the image."))), "image/png"));
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}


/** Draws a gradient as a 1200 px wide PNG: name, the gradient, and each stop with its value and position. */
export async function gradientImage(g: Gradient): Promise<Blob> {
  const W = 1200, pad = 48, boxH = 340, labelH = 64;
  const H = pad + 44 + 24 + boxH + 16 + labelH + pad;
  const scale = 2;
  const c = document.createElement("canvas");
  c.width = W * scale;
  c.height = H * scale;
  const ctx = c.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#343434";
  fit(ctx, g.name, W - pad * 2, "600", 30, UI);
  ctx.fillText(g.name, pad, pad + 30);
  const top = pad + 44 + 24;
  ctx.save();
  roundRect(ctx, pad, top, W - pad * 2, boxH, 14);
  ctx.clip();
  // Drawn at full resolution, so the perceptual blend is exact.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  paint(ctx, g, pad * scale, top * scale, (W - pad * 2) * scale, boxH * scale);
  ctx.restore();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const stops = sorted(g.stops);
  const ly = top + boxH + 16;
  const inner = W - pad * 2;
  stops.forEach((s, i) => {
    // Values sit under the stop, kept inside the image at the ends.
    const x = Math.min(pad + inner - 150, Math.max(pad, pad + s.pos * inner - (i === 0 ? 0 : i === stops.length - 1 ? 150 : 60)));
    ctx.fillStyle = s.hex;
    roundRect(ctx, x, ly + 4, 14, 14, 3);
    ctx.fill();
    ctx.fillStyle = "#343434";
    ctx.font = `700 16px ${MONO}`;
    ctx.fillText(s.hex, x + 22, ly + 17);
    ctx.fillStyle = "#5E5B57";
    ctx.font = `400 14px ${MONO}`;
    ctx.fillText(`${Math.round(s.pos * 100)}%`, x + 22, ly + 39);
  });
  ctx.fillStyle = "#A39E97";
  ctx.font = `500 12px ${UI}`;
  ctx.textAlign = "right";
  const what = g.type === "radial" ? "Radial" : `Linear ${Math.round(g.angle)}°`;
  ctx.fillText(`${what} · ${g.blend === "oklab" ? "perceptual blend" : g.blend === "oklch" ? "vivid blend" : "RGB blend"} · Buni Palette`, W - pad, H - pad + 16);
  return await new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error("Couldn't draw the image."))), "image/png"));
}
