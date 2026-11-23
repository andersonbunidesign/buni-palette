// The gradient editor and generator: 2 to 5 stops, linear or radial, a perceptual blend,
// Space for new colours, and colours picked straight from the palettes in the sidebar.
import React, { useEffect, useRef, useState } from "react";
import type { Ctx } from "./App";
import { gradSig, gradientsOf, nextGradName, uid, type Gradient, type GradState } from "./store";
import {
  BLENDS, GEN_MODES, css, cssBlock, evenPos, fixSegment, generateGradient, issues, mix, sorted, type Blend, type GStop, type GradType,
} from "./gradient";
import { formatValue, normHex, readableInk } from "./color";
import { ColorPopover } from "./Generator";
import { IconArrowLeft, IconArtwork, IconCopy, IconLock, IconMinus, IconPipette, IconPlus, IconReset, IconShare, IconShuffle, IconUnlock, IconX, IconGradient } from "./icons";
import { copyText } from "./References";
import { api, errText } from "./api";
import { gradientImage } from "./share";

export function newGrad(): GradState {
  const g: GradState = { type: "linear", angle: 90, blend: "oklab", mode: "smooth", stops: evenPos(3).map((pos) => ({ hex: "#808080", pos })) };
  const out = generateGradient(g.stops, "smooth", []);
  return { ...g, ...out };
}

type Snap = Pick<GradState, "stops" | "type" | "angle" | "blend">;
const MAX = 5;

/** The editor's look as a saved gradient (without id, name and date). */
const body = (g: GradState) => ({ type: g.type, angle: g.angle, stops: sorted(g.stops), blend: g.blend, imageId: g.imageId, line: g.line });

export function GradientEditor({ ctx }: { ctx: Ctx }) {
  const { project } = ctx;
  const g = ctx.grad;
  const gRef = useRef(g);
  gRef.current = g;
  const editing = g.editing ? gradientsOf(project).find((x) => x.id === g.editing) : undefined;
  const [sel, setSel] = useState(0);
  const [picker, setPicker] = useState<{ i: number; left: number; top: number } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const dirty = !!g.baseline && gradSig(g) !== g.baseline;
  const back = g.from ?? "gradients";
  const stops = g.stops;
  const pool = Array.from(new Set([...project.refs.flatMap((r) => [...r.auto, ...r.picked].map((s) => s.hex)), ...project.palettes.flatMap((p) => p.colors.map((c) => c.hex))]));

  // Undo and redo. Quick runs of changes (dragging a stop or the angle) count as one step.
  const undo = useRef<Snap[]>([]);
  const redo = useRef<Snap[]>([]);
  const last = useRef({ key: "", t: 0 });
  const [, bump] = useState(0);
  const snap = (x: GradState): Snap => ({ stops: x.stops, type: x.type, angle: x.angle, blend: x.blend });
  const change = (patch: Partial<GradState>, key = "") => {
    const cur = gRef.current;
    const now = Date.now();
    if (!(key && key === last.current.key && now - last.current.t < 1200)) {
      undo.current.push(snap(cur));
      if (undo.current.length > 100) undo.current.shift();
    }
    last.current = { key, t: now };
    redo.current = [];
    const next = { ...cur, ...patch };
    gRef.current = next;
    ctx.setGrad(next);
    bump((n) => n + 1);
  };
  const step = (from: React.MutableRefObject<Snap[]>, to: React.MutableRefObject<Snap[]>) => {
    const s = from.current.pop();
    if (!s) return;
    to.current.push(snap(gRef.current));
    last.current = { key: "", t: 0 };
    const next = { ...gRef.current, ...s };
    gRef.current = next;
    ctx.setGrad(next);
    setSel((i) => Math.min(i, s.stops.length - 1));
    bump((n) => n + 1);
  };

  const regenerate = () => {
    const cur = gRef.current;
    if (cur.stops.every((s) => s.locked)) {
      ctx.toast("Every stop is locked. Unlock the ones you want to change.");
      return;
    }
    if (cur.mode === "refs" && pool.length < 2) ctx.toast("This project has no image or palette colours yet, so these come from Smooth.");
    setPicker(null);
    const out = generateGradient(cur.stops, cur.mode, pool);
    // A blend chosen by hand stays; a fresh generation suggests the one that fits.
    change({ stops: out.stops, blend: out.blend });
  };

  const setStops = (next: GStop[], key = "") => change({ stops: next }, key);
  const setStop = (i: number, patch: Partial<GStop>, key = "") => setStops(stops.map((s, j) => (j === i ? { ...s, ...patch } : s)), key);
  const setHex = (i: number, hex: string, key = "") => setStop(i, { hex, locked: true }, key);

  // Colours clicked in the sidebar palettes go into the selected stop.
  const selRef = useRef(sel);
  selRef.current = sel;
  useEffect(() => {
    ctx.stopPick.current = (hex: string) => {
      const i = Math.min(selRef.current, gRef.current.stops.length - 1);
      const s = gRef.current.stops;
      change({ stops: s.map((x, j) => (j === i ? { ...x, hex, locked: true } : x)) });
      ctx.toast(`Stop ${i + 1} is now ${hex}`);
    };
    return () => {
      ctx.stopPick.current = null;
    };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const addStop = () => {
    if (stops.length >= MAX) return;
    // In the widest gap, with the colour the blend already has there.
    const s = sorted(stops);
    let at = 0, gap = 0;
    for (let i = 0; i < s.length - 1; i++) if (s[i + 1].pos - s[i].pos > gap) [at, gap] = [i, s[i + 1].pos - s[i].pos];
    const pos = s[at].pos + gap / 2;
    const ns = [...s.slice(0, at + 1), { hex: mix(s[at].hex, s[at + 1].hex, 0.5, g.blend), pos }, ...s.slice(at + 1)];
    setStops(ns);
    setSel(at + 1);
  };
  const removeStop = (i: number) => {
    if (stops.length <= 2) return;
    setPicker(null);
    setStops(stops.filter((_, j) => j !== i));
    setSel((x) => Math.max(0, Math.min(x > i ? x - 1 : x, stops.length - 2)));
  };
  const setCount = (n: number) => {
    if (n > stops.length) addStop();
    else if (n < stops.length) {
      // Takes away an unlocked stop from the middle first.
      const mids = stops.map((s, i) => ({ s, i })).filter((x) => x.i > 0 && x.i < stops.length - 1);
      const pick = mids.find((x) => !x.s.locked) ?? mids[0] ?? { i: stops.length - 1 };
      removeStop(pick.i);
    }
  };
  const spread = () => setStops(sorted(stops).map((s, i, a) => ({ ...s, pos: i / (a.length - 1) })));
  const reverse = () => {
    setStops(sorted(stops).map((s) => ({ ...s, pos: 1 - s.pos })).sort((a, b) => a.pos - b.pos));
    setSel((i) => stops.length - 1 - i);
  };

  // Dragging a stop along the bar changes its position; the order follows.
  const railRef = useRef<HTMLDivElement>(null);
  const dragStop = (i: number, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setSel(i);
    const rail = railRef.current!.getBoundingClientRect();
    const start = e.clientX;
    let moved = false;
    let moving = gRef.current.stops[i];
    const realMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - start) < 3) return;
      moved = true;
      setPicker(null);
      const pos = Math.round(Math.min(1, Math.max(0, (ev.clientX - rail.left) / rail.width)) * 1000) / 1000;
      const cur = gRef.current.stops;
      const idx = cur.indexOf(moving);
      if (idx < 0) return;
      const updated = { ...cur[idx], pos };
      const next = cur.map((s, j) => (j === idx ? updated : s)).sort((a, b) => a.pos - b.pos);
      moving = updated;
      setSel(next.indexOf(updated));
      change({ stops: next }, "drag");
    };
    const up = () => {
      window.removeEventListener("pointermove", realMove);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", realMove);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const openPicker = (i: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setSel(i);
    setPicker(picker?.i === i ? null : { i, left: Math.max(8, Math.min(window.innerWidth - 330, r.left + r.width / 2 - 160)), top: r.bottom + 350 < window.innerHeight ? r.bottom + 8 : Math.max(8, r.top - 350) });
  };

  const exit = () => {
    setLeaving(false);
    ctx.setGrad({ ...gRef.current, editing: undefined, baseline: undefined, original: undefined, from: undefined, name: undefined, imageId: undefined, line: undefined });
    ctx.go(back === "gradients" ? "grads" : back);
  };
  const leave = () => (dirty ? setLeaving(true) : exit());
  const discard = () => {
    if (g.original) ctx.setGrad({ ...gRef.current, ...g.original });
    exit();
  };
  const revert = () => {
    if (!g.original) return;
    change({ type: g.original.type, angle: g.original.angle, stops: g.original.stops.map((s) => ({ ...s, locked: true })), blend: g.original.blend });
    ctx.toast("Back to the saved gradient. Ctrl+Z brings your changes back.");
  };

  const title = editing ? editing.name : g.name ?? nextGradName(project);
  const save = (asNew: boolean) => {
    const cur = gRef.current;
    const b = body(cur);
    if (editing && !asNew) {
      ctx.updateProject((p) => ({ ...p, gradients: gradientsOf(p).map((x) => (x.id === editing.id ? { ...x, ...b } : x)) }));
      ctx.setGrad({ ...cur, baseline: gradSig(cur), original: b });
      ctx.toast(`Saved "${editing.name}"`);
      return true;
    }
    const name = editing ? `${editing.name} copy` : cur.name ? nextGradName(project, cur.name) : nextGradName(project);
    const grad: Gradient = { id: uid(), name, created: Date.now(), ...b };
    ctx.updateProject((p) => {
      const list = gradientsOf(p);
      const i = editing ? list.findIndex((x) => x.id === editing.id) : -1;
      return { ...p, gradients: i >= 0 ? [...list.slice(0, i + 1), grad, ...list.slice(i + 1)] : [...list, grad] };
    });
    ctx.setGrad({ ...cur, editing: grad.id, name: undefined, baseline: gradSig(cur), original: b });
    ctx.toast(editing ? `Saved a copy: "${name}". The original is unchanged.` : `Saved "${name}" to Gradients`);
    return true;
  };
  const asGradient = (): Gradient => ({ id: editing?.id ?? "screen", name: title, created: Date.now(), ...body(gRef.current) });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = !!t && (t.tagName === "TEXTAREA" || t.tagName === "SELECT" || (t.tagName === "INPUT" && (t as HTMLInputElement).type !== "range"));
      if (document.querySelector(".overlay")) return;
      if (e.key === "Escape") {
        if (typing) return;
        e.preventDefault();
        if (picker) setPicker(null);
        else if (leaving) setLeaving(false);
        else leave();
        return;
      }
      if (typing) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "z") {
        e.preventDefault();
        if (e.shiftKey) step(redo, undo);
        else step(undo, redo);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === "y") {
        e.preventDefault();
        step(redo, undo);
        return;
      }
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === "Space") {
        e.preventDefault();
        regenerate();
      } else if (k === "l") setStop(sel, { locked: !stops[sel]?.locked });
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        setSel((i) => Math.max(0, Math.min(stops.length - 1, i + (e.key === "ArrowRight" ? 1 : -1))));
      } else if ((e.key === "Delete" || e.key === "Backspace") && stops.length > 2) removeStop(sel);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const found = issues(g);
  const sortedStops = stops; // kept sorted by position
  const preview = css(g);

  const actions = (
    <>
      {editing && (
        <>
          <button type="button" className="quiet" disabled={!dirty} title="Back to the saved gradient" onClick={revert}>
            <IconReset size={15} /> Original
          </button>
          <button type="button" className="quiet" onClick={discard} title="Leave without saving">
            Discard
          </button>
        </>
      )}
      <button type="button" className="btn" title="Copy the CSS for this gradient" onClick={(e) => copyText(cssBlock(g), e, ctx)}>
        <IconCopy /> CSS
      </button>
      <button
        type="button"
        className="btn"
        title="Copy the gradient as an image, with its stops"
        onClick={async () => {
          try {
            await api.copyPng(await gradientImage(asGradient()));
            ctx.toast(`Copied "${title}" as an image. Paste it anywhere.`);
          } catch (e) {
            ctx.toast(errText(e));
          }
        }}
      >
        <IconShare /> Image
      </button>
      <button type="button" className="btn" title="Export to an Illustrator file as a gradient swatch" onClick={() => ctx.exportItems([], [asGradient()])}>
        <IconArtwork /> Illustrator
      </button>
      {editing && (
        <button type="button" className="btn" onClick={() => save(true)}>
          Save copy
        </button>
      )}
      <button type="button" className="btn primary" onClick={() => save(false)}>
        <IconGradient /> {editing ? "Save" : "Save gradient"}
      </button>
    </>
  );

  const backLabel = back === "refs" ? "Image Sampling" : back === "explore" ? "Keywords" : "Gradients";
  const cur = stops[sel] ?? stops[0];

  return (
    <div className="gen gedit">
      <div className="titlebar">
        <div>
          <button type="button" className="back" onClick={leave}>
            <IconArrowLeft size={16} /> {backLabel}
            <span className="kbd">Esc</span>
          </button>
          <h1>{title}</h1>
        </div>
        <div className="tools">{actions}</div>
      </div>

      {leaving && (
        <div className="flash" role="alertdialog" aria-label="Unsaved changes">
          <span>You changed this gradient. Leave without saving?</span>
          <div className="tools">
            <button type="button" className="btn small" onClick={() => setLeaving(false)}>
              Keep editing
            </button>
            <button type="button" className="btn small danger" onClick={discard}>
              Discard
            </button>
            {editing && (
              <button type="button" className="btn small" onClick={() => save(true) && exit()}>
                Save copy
              </button>
            )}
            <button type="button" className="btn small primary" onClick={() => save(false) && exit()}>
              {editing ? "Save" : "Save gradient"}
            </button>
          </div>
        </div>
      )}

      <div className="gen-bar">
        <div className="bar-group">
          <div className="seg small" role="group" aria-label="Generator">
            {GEN_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={g.mode === m.id}
                title={m.id === "refs" && pool.length < 2 ? "Add images or palettes to this project first" : m.help}
                onClick={() => ctx.setGrad({ ...gRef.current, mode: m.id })}
              >
                {m.label}
              </button>
            ))}
          </div>
          <span className="label">Stops</span>
          <div className="counter">
            <button type="button" className="icon-btn" aria-label="One stop less" disabled={stops.length <= 2} onClick={() => setCount(stops.length - 1)}>
              <IconMinus size={16} />
            </button>
            <b className="num">{stops.length}</b>
            <button type="button" className="icon-btn" aria-label="One stop more" disabled={stops.length >= MAX} onClick={() => setCount(stops.length + 1)}>
              <IconPlus size={16} />
            </button>
          </div>
          <button type="button" className="round gen-go" aria-label="Generate" title="Generate (Space)" onClick={regenerate}>
            <IconShuffle />
          </button>
        </div>
        <div className="spacer" />
        <div className="bar-group">
          <div className="seg small" role="group" aria-label="Type">
            {(["linear", "radial"] as GradType[]).map((t) => (
              <button key={t} type="button" aria-pressed={g.type === t} onClick={() => change({ type: t })}>
                {t === "linear" ? "Linear" : "Radial"}
              </button>
            ))}
          </div>
          {g.type === "linear" && <AngleDial angle={g.angle} onChange={(a, key) => change({ angle: a }, key)} />}
          <div className="seg small" role="group" aria-label="Blend">
            {BLENDS.map((b) => (
              <button key={b.id} type="button" aria-pressed={g.blend === b.id} title={b.help} onClick={() => change({ blend: b.id as Blend })}>
                {b.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="gbody">
        <div className="gpreview" style={{ background: preview }} aria-label="Gradient preview" />
        <div className="grail-wrap">
          <div ref={railRef} className="grail" style={{ background: css({ ...g, type: "linear", angle: 90 }) }}>
            {sortedStops.map((s, i) => (
              <button
                key={i}
                type="button"
                className={`ghandle${i === sel ? " on" : ""}`}
                style={{ left: `${s.pos * 100}%`, background: s.hex }}
                aria-label={`Stop ${i + 1}, ${s.hex} at ${Math.round(s.pos * 100)}%`}
                title="Drag to move · click to select · double-click to change the colour"
                onPointerDown={(e) => dragStop(i, e)}
                onDoubleClick={(e) => openPicker(i, e.currentTarget)}
              >
                {s.locked && <IconLock size={10} />}
              </button>
            ))}
          </div>
          <div className="grail-tools">
            <button type="button" className="link" onClick={spread}>
              Space evenly
            </button>
            <button type="button" className="link" onClick={reverse}>
              Reverse
            </button>
          </div>
        </div>

        {found.length > 0 && (
          <div className="flash gissue" role="status">
            <span>
              {found.map((f) => `Stops ${f.seg + 1} and ${f.seg + 2}: ${f.text.charAt(0).toLowerCase()}${f.text.slice(1)}`).join(" ")}
            </span>
            <div className="tools">
              {found.some((f) => f.kind === "muddy") && g.blend !== "oklch" && (
                <button type="button" className="btn small" onClick={() => change({ blend: "oklch" })}>
                  Use the Vivid blend
                </button>
              )}
              {found.some((f) => f.kind !== "flat") && stops.length < MAX && (
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    const f = found.find((x) => x.kind !== "flat")!;
                    setStops(fixSegment(g, f.seg));
                    setSel(f.seg + 1);
                  }}
                >
                  Add a colourful middle stop
                </button>
              )}
            </div>
          </div>
        )}

        <div className="gstops">
          {sortedStops.map((s, i) => (
            <StopCard
              key={i}
              ctx={ctx}
              i={i}
              s={s}
              on={i === sel}
              canRemove={stops.length > 2}
              onSelect={() => setSel(i)}
              onOpen={(el) => openPicker(i, el)}
              onHex={(h) => setHex(i, h)}
              onPos={(p) => setStops(stops.map((x, j) => (j === i ? { ...x, pos: p } : x)).sort((a, b) => a.pos - b.pos))}
              onLock={() => setStop(i, { locked: !s.locked })}
              onRemove={() => removeStop(i)}
            />
          ))}
          {stops.length < MAX && (
            <button type="button" className="gstop add" onClick={addStop}>
              <IconPlus /> Add a stop
            </button>
          )}
        </div>
      </div>

      {picker && stops[picker.i] && (
        <ColorPopover
          ctx={ctx}
          hex={stops[picker.i].hex}
          left={picker.left}
          top={picker.top}
          keepOpen=".gstop, .ghandle"
          onSet={(h) => setHex(picker.i, h, `pick-${picker.i}`)}
          onClose={() => setPicker(null)}
        />
      )}

      <p className="note">
        <IconPipette size={14} /> Click a colour in any palette or gradient in the sidebar, from any project, to put it in the selected stop (now stop {sel + 1}
        {cur ? `, ${cur.hex}` : ""}). <span className="kbd">Space</span> new colours for the unlocked stops · <span className="kbd">L</span> lock ·{" "}
        <span className="kbd">←</span> <span className="kbd">→</span> select a stop · <span className="kbd">Ctrl</span>+<span className="kbd">Z</span> undo ·{" "}
        <span className="kbd">Esc</span> back. Perceptual blends keep the middle from going grey; CSS uses the same blend, and Illustrator gets extra stops so it
        looks the same.
      </p>
    </div>
  );
}

function StopCard(props: {
  ctx: Ctx;
  i: number;
  s: GStop;
  on: boolean;
  canRemove: boolean;
  onSelect: () => void;
  onOpen: (el: HTMLElement) => void;
  onHex: (h: string) => void;
  onPos: (p: number) => void;
  onLock: () => void;
  onRemove: () => void;
}) {
  const { s, ctx } = props;
  const [text, setText] = useState(s.hex);
  const [pos, setPos] = useState(String(Math.round(s.pos * 100)));
  useEffect(() => setText(s.hex), [s.hex]);
  useEffect(() => setPos(String(Math.round(s.pos * 100))), [s.pos]);
  const commit = () => {
    const h = normHex(text);
    if (h && h !== s.hex) props.onHex(h);
    else setText(s.hex);
  };
  const commitPos = () => {
    const n = Number(pos.replace("%", ""));
    if (Number.isFinite(n)) props.onPos(Math.min(100, Math.max(0, n)) / 100);
    else setPos(String(Math.round(s.pos * 100)));
  };
  return (
    <div className={`gstop${props.on ? " on" : ""}`} onClick={props.onSelect}>
      <button
        type="button"
        className="gstop-sw"
        style={{ background: s.hex, color: readableInk(s.hex) }}
        aria-label={`Change stop ${props.i + 1}`}
        title="Click to change the colour"
        onClick={(e) => {
          e.stopPropagation();
          props.onSelect();
          props.onOpen(e.currentTarget);
        }}
      >
        <span className="num">{props.i + 1}</span>
      </button>
      <div className="gstop-fields">
        <input
          id={`stop-hex-${props.i}`}
          className="field mono"
          aria-label={`Stop ${props.i + 1} colour`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        />
        <label className="gstop-pos">
          <input
            id={`stop-pos-${props.i}`}
            className="field mono"
            aria-label={`Stop ${props.i + 1} position`}
            value={pos}
            inputMode="numeric"
            onChange={(e) => setPos(e.target.value)}
            onBlur={commitPos}
            onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          />
          <span>%</span>
        </label>
        {ctx.mode !== "hex" && <span className="sw-label num">{formatValue(s.hex, ctx.mode)}</span>}
      </div>
      <div className="gstop-tools">
        <button
          type="button"
          className="icon-btn"
          aria-pressed={!!s.locked}
          aria-label={s.locked ? "Unlock stop" : "Lock stop"}
          title={s.locked ? "Unlock: Space can change it" : "Lock: Space keeps it"}
          onClick={(e) => {
            e.stopPropagation();
            props.onLock();
          }}
        >
          {s.locked ? <IconLock size={16} /> : <IconUnlock size={16} />}
        </button>
        {props.canRemove && (
          <button
            type="button"
            className="icon-btn"
            aria-label="Remove stop"
            title="Remove stop"
            onClick={(e) => {
              e.stopPropagation();
              props.onRemove();
            }}
          >
            <IconX size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

/** Angle of a linear gradient: drag around the dial (Shift for 1° steps) or type it. */
function AngleDial({ angle, onChange }: { angle: number; onChange: (a: number, key?: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(String(Math.round(angle)));
  useEffect(() => setText(String(Math.round(angle))), [angle]);
  const at = (e: { clientX: number; clientY: number; shiftKey: boolean }) => {
    const r = ref.current!.getBoundingClientRect();
    let a = (Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180) / Math.PI;
    if (a < 0) a += 360;
    a = e.shiftKey ? Math.round(a) : Math.round(a / 15) * 15;
    onChange(a % 360, "angle");
  };
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    at(e);
    const move = (ev: PointerEvent) => at(ev);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div className="angle">
      <div
        ref={ref}
        className="dial"
        role="slider"
        tabIndex={0}
        aria-label="Angle"
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={Math.round(angle)}
        title="Drag to turn (15° steps, Shift for 1°)"
        onPointerDown={down}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange((angle + (e.shiftKey ? 1 : 15)) % 360, "angle");
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange((angle + 360 - (e.shiftKey ? 1 : 15)) % 360, "angle");
        }}
      >
        <i style={{ transform: `rotate(${angle}deg)` }} />
      </div>
      <input
        id="grad-angle"
        className="field mono"
        aria-label="Angle in degrees"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = Number(text.replace("°", ""));
          if (Number.isFinite(n)) onChange(((Math.round(n) % 360) + 360) % 360);
          else setText(String(Math.round(angle)));
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      />
      <span className="sw-label">°</span>
    </div>
  );
}
