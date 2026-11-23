import React, { useEffect, useRef, useState } from "react";
import type { Ctx } from "./App";
import type { RefImage, Palette } from "./store";
import { nextGradName, nextName, refColors, refUrl, swatchKey, uid, type Gradient } from "./store";
import { autoLine, css, lineAngle, stopsAlong, tidyLine, type GStop, type Line } from "./gradient";
import { api } from "./api";
import { extract, sampleAt, type Swatch } from "./extract";
import { formatValue, readableInk } from "./color";
import { IconPaste, IconTrash, IconUpload, IconX, IconSwatches, IconShuffle, IconReset, IconGradient, IconLine, IconMinus, IconPlus } from "./icons";

export type SampleMode = "palette" | "gradient";
/** Palette (the default) or Gradient, remembered per screen. */
export function useSampleMode(key: string): [SampleMode, (m: SampleMode) => void] {
  const [mode, setMode] = useState<SampleMode>(() => {
    try {
      return localStorage.getItem(key) === "gradient" ? "gradient" : "palette";
    } catch {
      return "palette";
    }
  });
  return [
    mode,
    (m) => {
      setMode(m);
      try {
        localStorage.setItem(key, m);
      } catch {
        /* remembered for this visit only */
      }
    },
  ];
}

export function ModeSwitch({ mode, onChange }: { mode: SampleMode; onChange: (m: SampleMode) => void }) {
  return (
    <div className="seg small" role="group" aria-label="Make">
      <button type="button" aria-pressed={mode === "palette"} onClick={() => onChange("palette")}>
        <IconSwatches size={15} /> Palette
      </button>
      <button type="button" aria-pressed={mode === "gradient"} onClick={() => onChange("gradient")}>
        <IconGradient size={15} /> Gradient
      </button>
    </div>
  );
}

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
  const [mode, setMode] = useSampleMode("bp.sampleMode");

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
          <p className="kicker">Image Sampling</p>
          <h1>{project.name}</h1>
        </div>
        <div className="tools">
          <ModeSwitch mode={mode} onChange={setMode} />
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
            <span className="kbd">V</span>. Palettes saved from Keywords bring their photo here too.
            <br />
            The app pulls the main colours from each image. Click anywhere on an image to pick a colour yourself: those get a small
            triangle in the corner and stay when you Resample or move the slider.
          </span>
        </div>
      ) : (
        <div className="refs">
          {project.refs.map((r) =>
            mode === "gradient" ? (
              <GradRefCard key={r.id} ctx={ctx} r={r} />
            ) : (
            <RefCard
              key={r.id}
                ctx={ctx}
              r={r}
              traySet={traySet}
              onTray={toggleTray}
              onSave={() => savePalette(refColors(r).map((c) => c.s), r.id)}
              onGen={() => toGenerator(refColors(r).map((c) => c.s.hex))}
              onPantone={() =>
                ctx.convertColors(
                  refColors(r).map(({ s }) => ({ hex: s.hex, x: s.x, y: s.y })),
                  nextName(project),
                  r.id,
                )
              }
            />
            ),
          )}
        </div>
      )}

      {project.refs.length > 0 && mode === "palette" && (
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
  onPantone: () => void;
}) {
  const { ctx, r, traySet, onTray } = props;
  const [hover, setHover] = useState<Swatch | null>(null);
  const [loupe, setLoupe] = useState<{ x: number; y: number; hex: string } | null>(null);
  const [count, setCount] = useState(r.count);
  const busy = useRef(0);
  const imgRef = useRef<HTMLDivElement>(null);

  const update = (fn: (x: RefImage) => RefImage) =>
    ctx.updateProject((p) => ({ ...p, refs: p.refs.map((x) => (x.id === r.id ? fn(x) : x)) }));

  // `count` is the number of automatic colours; the slider shows the total with the hand-picked ones,
  // and moving it recalculates only the automatic ones.
  // New automatic colours go back to the standard order (automatic first, then picked).
  const reExtract = async (n: number, seed = r.seed ?? 0, previous: string[] = []) => {
    setCount(n);
    const ticket = ++busy.current;
    const auto = await extract(refUrl(r), n, seed, previous);
    if (ticket === busy.current) update((x) => ({ ...x, count: n, auto, seed, order: undefined }));
  };
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ key: string; after: boolean } | null>(null);
  const moveSwatch = (from: string, to: string, after: boolean) => {
    if (from === to) return;
    const keys = refColors(r).map((c) => swatchKey(c.s)).filter((k) => k !== from);
    const at = keys.indexOf(to) + (after ? 1 : 0);
    keys.splice(at, 0, from);
    update((x) => ({ ...x, order: keys }));
  };
  const total = count + r.picked.length;
  const maxTotal = Math.max(16, r.picked.length + 1);
  const [showDots, setShowDots] = useState(false);

  const pos = (e: React.MouseEvent) => {
    const b = imgRef.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)) };
  };

  const pct = ((total - 1) / (maxTotal - 1)) * 100;
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
  const sw = (s: Swatch, auto: boolean) => {
    const key = swatchKey(s);
    return (
    <button
      key={key}
      type="button"
      draggable
      onDragStart={(e) => {
        setHover(null);
        setDragKey(key);
        e.dataTransfer.setData("application/x-bp-swatch", key);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => {
        setDragKey(null);
        setDropAt(null);
      }}
      onDragOver={(e) => {
        if (!dragKey || dragKey === key) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const b = e.currentTarget.getBoundingClientRect();
        const after = e.clientX > b.left + b.width / 2;
        if (dropAt?.key !== key || dropAt.after !== after) setDropAt({ key, after });
      }}
      onDrop={(e) => {
        e.preventDefault();
        const b = e.currentTarget.getBoundingClientRect();
        if (dragKey) moveSwatch(dragKey, key, e.clientX > b.left + b.width / 2);
        setDragKey(null);
        setDropAt(null);
      }}
      className={`sw${traySet.has(s.hex) ? " in-tray" : ""}${auto ? "" : " picked"}${dragKey === key ? " dragging" : ""}${
        dropAt?.key === key ? (dropAt.after ? " drop-after" : " drop-before") : ""
      }`}
      style={{ background: s.hex, color: readableInk(s.hex) }}
      title={`${formatValue(s.hex, ctx.mode)}${auto ? "" : " (picked by hand)"}: click to collect, drag to reorder`}
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
  };

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
        onMouseEnter={() => setShowDots(true)}
        onMouseLeave={() => {
          setLoupe(null);
          setShowDots(false);
        }}
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
        {/* Where every colour came from shows only while the mouse is on the image. */}
        {showDots &&
          refColors(r)
            .map((c) => c.s)
            .filter((s) => s.x >= 0 && s !== hover)
            .map((s, i) => <span key={i} className="marker small" style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, background: s.hex }} />)}
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
            {total} colours
          </label>
          <input
            id={`count-${r.id}`}
            type="range"
            className="slider"
            min={Math.max(1, r.picked.length)}
            max={maxTotal}
            value={total}
            style={{ "--fill": `${pct}%` } as React.CSSProperties}
            onChange={(e) => reExtract(Math.max(0, Number(e.target.value) - r.picked.length))}
          />
        </div>
        <div className="chips-sw">{refColors(r).map((c) => sw(c.s, c.auto))}</div>
        <div className="ref-actions">
          <button
            type="button"
            className="btn small"
            title="Find a different set of automatic colours (hand-picked ones stay)"
            disabled={count < 1}
            onClick={() => reExtract(count, ((r.seed ?? 0) + 1 + Math.floor(Math.random() * 1000)) % 100000, r.auto.map((s) => s.hex))}
          >
            <IconReset size={16} /> Resample
          </button>
          <button type="button" className="btn small" onClick={props.onGen}>
            <IconShuffle size={16} /> Open in generator
          </button>
          <button type="button" className="btn small" onClick={props.onSave}>
            <IconSwatches size={16} /> Save as palette
          </button>
          <button type="button" className="btn small" title="Match these colours to Pantone and save them as a Pantone palette" onClick={props.onPantone}>
            To Pantone
          </button>
        </div>
      </div>
    </article>
  );
}

/** Shows where the line runs on the image and the stops along it. */
export function LineOverlay({ line, stops, onHandle }: { line: Line; stops: GStop[]; onHandle?: (end: 0 | 1, e: React.PointerEvent) => void }) {
  const [x1, y1, x2, y2] = line;
  const at = (t: number) => ({ left: `${(x1 + (x2 - x1) * t) * 100}%`, top: `${(y1 + (y2 - y1) * t) * 100}%` });
  return (
    <>
      <svg className="gline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <line x1={x1 * 100} y1={y1 * 100} x2={x2 * 100} y2={y2 * 100} className="gline-shadow" />
        <line x1={x1 * 100} y1={y1 * 100} x2={x2 * 100} y2={y2 * 100} />
      </svg>
      {stops.map((s, i) => (
        <span key={i} className="gdot" style={{ ...at(s.pos), background: s.hex }} aria-hidden="true" />
      ))}
      {onHandle &&
        ([0, 1] as const).map((end) => (
          <span
            key={`h${end}`}
            className="gend"
            style={{ ...at(end), background: stops.length ? (end ? stops[stops.length - 1].hex : stops[0].hex) : undefined }}
            title="Drag to move this end"
            onPointerDown={(e) => onHandle(end, e)}
          />
        ))}
    </>
  );
}

/**
 * Image Sampling in Gradient mode: the app draws a line across the image where the colour changes
 * smoothly and reads the stops along it. Drag an end to move it, or drag across the image to draw your own.
 */
function GradRefCard({ ctx, r }: { ctx: Ctx; r: RefImage }) {
  const { project } = ctx;
  const n = r.gstops ?? 3;
  const [stops, setStops] = useState<GStop[]>([]);
  const [draft, setDraft] = useState<Line | null>(null);
  const imgRef = useRef<HTMLDivElement>(null);
  const ticket = useRef(0);
  const update = (fn: (x: RefImage) => RefImage) => ctx.updateProject((p) => ({ ...p, refs: p.refs.map((x) => (x.id === r.id ? fn(x) : x)) }));

  const auto = async (count: number, seed: number) => {
    const t = ++ticket.current;
    const out = await autoLine(refUrl(r), count, seed);
    if (t !== ticket.current) return;
    setStops(out.stops);
    update((x) => ({ ...x, gline: out.line, gstops: count, gseed: seed }));
  };
  const read = async (line: Line, count: number) => {
    const t = ++ticket.current;
    const out = await stopsAlong(refUrl(r), line, count);
    if (t === ticket.current) setStops(out);
  };
  useEffect(() => {
    if (r.gline) read(r.gline, n);
    else auto(n, r.gseed ?? 0);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const line = draft ?? r.gline;
  const shown = draft ? [] : stops;
  const pos = (e: { clientX: number; clientY: number }) => {
    const b = imgRef.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), Math.min(1, Math.max(0, (e.clientY - b.top) / b.height))] as const;
  };
  // Drag one end, or drag anywhere else to draw a new line.
  const drag = (e: React.PointerEvent, end: 0 | 1 | null) => {
    if (e.button !== 0 || !r.gline) return;
    e.preventDefault();
    e.stopPropagation();
    const start = pos(e);
    let cur: Line = end === null ? [start[0], start[1], start[0], start[1]] : r.gline;
    const move = (ev: PointerEvent) => {
      const p = pos(ev);
      cur = end === 0 ? [p[0], p[1], cur[2], cur[3]] : end === 1 ? [cur[0], cur[1], p[0], p[1]] : [start[0], start[1], p[0], p[1]];
      setDraft(cur);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDraft(null);
      const b = imgRef.current?.getBoundingClientRect();
      const long = b ? Math.hypot((cur[2] - cur[0]) * b.width, (cur[3] - cur[1]) * b.height) : 0;
      if (long < 12) return;
      cur = tidyLine(cur);
      update((x) => ({ ...x, gline: cur }));
      read(cur, n);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const setCount = (c: number) => {
    update((x) => ({ ...x, gstops: c }));
    if (r.gline) read(r.gline, c);
  };
  // The gradient runs the way the line does on the image.
  const angle = r.gline ? lineAngle(r.gline, r.w, r.h) : 90;
  const grad = { type: "linear" as const, angle, blend: "oklab" as const, stops };
  const save = () => {
    if (!r.gline || stops.length < 2) return;
    const g: Gradient = { id: uid(), name: nextGradName(project), created: Date.now(), ...grad, stops: stops.map(({ hex, pos }) => ({ hex, pos })), imageId: r.id, line: r.gline };
    ctx.updateProject((p) => ({ ...p, gradients: [...(p.gradients ?? []), g] }));
    ctx.toast(`Saved "${g.name}" to Gradients`);
  };

  return (
    <article className="ref gref">
      <div ref={imgRef} className="ref-img drawing" onPointerDown={(e) => drag(e, null)} title="Drag across the image to draw your own line">
        <img src={refUrl(r)} alt={r.name} draggable={false} />
        {line && <LineOverlay line={line} stops={shown} onHandle={(end, e) => drag(e, end)} />}
      </div>
      <div className="ref-body">
        <div className="ref-row">
          <span className="ref-name" title={r.name}>
            {r.name}
          </span>
          <button type="button" className="icon-btn" aria-label="Remove image" title="Remove image" onClick={() => ctx.removeRef(r.id)}>
            <IconTrash size={16} />
          </button>
        </div>
        <div className="gref-prev" style={{ background: stops.length >= 2 ? css({ ...grad, angle: 90 }) : undefined }} aria-label="Gradient read from the line" />
        <div className="ref-row">
          <span className="label">Stops</span>
          <div className="counter">
            <button type="button" className="icon-btn" aria-label="One stop less" disabled={n <= 2} onClick={() => setCount(n - 1)}>
              <IconMinus size={16} />
            </button>
            <b className="num">{n}</b>
            <button type="button" className="icon-btn" aria-label="One stop more" disabled={n >= 5} onClick={() => setCount(n + 1)}>
              <IconPlus size={16} />
            </button>
          </div>
          <span className="gref-hexes">
            {stops.map((s, i) => (
              <span key={i} className="num" onClick={(e) => copyText(formatValue(s.hex, ctx.mode), e, ctx)} title="Click to copy">
                {formatValue(s.hex, ctx.mode)}
              </span>
            ))}
          </span>
        </div>
        <div className="ref-actions">
          <button type="button" className="btn small" title="Let the app find another line across the image" onClick={() => auto(n, ((r.gseed ?? 0) + 1) % 6)}>
            <IconLine size={16} /> Another line
          </button>
          <button
            type="button"
            className="btn small"
            disabled={stops.length < 2}
            onClick={() => ctx.newGradient({ stops: stops.map((s) => ({ ...s, locked: true })), blend: "oklab", type: "linear", angle, imageId: r.id, line: r.gline, from: "refs" })}
          >
            <IconShuffle size={16} /> Open in Gradients
          </button>
          <button type="button" className="btn small" disabled={stops.length < 2} onClick={save}>
            <IconGradient size={16} /> Save as gradient
          </button>
        </div>
      </div>
    </article>
  );
}
