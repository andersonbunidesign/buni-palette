import { useEffect, useState } from "react";
import type { Ctx } from "./App";
import type { Palette } from "./store";
import { readableInk } from "./color";
import { colorLabel } from "./store";
import { IconGray, IconX } from "./icons";
import { useWindowFullscreen } from "./platform";

/** Full-screen view: the chosen palettes stacked, to compare them. */
export function Compare({ ctx, palettes, onClose }: { ctx: Ctx; palettes: Palette[]; onClose: () => void }) {
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
    <div className="compare" role="dialog" aria-label="Compare palettes">
      <div className="compare-bar">
        <b>Compare</b>
        <span className="sw-label">{palettes.length === 1 ? "1 palette" : `${palettes.length} palettes`}</span>
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
            <span className={`band-name${p.kind === "pantone" ? " pms" : ""}`}>{p.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
