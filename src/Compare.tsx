import { useEffect, useState } from "react";
import type { Ctx } from "./App";
import type { Gradient, Palette } from "./store";
import { css, sorted } from "./gradient";
import { formatValue } from "./color";
import { readableInk } from "./color";
import { colorLabel } from "./store";
import { IconGray, IconX } from "./icons";
import { useWindowFullscreen } from "./platform";

/** Full-screen view: the chosen palettes or gradients stacked, to compare them. */
export function Compare({ ctx, palettes, gradients = [], onClose }: { ctx: Ctx; palettes: Palette[]; gradients?: Gradient[]; onClose: () => void }) {
  const [gray, setGray] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key.toLowerCase() === "g" && !e.ctrlKey && !e.metaKey) setGray((g) => !g);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useWindowFullscreen(true);

  const label = (c: Palette["colors"][number]) => colorLabel(c, ctx.mode);

  return (
    <div className="compare" role="dialog" aria-label={gradients.length ? "Compare gradients" : "Compare palettes"}>
      <div className="compare-bar">
        <b>Compare</b>
        <span className="sw-label">
          {[palettes.length ? (palettes.length === 1 ? "1 palette" : `${palettes.length} palettes`) : "", gradients.length ? (gradients.length === 1 ? "1 gradient" : `${gradients.length} gradients`) : ""]
            .filter(Boolean)
            .join(" · ")}
          {gradients.length > 0 && " · shown left to right, so they line up"}
        </span>
        <div className="spacer" />
        <span className="sw-label">
          <span className="kbd">G</span> greyscale · <span className="kbd">Esc</span> close
        </span>
        <button type="button" className="round" aria-pressed={gray} aria-label="Greyscale" title="Greyscale: check value contrast (G)" onClick={() => setGray((g) => !g)}>
          <IconGray />
        </button>
        <button type="button" className="round" aria-label="Close" title="Close (Esc)" onClick={onClose}>
          <IconX />
        </button>
      </div>
      <div className={`compare-stage${gray ? " gray" : ""}`}>
        {palettes.map((p) => (
          <div key={p.id} className="band">
            {p.colors.map((c, i) => (
              <i key={i} style={{ background: c.hex, color: readableInk(c.hex) }}>
                {label(c)}
              </i>
            ))}
            <span className={`band-name${p.colors.some((c) => c.pantone) ? " pms" : ""}`}>{p.name}</span>
          </div>
        ))}
        {gradients.map((g) => (
          // Every gradient runs left to right here, radial ones too, so they can be compared side by side.
          <div key={g.id} className="band gband" style={{ background: css({ ...g, type: "linear", angle: 90 }) }}>
            {sorted(g.stops).map((s, i, a) => (
              <span
                key={i}
                className="gband-stop"
                style={{ left: `${s.pos * 100}%`, color: readableInk(s.hex), transform: `translateX(${i === 0 ? 0 : i === a.length - 1 ? -100 : -50}%)` }}
              >
                {formatValue(s.hex, ctx.mode)}
              </span>
            ))}
            <span className="band-name">{g.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
