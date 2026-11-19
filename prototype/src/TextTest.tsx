import React, { useEffect, useState } from "react";
import type { Ctx } from "./App";
import { contrast, contrastGrade, formatValue } from "./color";
import { IconArrowLeft, IconFocus, IconGray, IconSwap } from "./icons";

export interface TextTestColor { hex: string; pantone?: string }

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
function useFont(name: string) {
  useEffect(() => {
    if (!GOOGLE.has(name) || loaded.has(name)) return;
    loaded.add(name);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:wght@400;700&display=swap`;
    document.head.appendChild(link);
  }, [name]);
}
const stack = (name: string) => `"${name}", "Segoe UI", system-ui, sans-serif`;

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
  useFont(fonts.title);
  useFont(fonts.body);

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
        if (full) setFull(false);
        else onBack();
      } else if (e.key.toLowerCase() === "g" && !e.ctrlKey && !e.metaKey) setGray((g) => !g);
      else if (e.key.toLowerCase() === "f" && !e.ctrlKey && !e.metaKey) setFull((f) => !f);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full, onBack]);

  useEffect(() => {
    if (!full) return;
    try {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } catch {
      /* not allowed here; the view still covers the window */
    }
    const onChange = () => {
      if (!document.fullscreenElement) setFull(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      try {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      } catch {
        /* nothing to undo */
      }
    };
  }, [full]);

  const setFont = (k: "title" | "body", v: string) => {
    const next = { ...fonts, [k]: v };
    setFonts(next);
    remember("bp.fonts", next);
  };
  const label = (c: TextTestColor) => (c.pantone ? c.pantone.replace(/^PANTONE /, "") : formatValue(c.hex, ctx.mode));
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
        <button type="button" className="sw" style={{ background: OWN.black }} aria-pressed={same(cur, { own: "black" })} aria-label={`${what} black`} title="Black" onClick={() => pick({ own: "black" })} />
        <button type="button" className="sw" style={{ background: OWN.white }} aria-pressed={same(cur, { own: "white" })} aria-label={`${what} white`} title="White" onClick={() => pick({ own: "white" })} />
        <label className="sw sw-custom" style={{ background: custom[which] }} aria-pressed={same(cur, { own: "custom" })} title="Any colour" onClick={() => pick({ own: "custom" })}>
          <input
            id={`custom-${which}`}
            type="color"
            aria-label={`${what}: any colour`}
            value={custom[which].toLowerCase()}
            onChange={(e) => {
              setCustom((c) => ({ ...c, [which]: e.target.value.toUpperCase() }));
              pick({ own: "custom" });
            }}
          />
        </label>
      </div>
    );
  };

  const fontSelect = (k: "title" | "body") => (
    <select id={`font-${k}`} className="select font-select" value={fonts[k]} onChange={(e) => setFont(k, e.target.value)} style={{ fontFamily: stack(fonts[k]) }}>
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
            <p className="stage-title" style={{ fontFamily: stack(fonts.title) }}>
              {title || "Sample title"}
            </p>
            <p className="stage-body" style={{ fontFamily: stack(fonts.body) }}>
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
    </div>
  );
}
