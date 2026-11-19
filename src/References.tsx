import React, { useRef, useState } from "react";
import type { Ctx } from "./App";
import type { RefImage, Palette } from "./store";
import { nextName, refUrl, uid } from "./store";
import { api } from "./api";
import { extract, sampleAt, type Swatch } from "./extract";
import { formatValue, readableInk } from "./color";
import { IconPaste, IconTrash, IconUpload, IconX, IconSwatches, IconShuffle } from "./icons";

export function copyText(text: string, e: { clientX: number; clientY: number }, ctx: Ctx) {
  api.copyText(text).then(
    () => ctx.note(`Copied ${text}`, e),
    () => ctx.note(text, e),
  );
}

export function References({ ctx }: { ctx: Ctx }) {
  const { project } = ctx;
  const fileRef = useRef<HTMLInputElement>(null);

  const pasteButton = () => ctx.pasteClipboard(true);

  const traySet = new Set(ctx.tray);
  const toggleTray = (hex: string) => ctx.setTray(traySet.has(hex) ? ctx.tray.filter((h) => h !== hex) : [...ctx.tray, hex]);

  const savePalette = (colors: Swatch[], imageId?: string) => {
    const pal: Palette = {
      id: uid(),
      name: nextName(project),
      kind: "rgb",
      created: Date.now(),
      imageId,
      colors: colors.map((c) => ({ hex: c.hex, x: c.x, y: c.y })),
    };
    ctx.updateProject((p) => ({ ...p, palettes: [...p.palettes, pal] }));
    ctx.toast(`Saved "${pal.name}" to Palettes`);
  };

  const toGenerator = (hexes: string[]) => {
    const colors = hexes.slice(0, 10);
    while (colors.length < 2) colors.push("#BFBFBF");
    ctx.setGen({ ...ctx.gen, colors, locked: colors.map(() => true), editing: undefined, baseline: colors, from: "refs" });
    ctx.go("gen");
  };

  return (
    <>
      <div className="titlebar">
        <div>
          <p className="kicker">Project references</p>
          <h1>{project.name}</h1>
        </div>
        <div className="tools">
          <input
            ref={fileRef}
            id="add-images"
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              ctx.addImages(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            <IconUpload /> Add images
          </button>
          <button type="button" className="btn primary" onClick={pasteButton}>
            <IconPaste /> Paste screenshot
          </button>
        </div>
      </div>

      {project.refs.length === 0 ? (
        <div className="empty">
          <b>Collect references for this project</b>
          <span>
            Drop images here, use Add images, or take a screenshot and press <span className="kbd">Ctrl</span> +{" "}
            <span className="kbd">V</span>. Palettes saved from Explore bring their photo here too.
            <br />
            The app pulls the main colours from each image. Click anywhere on an image to pick a colour yourself.
          </span>
        </div>
      ) : (
        <div className="refs">
          {project.refs.map((r) => (
            <RefCard
              key={r.id}
                ctx={ctx}
              r={r}
              traySet={traySet}
              onTray={toggleTray}
              onSave={() => savePalette([...r.auto, ...r.picked], r.id)}
              onGen={() => toGenerator([...r.auto, ...r.picked].map((s) => s.hex))}
            />
          ))}
        </div>
      )}

      {project.refs.length > 0 && (
        <div className="tray">
          <span className="label">Picked colours</span>
          <div className="chips-sw">
            {ctx.tray.length === 0 ? (
              <span className="sw-label">Click colours on any image to collect them here, then save them as one palette.</span>
            ) : (
              ctx.tray.map((h) => (
                <button
                  key={h}
                  type="button"
                  className="sw"
                  style={{ background: h }}
                  title={`${h}: click to remove`}
                  onClick={() => toggleTray(h)}
                />
              ))
            )}
          </div>
          <button type="button" className="btn small" disabled={!ctx.tray.length} onClick={() => ctx.setTray([])}>
            Clear
          </button>
          <button type="button" className="btn small" disabled={ctx.tray.length < 1} onClick={() => toGenerator(ctx.tray)}>
            <IconShuffle size={16} /> Open in generator
          </button>
          <button
            type="button"
            className="btn small primary"
            disabled={ctx.tray.length < 1}
            onClick={() => {
              savePalette(ctx.tray.map((hex) => ({ hex, x: -1, y: -1 })));
              ctx.setTray([]);
            }}
          >
            <IconSwatches size={16} /> Save as palette
          </button>
        </div>
      )}
    </>
  );
}

function RefCard(props: {
  ctx: Ctx;
  r: RefImage;
  traySet: Set<string>;
  onTray: (hex: string) => void;
  onSave: () => void;
  onGen: () => void;
}) {
  const { ctx, r, traySet, onTray } = props;
  const [hover, setHover] = useState<Swatch | null>(null);
  const [loupe, setLoupe] = useState<{ x: number; y: number; hex: string } | null>(null);
  const [count, setCount] = useState(r.count);
  const busy = useRef(0);
  const imgRef = useRef<HTMLDivElement>(null);

  const update = (fn: (x: RefImage) => RefImage) =>
    ctx.updateProject((p) => ({ ...p, refs: p.refs.map((x) => (x.id === r.id ? fn(x) : x)) }));

  const reExtract = async (n: number) => {
    setCount(n);
    const ticket = ++busy.current;
    const auto = await extract(refUrl(r), n);
    if (ticket === busy.current) update((x) => ({ ...x, count: n, auto }));
  };

  const pos = (e: React.MouseEvent) => {
    const b = imgRef.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)) };
  };

  const pct = ((count - 1) / (16 - 1)) * 100;
  // One list: the extracted colours first, then the ones picked by hand. Any can be removed;
  // removing an extracted one lowers the colour count by one.
  const remove = (s: Swatch, auto: boolean) => {
    setHover(null);
    if (auto) {
      const n = Math.max(1, count - 1);
      setCount(n);
      busy.current++;
      update((x) => ({ ...x, count: n, auto: x.auto.filter((a) => a !== s) }));
    } else update((x) => ({ ...x, picked: x.picked.filter((p) => p !== s) }));
  };
  const sw = (s: Swatch, auto: boolean) => (
    <button
      key={s.hex + s.x}
      type="button"
      className={`sw${traySet.has(s.hex) ? " in-tray" : ""}`}
      style={{ background: s.hex, color: readableInk(s.hex) }}
      title={`${formatValue(s.hex, ctx.mode)}: click to collect`}
      onMouseEnter={() => setHover(s)}
      onMouseLeave={() => setHover(null)}
      onFocus={() => setHover(s)}
      onBlur={() => setHover(null)}
      onClick={() => onTray(s.hex)}
    >
      <span
        className="x"
        role="button"
        aria-label="Remove colour"
        title="Remove"
        onClick={(e) => {
          e.stopPropagation();
          remove(s, auto);
        }}
      >
        <IconX size={12} />
      </span>
    </button>
  );

  return (
    <article className="ref">
      <div
        ref={imgRef}
        className="ref-img"
        onMouseMove={async (e) => {
          const p = pos(e);
          const hex = await sampleAt(refUrl(r), p.x, p.y);
          setLoupe(hex ? { ...p, hex } : null);
        }}
        onMouseLeave={() => setLoupe(null)}
        onClick={async (e) => {
          const p = pos(e);
          const hex = await sampleAt(refUrl(r), p.x, p.y);
          if (!hex) return;
          update((x) => ({ ...x, picked: [...x.picked, { hex, ...p }] }));
          ctx.note(`Picked ${hex}`, e);
        }}
        title="Click to pick a colour"
      >
        <img src={refUrl(r)} alt={r.name} draggable={false} />
        {hover && hover.x >= 0 && (
          <span className="marker" style={{ left: `${hover.x * 100}%`, top: `${hover.y * 100}%`, background: hover.hex }} />
        )}
        {loupe && !hover && (
          <span className="loupe" style={{ left: `${loupe.x * 100}%`, top: `${loupe.y * 100}%`, background: loupe.hex }} />
        )}
      </div>
      <div className="ref-body">
        <div className="ref-row">
          <span className="ref-name" title={r.name}>
            {r.name}
            {r.source && (
              <span className="credit-line">
                Photo by{" "}
                <a href={`${r.source.authorUrl}?utm_source=buni_palette&utm_medium=referral`} target="_blank" rel="noreferrer">
                  {r.source.author}
                </a>{" "}
                on{" "}
                <a href="https://unsplash.com/?utm_source=buni_palette&utm_medium=referral" target="_blank" rel="noreferrer">
                  Unsplash
                </a>
              </span>
            )}
          </span>
          <button
            type="button"
            className="icon-btn"
            aria-label="Remove image"
            title="Remove image"
            onClick={() => ctx.removeRef(r.id)}
          >
            <IconTrash size={16} />
          </button>
        </div>
        <div className="ref-row">
          <label className="label num" htmlFor={`count-${r.id}`} style={{ minWidth: 72 }}>
            {count} colours
          </label>
          <input
            id={`count-${r.id}`}
            type="range"
            className="slider"
            min={1}
            max={16}
            value={count}
            style={{ "--fill": `${pct}%` } as React.CSSProperties}
            onChange={(e) => reExtract(Number(e.target.value))}
          />
        </div>
        <div className="chips-sw">
          {r.auto.map((s) => sw(s, true))}
          {r.picked.map((s) => sw(s, false))}
        </div>
        <div className="ref-actions">
          <button type="button" className="btn small" onClick={props.onGen}>
            <IconShuffle size={16} /> Open in generator
          </button>
          <button type="button" className="btn small" onClick={props.onSave}>
            <IconSwatches size={16} /> Save as palette
          </button>
        </div>
      </div>
    </article>
  );
}
