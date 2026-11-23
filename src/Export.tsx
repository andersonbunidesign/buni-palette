import { useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import type { Ctx } from "./App";
import { paletteTag, type Gradient, type Palette } from "./store";
import { blendDrift, css, fewestStops, sorted } from "./gradient";
import { api, errText } from "./api";
import { cmykProfileName } from "./color";
import { IconArtwork, IconX } from "./icons";

type Mode = "rgb" | "cmyk";
function savedMode(): Mode {
  try {
    return localStorage.getItem("bp.exportMode") === "rgb" ? "rgb" : "cmyk";
  } catch {
    return "cmyk";
  }
}

/** Export to Illustrator: one square per colour, a swatch group per palette, a gradient swatch and rectangle per gradient. */
export function ExportDialog({ ctx, palettes, gradients = [], onClose }: { ctx: Ctx; palettes: Palette[]; gradients?: Gradient[]; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>(savedMode);
  const [busy, setBusy] = useState(false);
  // Only the stops you set (default), or extra stops so Illustrator's RGB blend matches the app.
  const [match, setMatchState] = useState(() => {
    try {
      return localStorage.getItem("bp.exportMatchBlend") === "1";
    } catch {
      return false;
    }
  });
  const setMatch = (v: boolean) => {
    setMatchState(v);
    try {
      localStorage.setItem("bp.exportMatchBlend", v ? "1" : "0");
    } catch {
      /* remembered for this visit only */
    }
  };
  const drifting = gradients.filter((g) => blendDrift(g) > 0.02);
  const extra = gradients.reduce((n, g) => n + fewestStops(g).length - g.stops.length, 0);
  const [error, setError] = useState<string | null>(null);
  const spots = palettes.reduce((n, p) => n + p.colors.filter((c) => c.pantone).length, 0);
  const total = palettes.reduce((n, p) => n + p.colors.length, 0);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose, busy]);

  const run = async () => {
    const base = palettes.length + gradients.length === 1 ? (palettes[0] ?? gradients[0]).name : ctx.project.name;
    const path = await save({ defaultPath: `${base.replace(/[\\/:*?"<>|]/g, "-")}.ai`, filters: [{ name: "Illustrator", extensions: ["ai"] }] });
    if (!path) return;
    try {
      localStorage.setItem("bp.exportMode", mode);
    } catch {
      /* remembered for this visit only */
    }
    setBusy(true);
    setError(null);
    try {
      const out = await api.exportIllustrator(
        palettes.map((p) => ({ name: p.name, colors: p.colors.map((c) => ({ hex: c.hex, pantone: c.pantone, label: c.label })) })),
        gradients.map((g) => ({
          name: g.name,
          radial: g.type === "radial",
          angle: g.angle,
          stops: match ? fewestStops(g) : sorted(g.stops).map(({ hex, pos }) => ({ hex, pos })),
          key: sorted(g.stops).map(({ hex, pos }) => ({ hex, pos })),
        })),
        mode,
        path,
      );
      onClose();
      ctx.toast(`Saved ${out.path.split(/[\\/]/).pop()}`);
      openPath(out.path).catch(() => {});
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="dialog" role="dialog" aria-label="Export to Illustrator">
        <div className="pop-head">
          <h2>Export to Illustrator</h2>
          <button type="button" className="icon-btn" aria-label="Close" disabled={busy} onClick={onClose}>
            <IconX />
          </button>
        </div>
        <div className="export-list">
          {palettes.map((p) => (
            <div key={p.id} className="export-row">
              <span className="mini">
                {p.colors.map((c, i) => (
                  <i key={i} style={{ background: c.hex }} />
                ))}
              </span>
              <span className="export-name">{p.name}</span>
              {p.colors.some((c) => c.pantone) && <span className="badge pms">{paletteTag(p)}</span>}
            </div>
          ))}
          {gradients.map((g) => (
            <div key={g.id} className="export-row">
              <span className="mini" style={{ background: css(g) }} />
              <span className="export-name">{g.name}</span>
              <span className="badge">Gradient</span>
            </div>
          ))}
        </div>
        {gradients.length > 0 && (
          <p className="muted">Each gradient becomes a gradient swatch and a filled rectangle with its stops written under it.</p>
        )}
        {drifting.length > 0 && (
          <div>
            <h3>Gradient stops</h3>
            <div className="seg small" role="group" aria-label="Gradient stops">
              <button type="button" aria-pressed={!match} onClick={() => setMatch(false)}>
                Only my stops
              </button>
              <button type="button" aria-pressed={match} onClick={() => setMatch(true)}>
                Match the app's blend
              </button>
            </div>
            <p className="sw-label export-help">
              {match
                ? `Adds ${extra} in-between ${extra === 1 ? "stop" : "stops"}, only where Illustrator's RGB blend would look different from the app. Easier to see, harder to edit.`
                : `Exactly the stops you set, easy to edit in Illustrator. Illustrator blends in RGB, so the middle of ${drifting.length === 1 ? `"${drifting[0].name}"` : `${drifting.length} of these`} will look a little duller than in the app.`}
            </p>
          </div>
        )}
        {palettes.length > 0 && <p className="muted">
          A square for every colour, with its values, and a swatch group per palette.{" "}
          {spots > 0
            ? `${spots} Pantone ${spots === 1 ? "colour becomes a named spot colour" : "colours become named spot colours"}; the other ${total - spots} ${total - spots === 1 ? "is a process colour" : "are process colours"}.`
            : "Every colour is a process colour."}
        </p>}
        <div>
          <h3>Document colour mode</h3>
          <div className="seg small" role="group" aria-label="Document colour mode">
            <button type="button" aria-pressed={mode === "cmyk"} onClick={() => setMode("cmyk")}>
              CMYK
            </button>
            <button type="button" aria-pressed={mode === "rgb"} onClick={() => setMode("rgb")}>
              RGB
            </button>
          </div>
          <p className="sw-label export-help">
            {mode === "cmyk"
              ? `Process colours get CMYK values from ${cmykProfileName() || "Coated FOGRA39"}; White and Black are exactly 0/0/0/0 and 0/0/0/100.`
              : "Process colours keep their RGB values."}
          </p>
        </div>
        {error && <p className="error-line">{error}</p>}
        <div className="foot">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={run}>
            <IconArtwork /> {busy ? "Illustrator is making the file…" : "Choose where to save"}
          </button>
        </div>
      </div>
    </div>
  );
}
