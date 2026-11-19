import { useEffect, useState } from "react";
import type { Ctx } from "./App";
import { contrast, contrastGrade, formatValue } from "./color";
import { IconArrowLeft, IconFocus, IconGray, IconSwap } from "./icons";
import { ColorPopover } from "./Generator";
import { useWindowFullscreen } from "./platform";
import { fileUrl, type FmFont } from "./api";

export interface TextTestColor { hex: string; pantone?: string; label?: string }

/** Typefaces to try. Google Fonts load when picked; the rest are usually on a Windows computer. */
const FONTS: { group: string; list: string[] }[] = [
  {
    group: "On your computer",
    list: [
      "Segoe UI", "Arial", "Helvetica", "Verdana", "Tahoma", "Trebuchet MS", "Calibri", "Candara", "Corbel", "Century Gothic",
      "Franklin Gothic Medium", "Gill Sans MT", "Bahnschrift", "Georgia", "Cambria", "Times New Roman", "Garamond",
      "Palatino Linotype", "Book Antiqua", "Constantia", "Rockwell", "Impact", "Consolas", "Courier New",
    ],
  },
  {
    group: "Google Fonts",
    list: [
      "Inter", "DM Sans", "Manrope", "Montserrat", "Poppins", "Space Grotesk", "Work Sans", "Archivo", "Syne",
      "Playfair Display", "DM Serif Display", "Fraunces", "Lora", "Libre Baskerville", "Cormorant Garamond", "Bodoni Moda",
      "Abril Fatface", "Bebas Neue", "Anton", "Caveat",
    ],
  },
];
const GOOGLE = new Set(FONTS[1].list);
const loaded = new Set<string>();
/** Fonts from Buni Font Manager projects are picked as "fm:<id>" and loaded from their files. */
const fmFonts = new Map<string, FmFont>();
function useFont(name: string) {
  useEffect(() => {
    if (loaded.has(name)) return;
    if (name.startsWith("fm:")) {
      const f = fmFonts.get(name.slice(3));
      if (!f) return;
      loaded.add(name);
      const face = new FontFace(`bfm-${f.id}`, `url("${fileUrl(f.path)}")`);
      face.load().then((ff) => document.fonts.add(ff), () => loaded.delete(name));
      return;
    }
    if (!GOOGLE.has(name)) return;
    loaded.add(name);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:wght@400;700&display=swap`;
    document.head.appendChild(link);
  }, [name]);
}
const stack = (name: string) => `"${name.startsWith("fm:") ? `bfm-${name.slice(3)}` : name}", "Segoe UI", system-ui, sans-serif`;

const LOREM =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante venenatis dapibus, posuere velit aliquet. " +
  "Donec ullamcorper nulla non metus auctor fringilla. Vestibulum id ligula porta felis euismod semper. Cras mattis consectetur " +
  "purus sit amet fermentum. Maecenas sed diam eget risus varius blandit sit amet non magna. Nullam quis risus eget urna mollis " +
  "ornare vel eu leo. Aenean lacinia bibendum nulla sed consectetur.";

/** Which colour is used: one of the palette's, or one set here that the palette doesn't have. */
type Choice = { pal: number } | { own: "black" | "white" | "custom" };
const OWN = { black: "#000000", white: "#FFFFFF" };

function saved<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function remember(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* remembered for this visit only */
  }
}

function Led({ ratio }: { ratio: number }) {
  const g = contrastGrade(ratio);
  return <span className={`led ${g.tone}`} aria-label={g.label} title={g.label} />;
}

export function TextTest({ ctx, colors, name, backLabel, onBack }: { ctx: Ctx; colors: TextTestColor[]; name: string; backLabel: string; onBack: () => void }) {
  const [bg, setBg] = useState<Choice>({ pal: 0 });
  const [ink, setInk] = useState<Choice>({ pal: Math.max(0, colors.length - 1) });
  const [custom, setCustom] = useState({ bg: "#6E6A64", ink: "#F2EBDD" });
  const [title, setTitle] = useState(ctx.project.name);
  const [fonts, setFonts] = useState(() => saved("bp.fonts", { title: "Segoe UI", body: "Segoe UI" }));
  const [gray, setGray] = useState(false);
  const [full, setFull] = useState(false);
  const [picker, setPicker] = useState<{ which: "bg" | "ink"; left: number; top: number } | null>(null);
  const fm = ctx.fmProjects ?? [];
  for (const p of fm) for (const f of p.fonts) fmFonts.set(f.id, f);
  // A Font Manager font that's no longer there falls back to Segoe UI.
  const okFont = (v: string) => (v.startsWith("fm:") ? (fmFonts.has(v.slice(3)) ? v : "Segoe UI") : v);
  useFont(okFont(fonts.title));
  useFont(okFont(fonts.body));
  useWindowFullscreen(full);

  const hexOf = (c: Choice, which: "bg" | "ink") => ("pal" in c ? colors[c.pal]?.hex ?? "#FFFFFF" : c.own === "custom" ? custom[which] : OWN[c.own]);
  const bgHex = hexOf(bg, "bg");
  const inkHex = hexOf(ink, "ink");
  const ratio = contrast(bgHex, inkHex);
  const grade = contrastGrade(ratio);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT")) return;
      if (e.key === "Escape") {
        if (document.querySelector(".color-pop")) return;
        if (full) setFull(false);
        else onBack();
      } else if (e.key.toLowerCase() === "g" && !e.ctrlKey && !e.metaKey) setGray((g) => !g);
      else if (e.key.toLowerCase() === "f" && !e.ctrlKey && !e.metaKey) setFull((f) => !f);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full, onBack]);

  const setFont = (k: "title" | "body", v: string) => {
    const next = { ...fonts, [k]: v };
    setFonts(next);
    remember("bp.fonts", next);
  };
  const label = (c: TextTestColor) => (c.pantone ? c.pantone.replace(/^PANTONE /, "") : c.label ?? formatValue(c.hex, ctx.mode));
  const same = (a: Choice, b: Choice) => ("pal" in a && "pal" in b ? a.pal === b.pal : "own" in a && "own" in b && a.own === b.own);

  const row = (which: "bg" | "ink") => {
    const cur = which === "bg" ? bg : ink;
    const pick = which === "bg" ? setBg : setInk;
    const what = which === "bg" ? "Background" : "Text";
    return (
      <div className="pick-row">
        {colors.map((c, i) => (
          <button key={i} type="button" className="sw" style={{ background: c.hex }} aria-pressed={same(cur, { pal: i })} aria-label={`${what} ${label(c)}`} title={label(c)} onClick={() => pick({ pal: i })} />
        ))}
        <span className="pick-sep" aria-hidden="true" />
        <button type="button" className="sw own" style={{ background: OWN.black }} aria-pressed={same(cur, { own: "black" })} aria-label={`${what} black`} title="Black" onClick={() => pick({ own: "black" })} />
        <button type="button" className="sw own" style={{ background: OWN.white }} aria-pressed={same(cur, { own: "white" })} aria-label={`${what} white`} title="White" onClick={() => pick({ own: "white" })} />
        <button
          type="button"
          className="sw own sw-custom"
          style={{ background: custom[which] }}
          aria-pressed={same(cur, { own: "custom" })}
          aria-label={`${what}: any colour`}
          title="Any colour"
          onClick={(e) => {
            pick({ own: "custom" });
            const r = e.currentTarget.getBoundingClientRect();
            setPicker(picker?.which === which ? null : { which, left: Math.max(8, Math.min(window.innerWidth - 300, r.left - 260)), top: r.bottom + 8 });
          }}
        />
      </div>
    );
  };

  const fontSelect = (k: "title" | "body") => (
    <select id={`font-${k}`} className="select font-select" value={okFont(fonts[k])} onChange={(e) => setFont(k, e.target.value)} style={{ fontFamily: stack(fonts[k]) }}>
      {fm.map((p) => (
        <optgroup key={`fm-${p.name}`} label={`Font Manager · ${p.name}`}>
          {p.fonts.filter((f) => f.index === 0).map((f) => (
            <option key={f.id} value={`fm:${f.id}`}>
              {f.name}
            </option>
          ))}
        </optgroup>
      ))}
      {FONTS.map((g) => (
        <optgroup key={g.group} label={g.group}>
          {g.list.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );

  return (
    <div className={`text-test${full ? " full" : ""}`}>
      <div className="titlebar">
        <div>
          {!full && (
            <button type="button" className="back" onClick={onBack}>
              <IconArrowLeft size={16} /> {backLabel}
              <span className="kbd">Esc</span>
            </button>
          )}
          <h1>Text on colour · {name}</h1>
        </div>
        <div className="tools">
          <button type="button" className="round" aria-pressed={gray} aria-label="Greyscale" title="Greyscale (G)" onClick={() => setGray(!gray)}>
            <IconGray />
          </button>
          <button type="button" className="round" aria-pressed={full} aria-label={full ? "Leave full screen" : "Full screen"} title={full ? "Leave full screen (Esc)" : "Full screen (F)"} onClick={() => setFull(!full)}>
            <IconFocus />
          </button>
        </div>
      </div>

      <div className="text-mode">
        <div className={`stage-big${gray ? " gray" : ""}`} style={{ background: bgHex, color: inkHex }}>
          <div className="stage-copy">
            <p className="stage-title" style={{ fontFamily: stack(okFont(fonts.title)) }}>
              {title || "Sample title"}
            </p>
            <p className="stage-body" style={{ fontFamily: stack(okFont(fonts.body)) }}>
              {LOREM}
            </p>
          </div>
        </div>
        <aside className="text-side">
          <div>
            <h3>Contrast</h3>
            <div className="ratio">
              <Led ratio={ratio} />
              <b>{ratio.toFixed(2)}:1</b>
              <span className={`grade ${grade.tone}`}>{grade.label}</span>
            </div>
            <span className="sw-label">Green: fine for body text (4.5:1). Yellow: large titles only (3:1). Red: too low.</span>
          </div>
          <div className="field-wrap">
            <label className="label" htmlFor="tt-title">
              Title
            </label>
            <input id="tt-title" className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="font-row">
            {ctx.fmProjects && ctx.fmProjects.length === 0 && <span className="sw-label font-note">No Font Manager projects with fonts yet.</span>}
            <label className="label" htmlFor="font-title">
              Title font
            </label>
            {fontSelect("title")}
            <label className="label" htmlFor="font-body">
              Body font
            </label>
            {fontSelect("body")}
          </div>
          <div>
            <h3>Background</h3>
            {row("bg")}
          </div>
          <div>
            <h3>Text</h3>
            {row("ink")}
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setBg(ink);
              setInk(bg);
              setCustom((c) => ({ bg: c.ink, ink: c.bg }));
            }}
          >
            <IconSwap /> Swap text and background
          </button>
          <div>
            <h3>Every pair in this palette</h3>
            <div className={`pairs${gray ? " gray" : ""}`}>
              {colors.flatMap((b, bi) =>
                colors.map((t, ti) => {
                  if (bi === ti) return null;
                  const r = contrast(b.hex, t.hex);
                  return (
                    <button
                      key={`${bi}-${ti}`}
                      type="button"
                      className="pair-tile"
                      style={{ background: b.hex, color: t.hex }}
                      title={`${r.toFixed(2)}:1 · ${contrastGrade(r).label}`}
                      onClick={() => {
                        setBg({ pal: bi });
                        setInk({ pal: ti });
                      }}
                    >
                      <Led ratio={r} />
                      <b>Aa</b>
                      <span>{r.toFixed(1)}</span>
                    </button>
                  );
                }),
              )}
            </div>
          </div>
        </aside>
      </div>
      {picker && (
        <ColorPopover
          ctx={ctx}
          hex={custom[picker.which]}
          left={picker.left}
          top={picker.top}
          keepOpen=".sw-custom"
          onSet={(h) => {
            setCustom((c) => ({ ...c, [picker.which]: h }));
            (picker.which === "bg" ? setBg : setInk)({ own: "custom" });
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}
