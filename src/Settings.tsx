import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import type { AppState } from "./store";
import { api, errText, type Settings as S } from "./api";
import { IconTrash, IconX } from "./icons";
import { VERSION } from "./App";

export function Settings(props: { state: AppState; onClose: () => void; onClear: () => void; onCmykChange: () => void; onFontsChange: () => void }) {
  const { state, onClose, onClear } = props;
  const [confirm, setConfirm] = useState(false);
  const [s, setS] = useState<S | null>(null);
  const [key, setKey] = useState("");
  const [size, setSize] = useState<{ files: number; bytes: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const refs = state.projects.flatMap((p) => p.refs);

  useEffect(() => {
    api.getSettings().then((x) => {
      setS(x);
      setKey(x.unsplashKey);
    }, (e) => setMsg(errText(e)));
    api.imagesSize().then(setSize, () => {});
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const patch = async (p: Parameters<typeof api.setSettings>[0]) => {
    try {
      const next = await api.setSettings(p);
      setS(next);
      setMsg(null);
      if ("cmykProfile" in p) props.onCmykChange();
      if ("fontManager" in p) props.onFontsChange();
    } catch (e) {
      setMsg(errText(e));
    }
  };

  const mb = size ? (size.bytes > 1e6 ? `${(size.bytes / 1e6).toFixed(1)} MB` : `${Math.round(size.bytes / 1e3)} KB`) : "";
  // The select shows the automatic choice, the built-in profile, every profile found, and one picked from a file.
  const choice = s?.cmykChoice ?? "auto";
  const listed = s ? s.profiles.some((p) => p.path === choice) : true;

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label="Settings">
        <div className="pop-head">
          <h2>Settings</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <IconX />
          </button>
        </div>
        {msg && <p className="error-line">{msg}</p>}

        <section className="set-row">
          <div>
            <h3>CMYK profile</h3>
            <p className="muted">
              Used for CMYK values on screen and in Illustrator files. Now: <b>{s?.cmykName ?? "…"}</b>.
              {choice === "auto" && " Automatic uses Adobe's Coated FOGRA39 when it's on this computer, otherwise the one built into the app."}
            </p>
          </div>
          <div className="set-col">
            <select
              id="cmyk-profile"
              className="select"
              value={choice}
              disabled={!s}
              onChange={async (e) => {
                const v = e.target.value;
                if (v === "file") {
                  const f = await open({ multiple: false, filters: [{ name: "ICC profile", extensions: ["icc", "icm"] }] });
                  if (typeof f === "string") patch({ cmykProfile: f });
                  return;
                }
                patch({ cmykProfile: v === "auto" ? null : v });
              }}
            >
              <option value="auto">Automatic (Coated FOGRA39)</option>
              <option value="builtin">Coated FOGRA39 (built in)</option>
              {s?.profiles.map((p) => (
                <option key={p.path ?? p.name} value={p.path ?? ""}>
                  {p.name}
                </option>
              ))}
              {!listed && choice !== "auto" && choice !== "builtin" && <option value={choice}>{s?.cmykName}</option>}
              <option value="file">Choose a profile file…</option>
            </select>
          </div>
        </section>

        <section className="set-row">
          <div>
            <h3>Explore · Unsplash access key</h3>
            <p className="muted">
              Explore searches Unsplash photos by keyword. Make a free key at{" "}
              <a href="https://unsplash.com/developers" target="_blank" rel="noreferrer">
                unsplash.com/developers
              </a>{" "}
              (New Application, then copy the Access Key). A new key allows 50 searches an hour.
            </p>
          </div>
          <div className="set-col">
            <input
              id="unsplash-key"
              className="field mono"
              placeholder="Access Key"
              value={key}
              spellCheck={false}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && patch({ unsplashKey: key })}
            />
            <button type="button" className="btn small" disabled={!s || key.trim() === (s?.unsplashKey ?? "")} onClick={() => patch({ unsplashKey: key })}>
              Save key
            </button>
          </div>
        </section>

        <section className="set-row">
          <div>
            <h3>Buni Font Manager</h3>
            <p className="muted">
              {s?.fontManagerFound
                ? "Text on colour can use the fonts of your Font Manager projects."
                : "Not found on this computer. When it's installed, Text on colour can use the fonts of its projects."}
            </p>
          </div>
          <label className="toggle-line">
            <input type="checkbox" checked={!!s?.fontManager} disabled={!s} onChange={(e) => patch({ fontManager: e.target.checked })} />
            Use Font Manager projects
          </label>
        </section>

        <section className="set-row">
          <div>
            <h3>Reference images</h3>
            <p className="muted">
              {refs.length} {refs.length === 1 ? "image" : "images"} in {state.projects.length} {state.projects.length === 1 ? "project" : "projects"}
              {mb ? `, ${mb} on disk` : ""}. Clearing them keeps every palette and colour, but you can no longer see where a colour came from or
              pick new colours from those images.
            </p>
          </div>
          {confirm ? (
            <div className="tools">
              <button type="button" className="btn small" onClick={() => setConfirm(false)}>
                Keep
              </button>
              <button
                type="button"
                className="btn small danger"
                onClick={() => {
                  onClear();
                  setConfirm(false);
                  setSize({ files: 0, bytes: 0 });
                }}
              >
                Clear {refs.length} images
              </button>
            </div>
          ) : (
            <button type="button" className="btn" disabled={!refs.length && !size?.files} onClick={() => setConfirm(true)}>
              <IconTrash size={16} /> Clear images
            </button>
          )}
        </section>

        <section className="set-row">
          <div>
            <h3>Library folder</h3>
            <p className="muted mono-path">{s?.dataFolder}</p>
          </div>
          <button type="button" className="btn" disabled={!s} onClick={() => s && openPath(s.dataFolder).catch(() => {})}>
            Open folder
          </button>
        </section>

        <a className="credit settings-credit" href="https://andersonbunidesign.com" target="_blank" rel="noreferrer">
          Vibe coded by Anderson Santos · Version {VERSION}
        </a>
      </div>
    </div>
  );
}
