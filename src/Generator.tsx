import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Ctx } from "./App";
import type { GenState, Palette } from "./store";
import { nextName, uid } from "./store";
import {
  NO_ADJUST, RULES, adjustHex, cmykToRgb, formatValue, generate, hexToRgb, hsbToRgb, normHex, parseValue, readableInk, rgbToCmyk, rgbToHex, rgbToHsb, shades,
  confusedPairs, simulate, VISIONS, type Adjust, type RGB, type Rule, type Vision,
} from "./color";
import {
  IconArrowLeft, IconCopy, IconText, IconWheel, IconEye, IconFocus, IconGray, IconLock, IconMinus, IconPlus, IconReset, IconShuffle, IconSliders, IconSwatches, IconUnlock, IconX, IconArtwork,
} from "./icons";
import { copyText } from "./References";
import { useWindowFullscreen } from "./platform";

export function newGen(): GenState {
  const colors = generate([null, null, null, null, null], "analogous", []);
  return { colors, locked: colors.map(() => false), rule: "analogous", fromRefs: false };
}

const same = (a?: string[], b?: string[]) => !!a && !!b && a.join() === b.join();
type Snap = { colors: string[]; locked: boolean[] };

export function Generator({ ctx }: { ctx: Ctx }) {
  const { gen, project, genFull: full, setGenFull: setFull } = ctx;
  const pool = Array.from(new Set(project.refs.flatMap((r) => [...r.auto, ...r.picked].map((s) => s.hex))));
  const genRef = useRef(gen);
  genRef.current = gen;
  const editing = gen.editing ? project.palettes.find((p) => p.id === gen.editing) : undefined;
  const [gray, setGray] = useState(false);
  const [vision, setVision] = useState<Vision>("normal");
  const [wheel, setWheel] = useState(() => {
    try {
      return localStorage.getItem("bp.wheel") === "1";
    } catch {
      return false;
    }
  });
  const setWheelSaved = (v: boolean) => {
    setWheel(v);
    try {
      localStorage.setItem("bp.wheel", v ? "1" : "0");
    } catch {
      /* remembered for this visit only */
    }
  };
  const [leaving, setLeaving] = useState(false);
  const [exportAsk, setExportAsk] = useState(false);
  const [picker, setPicker] = useState<{ i: number; left: number; top: number } | null>(null);
  const [adjust, setAdjust] = useState<{ base: string[]; a: Adjust } | null>(null);
  const dirty = !!gen.baseline && !same(gen.colors, gen.baseline);
  const back = gen.from ?? "palettes";

  // Undo and redo (Ctrl+Z, Ctrl+Y). Quick runs of changes, like dragging a slider, count as one step.
  const undo = useRef<Snap[]>([]);
  const redo = useRef<Snap[]>([]);
  const lastPush = useRef<{ key: string; t: number }>({ key: "", t: 0 });
  const [, bump] = useState(0);
  const change = (next: GenState, key = "") => {
    const now = Date.now();
    const cur = genRef.current;
    if (!(key && key === lastPush.current.key && now - lastPush.current.t < 1200)) {
      undo.current.push({ colors: cur.colors, locked: cur.locked });
      if (undo.current.length > 100) undo.current.shift();
    }
    lastPush.current = { key, t: now };
    redo.current = [];
    genRef.current = next;
    ctx.setGen(next);
    bump((n) => n + 1);
  };
  const step = (from: React.MutableRefObject<Snap[]>, to: React.MutableRefObject<Snap[]>) => {
    const snap = from.current.pop();
    if (!snap) return;
    const cur = genRef.current;
    to.current.push({ colors: cur.colors, locked: cur.locked });
    lastPush.current = { key: "", t: 0 };
    setAdjust(null);
    ctx.setGen({ ...cur, ...snap });
    bump((n) => n + 1);
  };

  const regenerate = () => {
    const g = genRef.current;
    if (g.locked.every(Boolean)) {
      ctx.toast("Every colour is locked. Unlock the ones you want to change.");
      return;
    }
    setAdjust(null);
    setPicker(null);
    change({ ...g, colors: generate(g.colors.map((c, i) => (g.locked[i] ? c : null)), g.rule, g.fromRefs ? pool : []) });
  };

  const exit = () => {
    setLeaving(false);
    setFull(false);
    ctx.setGen({ ...genRef.current, editing: undefined, baseline: undefined, from: undefined });
    ctx.go(back);
  };
  const leave = () => (dirty ? setLeaving(true) : exit());
  const discard = () => {
    // Put the palette back the way it was, so the next visit starts clean.
    if (gen.baseline) ctx.setGen({ ...genRef.current, colors: gen.baseline, locked: gen.baseline.map(() => true) });
    exit();
  };
  const revert = () => {
    if (!gen.baseline) return;
    change({ ...genRef.current, colors: gen.baseline, locked: gen.baseline.map(() => true) });
    ctx.toast("Back to the saved colours. Ctrl+Z brings your changes back.");
  };

  // Full screen uses the whole screen (the desktop window goes full screen too).
  useWindowFullscreen(!!full);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = !!t && (t.tagName === "TEXTAREA" || t.tagName === "SELECT" || (t.tagName === "INPUT" && (t as HTMLInputElement).type !== "range"));
      if (document.querySelector(".compare")) return;
      if (e.key === "Escape") {
        if (typing) return;
        e.preventDefault();
        if (picker) setPicker(null);
        else if (adjust) setAdjust(null);
        else if (leaving) setLeaving(false);
        else if (full === "window") setFull(false);
        else if (full === "grid") {
          setFull(false);
          leave();
        } else leave();
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
      } else if (k === "g") setGray((g) => !g);
      else if (k === "w") setWheelSaved(!wheel);
      else if (k === "f") setFull(full ? false : "window");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const setCount = (n: number) => {
    const g = genRef.current;
    if (n < g.colors.length) {
      const colors = g.colors.slice();
      const locked = g.locked.slice();
      while (colors.length > n) {
        let i = locked.lastIndexOf(false);
        if (i < 0) i = colors.length - 1;
        colors.splice(i, 1);
        locked.splice(i, 1);
      }
      change({ ...g, colors, locked });
    } else {
      const slots: (string | null)[] = [...g.colors, ...Array(n - g.colors.length).fill(null)];
      change({ ...g, colors: generate(slots, g.rule, g.fromRefs ? pool : []), locked: [...g.locked, ...Array(n - g.colors.length).fill(false)] });
    }
  };

  const save = (asNew: boolean) => {
    if (editing && !asNew && editing.kind === "rgb") {
      ctx.updateProject((p) => ({
        ...p,
        palettes: p.palettes.map((x) =>
          x.id === editing.id ? { ...x, colors: gen.colors.map((hex, i) => (x.colors[i]?.hex === hex ? x.colors[i] : x.colors.find((c) => c.hex === hex) ?? { hex })) } : x,
        ),
      }));
      ctx.setGen({ ...gen, baseline: gen.colors });
      ctx.toast(`Saved "${editing.name}"`);
      return true;
    }
    const name = editing ? `${editing.name} copy` : nextName(project);
    const pal: Palette = { id: uid(), name, kind: "rgb", created: Date.now(), colors: gen.colors.map((hex) => ({ hex })) };
    ctx.updateProject((p) => {
      const i = editing ? p.palettes.findIndex((x) => x.id === editing.id) : -1;
      return { ...p, palettes: i >= 0 ? [...p.palettes.slice(0, i + 1), pal, ...p.palettes.slice(i + 1)] : [...p.palettes, pal] };
    });
    if (editing) {
      // The copy is saved; the original stays as it was and you keep working on the copy.
      ctx.setGen({ ...gen, editing: pal.id, baseline: gen.colors });
      ctx.toast(`Saved a copy: "${name}". The original is unchanged.`);
    } else {
      ctx.setGen({ ...gen, editing: pal.id, baseline: gen.colors });
      ctx.toast(`Saved "${name}" to Palettes`);
    }
    return true;
  };

  const setColor = (i: number, hex: string, key = "") => {
    const g = genRef.current;
    change({ ...g, colors: g.colors.map((c, j) => (j === i ? hex : c)), locked: g.locked.map((l, j) => (j === i ? true : l)) }, key);
  };

  const openAdjust = () => {
    setPicker(null);
    setAdjust(adjust ? null : { base: gen.colors.slice(), a: NO_ADJUST });
  };
  const applyAdjust = (a: Adjust) => {
    if (!adjust) return;
    setAdjust({ ...adjust, a });
    change({ ...genRef.current, colors: adjust.base.map((h) => adjustHex(h, a)) }, "adjust");
  };

  // Drag a colour sideways to move it (up and down when the colours are stacked on a narrow window).
  const colsRef = useRef<HTMLDivElement>(null);
  const [colDrag, setColDrag] = useState<{ from: number; to: number } | null>(null);
  const justDragged = useRef(false);
  const startColDrag = (i: number, e: React.PointerEvent) => {
    const t = e.target as HTMLElement;
    if (e.button !== 0 || t.closest("button, input")) return;
    const el = colsRef.current;
    if (!el) return;
    // Stops the browser selecting the colour values while dragging.
    e.preventDefault();
    const vertical = getComputedStyle(el).flexDirection.startsWith("column");
    const centres = Array.from(el.children).map((c) => {
      const r = c.getBoundingClientRect();
      return vertical ? r.top + r.height / 2 : r.left + r.width / 2;
    });
    const start = vertical ? e.clientY : e.clientX;
    let active = false;
    let to = i;
    const move = (ev: PointerEvent) => {
      const p = vertical ? ev.clientY : ev.clientX;
      if (!active && Math.abs(p - start) < 6) return;
      if (!active) {
        active = true;
        window.getSelection()?.removeAllRanges();
        setPicker(null);
        setAdjust(null);
      }
      to = centres.filter((c, j) => j !== i && c < p).length;
      setColDrag({ from: i, to });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setColDrag(null);
      if (!active) return;
      justDragged.current = true;
      window.setTimeout(() => (justDragged.current = false), 0);
      if (to === i) return;
      const g = genRef.current;
      const reorder = <T,>(a: T[]) => {
        const b = a.slice();
        const [x] = b.splice(i, 1);
        b.splice(to, 0, x);
        return b;
      };
      change({ ...g, colors: reorder(g.colors), locked: reorder(g.locked) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  // While dragging, the columns show in their new order.
  const colOrder = gen.colors.map((_, i) => i);
  if (colDrag) {
    const [x] = colOrder.splice(colDrag.from, 1);
    colOrder.splice(colDrag.to, 0, x);
  }

  const isPantone = editing?.kind === "pantone";
  // In a Pantone palette, a colour that hasn't changed keeps its Pantone name (or White / Black).
  const pantoneOf = (hex: string, i: number) => {
    const c = isPantone ? (editing!.colors[i]?.hex === hex ? editing!.colors[i] : editing!.colors.find((x) => x.hex === hex)) : undefined;
    return c ? c.pantone ?? c.label : undefined;
  };
  const saveLabel = editing ? (isPantone ? "Save as RGB palette" : "Save") : "Save palette";

  // Export to Illustrator what's on screen. Unchanged colours of a Pantone palette keep their names.
  const exportNow = (keepNames: boolean) => {
    setExportAsk(false);
    const colors = gen.colors.map((hex, i) => {
      const c = keepNames && isPantone ? (editing!.colors[i]?.hex === hex ? editing!.colors[i] : editing!.colors.find((x) => x.hex === hex)) : undefined;
      return c ? { ...c } : { hex };
    });
    const kind = colors.some((c) => "pantone" in c && c.pantone) ? "pantone" : "rgb";
    ctx.exportPalettes([{ id: editing?.id ?? "screen", name: title, kind, created: Date.now(), colors }]);
  };
  const exportClick = () => (dirty || !editing ? setExportAsk(true) : exportNow(true));

  const title = editing ? editing.name : project.name;
  const similar = confusedPairs(gen.colors, vision);

  // Right: save and leave. Original and Discard are quieter so they don't compete with Save.
  const actions = (
    <>
      {editing && (
        <>
          <button type="button" className="quiet" disabled={!dirty} title="Back to the saved colours" onClick={revert}>
            <IconReset size={15} /> Original
          </button>
          <button type="button" className="quiet" onClick={discard} title="Leave without saving">
            Discard
          </button>
        </>
      )}
      <button type="button" className="btn" title="Convert the colours on screen to Pantone" onClick={() => ctx.convertColors(gen.colors, title)}>
        To Pantone
      </button>
      <button type="button" className="btn" title="Export the colours on screen to an Illustrator file" onClick={exportClick}>
        <IconArtwork /> Illustrator
      </button>
      {editing && !isPantone && (
        <button type="button" className="btn" onClick={() => save(true)}>
          Save copy
        </button>
      )}
      <button type="button" className="btn primary" onClick={() => save(false)}>
        <IconSwatches /> {saveLabel}
      </button>
    </>
  );

  return (
    <div className={`gen${full ? " full" : ""}`}>
      {!full && (
        <div className="titlebar">
          <div>
            <button type="button" className="back" onClick={() => leave()}>
              <IconArrowLeft size={16} /> {back === "refs" ? "Image Sampling" : back === "explore" ? "Keywords" : "Color Palettes"}
              <span className="kbd">Esc</span>
            </button>
            <h1>{title}</h1>
          </div>
          <div className="tools">{actions}</div>
        </div>
      )}

      {leaving && (
        <div className="flash" role="alertdialog" aria-label="Unsaved changes">
          <span>You changed this palette. Leave without saving?</span>
          <div className="tools">
            <button type="button" className="btn small" onClick={() => setLeaving(false)}>
              Keep editing
            </button>
            <button type="button" className="btn small danger" onClick={discard}>
              Discard
            </button>
            {editing && !isPantone && (
              <button type="button" className="btn small" onClick={() => save(true) && exit()}>
                Save copy
              </button>
            )}
            <button type="button" className="btn small primary" onClick={() => save(false) && exit()}>
              {saveLabel}
            </button>
          </div>
        </div>
      )}

      {exportAsk && (
        <div className="flash" role="alertdialog" aria-label="Save before exporting">
          <span>{editing ? "You changed this palette. Save it before exporting?" : "This palette isn't saved yet. Save it before exporting?"}</span>
          <div className="tools">
            <button type="button" className="btn small" onClick={() => setExportAsk(false)}>
              Cancel
            </button>
            <button type="button" className="btn small" onClick={() => exportNow(true)}>
              Export without saving
            </button>
            {editing && !isPantone && (
              <button type="button" className="btn small" onClick={() => save(true) && exportNow(false)}>
                Save copy
              </button>
            )}
            <button type="button" className="btn small primary" onClick={() => save(false) && exportNow(!isPantone)}>
              {saveLabel}
            </button>
          </div>
        </div>
      )}

      <div className="gen-bar">
        {full && <b className="gen-title">{title}</b>}
        {/* Left: what makes colours */}
        <div className="bar-group">
          <button type="button" className="round" aria-pressed={wheel} aria-label="Colour wheel" title="Colour wheel: advanced view (W)" onClick={() => setWheelSaved(!wheel)}>
            <IconWheel />
          </button>
          <HarmonyPicker rule={gen.rule} onChange={(r) => ctx.setGen({ ...gen, rule: r })} />
          <div className="seg small" role="group" aria-label="Colours come from">
            <button type="button" aria-pressed={!gen.fromRefs} onClick={() => ctx.setGen({ ...gen, fromRefs: false })}>
              Any colour
            </button>
            <button
              type="button"
              aria-pressed={gen.fromRefs}
              disabled={!pool.length}
              title={pool.length ? `${pool.length} colours from all the images in this project's Image Sampling` : "Add images to this project's Image Sampling first"}
              onClick={() => ctx.setGen({ ...gen, fromRefs: true })}
            >
              Image Sampling All
            </button>
          </div>
          <div className="counter">
            <button type="button" className="icon-btn" aria-label="One colour less" disabled={gen.colors.length <= 2} onClick={() => setCount(gen.colors.length - 1)}>
              <IconMinus size={16} />
            </button>
            <b className="num">{gen.colors.length}</b>
            <button type="button" className="icon-btn" aria-label="One colour more" disabled={gen.colors.length >= 10} onClick={() => setCount(gen.colors.length + 1)}>
              <IconPlus size={16} />
            </button>
          </div>
          <div className="adjust-wrap">
            <button type="button" className="btn" aria-expanded={!!adjust} onClick={openAdjust}>
              <IconSliders /> Adjust
            </button>
            {adjust && <AdjustPanel a={adjust.a} onChange={applyAdjust} onReset={() => applyAdjust(NO_ADJUST)} onClose={() => setAdjust(null)} />}
          </div>
          <button type="button" className="round gen-go" aria-label="Generate" title="Generate (Space)" onClick={regenerate}>
            <IconShuffle />
          </button>
        </div>
        <div className="spacer" />
        {/* Middle: ways of looking at the palette */}
        <div className="bar-group">
          <button type="button" className="round" aria-label="Text on colour" title="Text on colour" onClick={() => ctx.openTextTest(gen.colors.map((hex, i) => ({ hex, pantone: pantoneOf(hex, i) })), title)}>
            <IconText />
          </button>
          <button type="button" className="round" aria-pressed={gray} aria-label="Greyscale" title="Greyscale (G)" onClick={() => setGray(!gray)}>
            <IconGray />
          </button>
          <VisionPicker vision={vision} onChange={setVision} />
          <button
            type="button"
            className="round"
            aria-pressed={!!full}
            aria-label={full ? "Leave full screen" : "Full screen"}
            title={full ? "Leave full screen (Esc)" : "Full screen (F)"}
            onClick={() => (full === "grid" ? (setFull(false), leave()) : setFull(full ? false : "window"))}
          >
            <IconFocus />
          </button>
        </div>
        {/* Right (full screen only; in the window these sit by the title) */}
        {full && <div className="full-actions">{actions}</div>}
      </div>

      {similar.length > 0 && (
        <div className="flash vision-warn" role="status">
          <span>
            With {VISIONS.find((v) => v.id === vision)?.label.toLowerCase()},{" "}
            {similar.map(([a, b]) => `colours ${a + 1} and ${b + 1}`).join(", ")} look alike.
          </span>
        </div>
      )}

      <div className={`gen-body${wheel ? " with-wheel" : ""}`}>
        {wheel && (
          <WheelPanel
            colors={gen.colors}
            locked={gen.locked}
            rule={gen.rule}
            vision={vision}
            onChange={(colors) => change({ ...genRef.current, colors }, "wheel")}
            onLock={(i) => change({ ...genRef.current, locked: genRef.current.locked.map((l, j) => (j === i ? !l : l)) })}
            onLockAll={(on) => change({ ...genRef.current, locked: genRef.current.colors.map(() => on) })}
          />
        )}
        <div ref={colsRef} className={`cols${gray ? " gray" : ""}${colDrag ? " dragging-cols" : ""}`}>
          {colOrder.map((i) => [gen.colors[i], i] as const).map(([hex, i]) => (
            <Column
              key={i}
              hex={hex}
              dragging={colDrag?.from === i}
              onPointerDown={(e) => startColDrag(i, e)}
              shown={simulate(hex, vision)}
              pantone={pantoneOf(hex, i)}
              ctx={ctx}
              locked={gen.locked[i]}
              canRemove={gen.colors.length > 2}
              open={picker?.i === i}
              onOpen={(e) => {
                if (justDragged.current) return;
                setAdjust(null);
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setPicker(picker?.i === i ? null : { i, left: Math.max(8, Math.min(window.innerWidth - 300, r.left + r.width / 2 - 146)), top: r.top + 64 });
              }}
              onLock={() => change({ ...gen, locked: gen.locked.map((l, j) => (j === i ? !l : l)) })}
              onSet={(h) => setColor(i, h)}
              onRemove={() => {
                setPicker(null);
                change({ ...gen, colors: gen.colors.filter((_, j) => j !== i), locked: gen.locked.filter((_, j) => j !== i) });
              }}
            />
          ))}
        </div>
      </div>
      {picker && gen.colors[picker.i] && (
        <ColorPopover ctx={ctx} hex={gen.colors[picker.i]} left={picker.left} top={picker.top} onSet={(h) => setColor(picker.i, h, `pick-${picker.i}`)} onClose={() => setPicker(null)} />
      )}
      {!full && (
        <p className="note">
          <span className="kbd">Space</span> new colours · <span className="kbd">Ctrl</span>+<span className="kbd">Z</span> undo ·{" "}
          <span className="kbd">G</span> greyscale · <span className="kbd">W</span> colour wheel · <span className="kbd">F</span> full screen ·{" "}
          <span className="kbd">Esc</span> back. Click a colour to fine-tune it, drag it to change the order; lock the ones you want to keep. With Image Sampling All on, new
          colours come from all the images in this project, following the harmony you chose.
        </p>
      )}
    </div>
  );
}

function Column(props: {
  hex: string;
  /** The colour as displayed (differs from hex when simulating colour vision). */
  shown: string;
  pantone?: string;
  ctx: Ctx;
  locked: boolean;
  canRemove: boolean;
  open: boolean;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onOpen: (e: React.MouseEvent) => void;
  onLock: () => void;
  onSet: (hex: string) => void;
  onRemove: () => void;
}) {
  const { hex, ctx, locked } = props;
  const [text, setText] = useState(hex);
  useEffect(() => setText(hex), [hex]);
  const ink = readableInk(props.shown);
  const commit = () => {
    const h = normHex(text);
    if (h && h !== hex) props.onSet(h);
    else setText(hex);
  };
  return (
    <div
      className={`col${props.open ? " open" : ""}${props.dragging ? " dragging" : ""}`}
      style={{ background: props.shown, color: ink }}
      onPointerDown={props.onPointerDown}
      onClick={(e) => {
        const t = e.target as HTMLElement;
        if (t.closest("button, input")) return;
        props.onOpen(e);
      }}
      title="Click to adjust this colour, drag to move it"
    >
      <div className="col-tools">
        <button type="button" aria-pressed={locked} aria-label={locked ? "Unlock colour" : "Lock colour"} title={locked ? "Unlock" : "Lock"} onClick={props.onLock}>
          {locked ? <IconLock /> : <IconUnlock />}
        </button>
        <button type="button" aria-label="Copy value" title="Copy" onClick={(e) => copyText(props.pantone ?? formatValue(hex, ctx.mode), e, ctx)}>
          <IconCopy />
        </button>
        {props.canRemove && (
          <button type="button" aria-label="Remove colour" title="Remove" onClick={props.onRemove}>
            <IconX />
          </button>
        )}
      </div>
      <input
        className="hex"
        aria-label="Hex value"
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setText(hex);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {props.pantone && <span className="val pms-name">{props.pantone.replace(/^PANTONE /, "")}</span>}
      {ctx.mode !== "hex" && <span className="val num">{formatValue(hex, ctx.mode)}</span>}
    </div>
  );
}

function Range(props: { id: string; label: string; value: number; min: number; max: number; unit?: string; track?: string; onChange: (v: number) => void }) {
  const { id, label, value, min, max, unit = "", track, onChange } = props;
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="range">
      <label htmlFor={id} className="label">
        {label}
      </label>
      <span className="num range-val">
        {value > 0 && min < 0 ? "+" : ""}
        {Math.round(value)}
        {unit}
      </span>
      <input
        id={id}
        type="range"
        className={`slider${track ? " colored" : ""}`}
        min={min}
        max={max}
        value={value}
        style={{ "--fill": `${pct}%`, ...(track ? { "--track": track } : {}) } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function AdjustPanel({ a, onChange, onReset, onClose }: { a: Adjust; onChange: (a: Adjust) => void; onReset: () => void; onClose: () => void }) {
  return (
    <div className="popover adjust" role="dialog" aria-label="Adjust palette">
      <div className="pop-head">
        <b>Adjust palette</b>
        <button type="button" className="link" onClick={onReset}>
          Reset
        </button>
      </div>
      <Range id="adj-hue" label="Hue" min={-180} max={180} unit="°" value={a.hue} onChange={(v) => onChange({ ...a, hue: v })} />
      <Range id="adj-sat" label="Saturation" min={-100} max={100} value={a.sat} onChange={(v) => onChange({ ...a, sat: v })} />
      <Range id="adj-bri" label="Brightness" min={-100} max={100} value={a.bri} onChange={(v) => onChange({ ...a, bri: v })} />
      <Range
        id="adj-temp"
        label="Temperature"
        min={-100}
        max={100}
        value={a.temp}
        track="linear-gradient(to right, #6aa2ff, #e8e4dc, #ffad4d)"
        onChange={(v) => onChange({ ...a, temp: v })}
      />
      <span className="sw-label">Changes every colour, locked ones too.</span>
      <button type="button" className="btn small primary" onClick={onClose}>
        Done
      </button>
    </div>
  );
}

/** Calls `onPos` with the pointer position (0–1 inside the element) while pressing and dragging. */
function useDrag(onPos: (x: number, y: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onPos);
  cb.current = onPos;
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      el.setPointerCapture(e.pointerId);
      const at = (ev: { clientX: number; clientY: number }) => {
        const r = el.getBoundingClientRect();
        cb.current(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
      };
      at(e);
      const move = (ev: PointerEvent) => at(ev);
      const up = () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    },
  };
  return { ref, handlers };
}

type Tab = "hsb" | "rgb" | "cmyk" | "square" | "disc";
const TABS: { id: Tab; label: string }[] = [
  { id: "hsb", label: "HSB" },
  { id: "rgb", label: "RGB" },
  { id: "cmyk", label: "CMYK" },
  { id: "square", label: "Square" },
  { id: "disc", label: "Disc" },
];
function savedTab(): Tab {
  try {
    const t = localStorage.getItem("bp.pickerTab");
    if (t === "hsb" || t === "rgb" || t === "cmyk" || t === "square" || t === "disc") return t;
  } catch {
    /* no storage here */
  }
  return "hsb";
}

/**
 * The full colour box (HSB, RGB, CMYK, Square, Disc, shades). Clicks on elements matching
 * `keepOpen` (the thing that opened it) don't close it.
 */
export function ColorPopover({ ctx, hex, left, top, onSet, onClose, keepOpen = ".col" }: { ctx: Ctx; hex: string; left: number; top: number; onSet: (h: string) => void; onClose: () => void; keepOpen?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [tab, setTabState] = useState<Tab>(savedTab);
  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem("bp.pickerTab", t);
    } catch {
      /* remembered for this visit only */
    }
  };
  const [hsb, setHsb] = useState(() => rgbToHsb(hexToRgb(hex) ?? [0, 0, 0]));
  const [text, setText] = useState(formatValue(hex, ctx.mode));
  const last = useRef(hex);
  const [pos, setPos] = useState({ left, top });

  useEffect(() => {
    if (hex !== last.current) {
      last.current = hex;
      setText(formatValue(hex, ctx.mode));
      const n = rgbToHsb(hexToRgb(hex) ?? [0, 0, 0]);
      // Keep the hue when the colour is grey, so sliders and markers don't jump.
      setHsb((o) => [n[1] < 0.5 || n[2] < 0.5 ? o[0] : n[0], n[2] < 0.5 ? o[1] : n[1], n[2]]);
    }
  }, [hex, ctx.mode]);
  useEffect(() => setText(formatValue(hex, ctx.mode)), [ctx.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    setPos({ left, top: Math.max(8, Math.min(window.innerHeight - h - 8, top)) });
  }, [left, top, tab]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(t) && !t.closest(keepOpen)) onClose();
    };
    window.addEventListener("pointerdown", down);
    return () => window.removeEventListener("pointerdown", down);
  }, [onClose, keepOpen]);
  // CMYK sliders keep their own values while dragging, so they don't jump through RGB rounding.
  const [cmyk, setCmyk] = useState(() => rgbToCmyk(hexToRgb(hex) ?? [0, 0, 0]).map(Math.round) as [number, number, number, number]);
  const cmykHex = useRef(hex);
  useEffect(() => {
    if (hex !== cmykHex.current) {
      cmykHex.current = hex;
      setCmyk(rgbToCmyk(hexToRgb(hex) ?? [0, 0, 0]).map(Math.round) as [number, number, number, number]);
    }
  }, [hex, ctx.cmykVersion]);

  const emit = (nh: string) => {
    last.current = nh;
    setText(formatValue(nh, ctx.mode));
    onSet(nh);
  };
  const fromHsb = (h: number, s: number, b: number) => {
    setHsb([h, s, b]);
    emit(rgbToHex(hsbToRgb(h, s, b)));
  };
  const rgb = hexToRgb(hex) ?? ([0, 0, 0] as RGB);
  const fromRgb = (next: RGB) => {
    const nh = rgbToHex(next);
    const n = rgbToHsb(next);
    setHsb((o) => [n[1] < 0.5 || n[2] < 0.5 ? o[0] : n[0], n[1], n[2]]);
    emit(nh);
  };
  const [h, s, b] = hsb;
  const pure = rgbToHex(hsbToRgb(h, 100, 100));
  const hueTrack = "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)";

  const square = useDrag((x, y) => fromHsb(h, x * 100, (1 - y) * 100));
  const disc = useDrag((x, y) => {
    const dx = x - 0.5, dy = y - 0.5;
    const r = Math.min(1, Math.hypot(dx, dy) / 0.5);
    let ang = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (ang < 0) ang += 360;
    fromHsb(ang, r * 100, b);
  });
  const discX = 50 + Math.sin((h * Math.PI) / 180) * (s / 2);
  const discY = 50 - Math.cos((h * Math.PI) / 180) * (s / 2);

  return (
    <div ref={ref} className="popover color-pop" style={{ left: pos.left, top: pos.top }} role="dialog" aria-label="Adjust colour">
      <div className="pop-head">
        <span className="pop-swatch" style={{ background: hex }} />
        <input
          id="pop-value"
          className="field mono"
          value={text}
          spellCheck={false}
          aria-label={`Value (${ctx.mode.toUpperCase()})`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const v = parseValue(text, ctx.mode);
              if (v) onSet(v);
              else ctx.toast(`That isn't a ${ctx.mode.toUpperCase()} value. Try ${formatValue(hex, ctx.mode)}.`);
            }
          }}
          onBlur={() => {
            const v = parseValue(text, ctx.mode);
            if (v && v !== hex) onSet(v);
            else setText(formatValue(hex, ctx.mode));
          }}
        />
        <button type="button" className="icon-btn pop-copy" aria-label="Copy value" title="Copy" onClick={(e) => copyText(text, e, ctx)}>
          <IconCopy size={16} />
        </button>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <IconX size={16} />
        </button>
      </div>
      <div className="seg small tabs" role="tablist" aria-label="Picker">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "hsb" && (
        <>
          <Range id="pop-h" label="Hue" min={0} max={360} unit="°" value={h} track={hueTrack} onChange={(v) => fromHsb(v, s, b)} />
          <Range id="pop-s" label="Saturation" min={0} max={100} value={s} track={`linear-gradient(to right, ${rgbToHex(hsbToRgb(h, 0, b))}, ${rgbToHex(hsbToRgb(h, 100, b))})`} onChange={(v) => fromHsb(h, v, b)} />
          <Range id="pop-b" label="Brightness" min={0} max={100} value={b} track={`linear-gradient(to right, #000, ${rgbToHex(hsbToRgb(h, s, 100))})`} onChange={(v) => fromHsb(h, s, v)} />
        </>
      )}
      {tab === "rgb" && (
        <>
          {(["Red", "Green", "Blue"] as const).map((label, ch) => {
            const lo = rgb.slice() as RGB, hi = rgb.slice() as RGB;
            lo[ch] = 0;
            hi[ch] = 255;
            return (
              <Range
                key={label}
                id={`pop-${label}`}
                label={label}
                min={0}
                max={255}
                value={rgb[ch]}
                track={`linear-gradient(to right, ${rgbToHex(lo)}, ${rgbToHex(hi)})`}
                onChange={(v) => {
                  const next = rgb.slice() as RGB;
                  next[ch] = v;
                  fromRgb(next);
                }}
              />
            );
          })}
        </>
      )}
      {tab === "cmyk" && (
        <>
          {(["Cyan", "Magenta", "Yellow", "Black"] as const).map((label, ch) => {
            const lo = cmyk.slice() as [number, number, number, number], hi = cmyk.slice() as [number, number, number, number];
            lo[ch] = 0;
            hi[ch] = 100;
            return (
              <Range
                key={label}
                id={`pop-${label}`}
                label={label}
                min={0}
                max={100}
                unit="%"
                value={cmyk[ch]}
                track={`linear-gradient(to right, ${rgbToHex(cmykToRgb(lo))}, ${rgbToHex(cmykToRgb(hi))})`}
                onChange={(v) => {
                  const next = cmyk.slice() as [number, number, number, number];
                  next[ch] = v;
                  setCmyk(next);
                  const nh = rgbToHex(cmykToRgb(next));
                  cmykHex.current = nh;
                  const n = rgbToHsb(hexToRgb(nh)!);
                  setHsb((o) => [n[1] < 0.5 || n[2] < 0.5 ? o[0] : n[0], n[1], n[2]]);
                  emit(nh);
                }}
              />
            );
          })}
        </>
      )}
      {tab === "square" && (
        <>
          <div ref={square.ref} {...square.handlers} className="sv" style={{ background: pure }} aria-label="Saturation and brightness">
            <div className="sv-white" />
            <div className="sv-black" />
            <i style={{ left: `${s}%`, top: `${100 - b}%`, background: hex }} />
          </div>
          <Range id="pop-h2" label="Hue" min={0} max={360} unit="°" value={h} track={hueTrack} onChange={(v) => fromHsb(v, s, b)} />
        </>
      )}
      {tab === "disc" && (
        <>
          <div className="disc-wrap">
            <div ref={disc.ref} {...disc.handlers} className="disc" aria-label="Hue and saturation">
              <div className="disc-dim" style={{ opacity: 1 - b / 100 }} />
              <i style={{ left: `${discX}%`, top: `${discY}%`, background: hex }} />
            </div>
          </div>
          <Range id="pop-b2" label="Brightness" min={0} max={100} value={b} track={`linear-gradient(to right, #000, ${rgbToHex(hsbToRgb(h, s, 100))})`} onChange={(v) => fromHsb(h, s, v)} />
        </>
      )}

      <span className="label">Shades</span>
      <div className="shades">
        {shades(hex).map((c, i) => (
          <button key={i} type="button" style={{ background: c }} title={c} aria-label={`Use ${c}`} onClick={() => emit(c)} />
        ))}
      </div>
    </div>
  );
}

/** Where each rule places colours on the wheel (degrees from the base hue); free has no rule. */
const RULE_DOTS: Record<Rule, { a: number; r: number }[]> = {
  free: [{ a: 20, r: 0.85 }, { a: 140, r: 0.45 }, { a: 230, r: 0.8 }, { a: 300, r: 0.35 }],
  mono: [{ a: 0, r: 0.9 }, { a: 0, r: 0.62 }, { a: 0, r: 0.34 }],
  analogous: [{ a: -30, r: 0.85 }, { a: 0, r: 0.85 }, { a: 30, r: 0.85 }],
  complementary: [{ a: 0, r: 0.85 }, { a: 180, r: 0.85 }],
  split: [{ a: 0, r: 0.85 }, { a: 150, r: 0.85 }, { a: 210, r: 0.85 }],
  triad: [{ a: 0, r: 0.85 }, { a: 120, r: 0.85 }, { a: 240, r: 0.85 }],
  tetradic: [{ a: 0, r: 0.85 }, { a: 90, r: 0.85 }, { a: 180, r: 0.85 }, { a: 270, r: 0.85 }],
};
const RULE_HELP: Record<Rule, string> = {
  free: "Any colours, no rule",
  mono: "One hue, lighter and darker",
  analogous: "Neighbours on the wheel",
  complementary: "Opposite sides",
  split: "One colour and the two beside its opposite",
  triad: "Three, evenly spaced",
  tetradic: "Four, two opposite pairs",
};

/**
 * Harmony icon in the style of Adobe Color, simplified: a light grey circle with the rule's
 * colour positions as black dots joined by lines. Grey and black only.
 */
export function RuleWheel({ rule, size = 40 }: { rule: Rule; size?: number }) {
  const base = 25;
  const dots = RULE_DOTS[rule].map((d) => {
    const ang = ((base + d.a) * Math.PI) / 180;
    return { x: 50 + Math.sin(ang) * 40 * d.r, y: 50 - Math.cos(ang) * 40 * d.r };
  });
  const pts = dots.map((d) => `${d.x.toFixed(1)},${d.y.toFixed(1)}`).join(" ");
  const ink = "#343434";
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" className="rule-wheel">
      <circle cx="50" cy="50" r="47" fill="#D3CFC9" />
      {rule === "mono" && <line x1="50" y1="50" x2={dots[0].x} y2={dots[0].y} stroke={ink} strokeWidth="3.5" strokeLinecap="round" />}
      {rule === "complementary" && <line x1={dots[0].x} y1={dots[0].y} x2={dots[1].x} y2={dots[1].y} stroke={ink} strokeWidth="3.5" />}
      {rule === "analogous" && <polyline points={pts} fill="none" stroke={ink} strokeWidth="3.5" strokeLinejoin="round" />}
      {(rule === "split" || rule === "triad" || rule === "tetradic") && <polygon points={pts} fill="none" stroke={ink} strokeWidth="3.5" strokeLinejoin="round" />}
      {rule !== "free" && <circle cx="50" cy="50" r="3.5" fill={ink} />}
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={rule === "mono" ? 5.5 : 7} fill={ink} />
      ))}
    </svg>
  );
}

function HarmonyPicker({ rule, onChange }: { rule: Rule; onChange: (r: Rule) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    // Esc closes the list only, not the palette.
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key, true);
    };
  }, [open]);
  const label = RULES.find((r) => r.id === rule)?.label ?? "";
  return (
    <div className="harmony" ref={ref}>
      <button type="button" className="btn harmony-btn" aria-expanded={open} aria-label={`Harmony: ${label}`} title="Colour harmony" onClick={() => setOpen(!open)}>
        <RuleWheel rule={rule} size={26} /> {label}
      </button>
      {open && (
        <div className="popover harmony-pop" role="listbox" aria-label="Colour harmony">
          {RULES.map((r) => (
            <button
              key={r.id}
              type="button"
              role="option"
              aria-selected={r.id === rule}
              className="harmony-opt"
              onClick={() => {
                onChange(r.id);
                setOpen(false);
              }}
            >
              <RuleWheel rule={r.id} size={52} />
              <b>{r.label}</b>
              <span>{RULE_HELP[r.id]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function VisionPicker({ vision, onChange }: { vision: Vision; onChange: (v: Vision) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    // Esc closes the list only, not the palette.
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key, true);
    };
  }, [open]);
  return (
    <div className="vision" ref={ref}>
      <button type="button" className="round" aria-pressed={vision !== "normal"} aria-expanded={open} aria-label="Colour vision" title="Colour vision: see the palette as people with colour blindness do" onClick={() => setOpen(!open)}>
        <IconEye />
      </button>
      {open && (
        <div className="popover vision-pop" role="listbox" aria-label="Colour vision">
          {VISIONS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="option"
              aria-selected={v.id === vision}
              className="vision-opt"
              onClick={() => {
                onChange(v.id);
                setOpen(false);
              }}
            >
              <b>{v.label}</b>
              {v.help && <span>{v.help}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Advanced view: a large colour wheel with one point per colour (hue around, saturation outwards).
 * Dragging a point turns the others with it, so the harmony holds. Locked colours stay put:
 * their points can't be dragged and show a padlock; unlock to move them. With Free, only the
 * dragged point moves.
 */
function WheelPanel(props: { colors: string[]; locked: boolean[]; rule: Rule; vision: Vision; onChange: (c: string[]) => void; onLock: (i: number) => void; onLockAll: (on: boolean) => void }) {
  const { colors, locked, rule, vision, onChange } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState(0);
  const hsbs = colors.map((h) => rgbToHsb(hexToRgb(h) ?? [0, 0, 0]));
  const selI = Math.min(sel, colors.length - 1);
  const pos = (h: number, s: number) => ({ x: 50 + Math.sin((h * Math.PI) / 180) * (s / 2), y: 50 - Math.cos((h * Math.PI) / 180) * (s / 2) });

  const onDown = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const at = (ev: { clientX: number; clientY: number }) => ({ x: ((ev.clientX - r.left) / r.width) * 100, y: ((ev.clientY - r.top) / r.height) * 100 });
    const p0 = at(e);
    // The nearest point within reach is the one being dragged; otherwise the selected one jumps to the click.
    let idx = selI, best = Infinity;
    hsbs.forEach(([h, s], i) => {
      const q = pos(h, s);
      const d = Math.hypot(q.x - p0.x, q.y - p0.y);
      if (d < best) { best = d; idx = i; }
    });
    if (best > 7) idx = selI;
    setSel(idx);
    // A locked colour can be selected but not moved.
    if (locked[idx]) return;
    const start = hsbs.map((x) => x.slice() as [number, number, number]);
    el.setPointerCapture(e.pointerId);
    const apply = (ev: { clientX: number; clientY: number }) => {
      const p = at(ev);
      const dx = p.x - 50, dy = p.y - 50;
      const s = Math.min(100, (Math.hypot(dx, dy) / 50) * 100);
      let h = (Math.atan2(dx, -dy) * 180) / Math.PI;
      if (h < 0) h += 360;
      const dh = h - start[idx][0];
      const next = start.map(([hh, ss, bb], i) => {
        if (i === idx) return rgbToHex(hsbToRgb(h, s, bb));
        if (rule === "free" || locked[i]) return colors[i];
        return rgbToHex(hsbToRgb((((hh + dh) % 360) + 360) % 360, ss, bb));
      });
      onChange(next);
    };
    apply(e);
    const move = (ev: PointerEvent) => apply(ev);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const [h, s, b] = hsbs[selI] ?? [0, 0, 0];
  const selLocked = !!locked[selI];
  return (
    <div className="wheel-panel">
      <div ref={ref} className="big-wheel" onPointerDown={onDown} aria-label="Colour wheel: drag the points">
        <svg className="wheel-lines" viewBox="0 0 100 100" aria-hidden="true">
          {hsbs.map(([hh, ss], i) => {
            const q = pos(hh, ss);
            return <line key={i} x1="50" y1="50" x2={q.x} y2={q.y} stroke="#fff" strokeWidth={i === selI ? 0.9 : 0.5} opacity="0.9" />;
          })}
        </svg>
        {hsbs.map(([hh, ss], i) => {
          const q = pos(hh, ss);
          return (
            <i
              key={i}
              className={`wpt${i === selI ? " on" : ""}${locked[i] ? " locked" : ""}`}
              style={{ left: `${q.x}%`, top: `${q.y}%`, background: simulate(colors[i], vision) }}
              title={`${colors[i]}${locked[i] ? " (locked)" : ""}`}
            >
              {locked[i] && (
                <span className="wlock">
                  <IconLock size={10} />
                </span>
              )}
            </i>
          );
        })}
      </div>
      <div className="range">
        <label htmlFor="wheel-b" className="label">
          Brightness · colour {selI + 1}
        </label>
        <span className="num range-val">{Math.round(b)}</span>
        <input
          id="wheel-b"
          type="range"
          className="slider colored"
          min={0}
          max={100}
          value={b}
          disabled={selLocked}
          title={selLocked ? "Locked: unlock the colour to change it" : undefined}
          style={{ "--track": `linear-gradient(to right, #000, ${rgbToHex(hsbToRgb(h, s, 100))})` } as React.CSSProperties}
          onChange={(e) => onChange(colors.map((c, i) => (i === selI ? rgbToHex(hsbToRgb(h, s, Number(e.target.value))) : c)))}
        />
      </div>
      <div className="wheel-swatches">
        {colors.map((c, i) => (
          <button key={i} type="button" className={`sw${i === selI ? " on" : ""}`} style={{ background: simulate(c, vision) }} aria-label={`Select colour ${i + 1}`} onClick={() => setSel(i)}>
            {locked[i] && (
              <span className="wlock">
                <IconLock size={10} />
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="wheel-locks">
        <button type="button" className="btn small" onClick={() => props.onLock(selI)}>
          {selLocked ? <IconUnlock size={15} /> : <IconLock size={15} />} {selLocked ? "Unlock" : "Lock"} colour {selI + 1}
        </button>
        <button type="button" className="btn small" disabled={locked.every(Boolean)} onClick={() => props.onLockAll(true)}>
          <IconLock size={15} /> Lock all
        </button>
        <button type="button" className="btn small" disabled={!locked.some(Boolean)} onClick={() => props.onLockAll(false)}>
          <IconUnlock size={15} /> Unlock all
        </button>
      </div>
      <span className="sw-label">
        {rule === "free" ? "Drag a point to move that colour." : "Drag a point and the others turn with it, keeping the harmony."} Locked colours stay
        where they are.
      </span>
    </div>
  );
}
