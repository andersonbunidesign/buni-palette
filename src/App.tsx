import React, { useCallback, useEffect, useRef, useState } from "react";
import { hasProcess, metaOf, withoutPantone, AppState, GenState, Palette, Project, RefImage, PColor, colorCopy, flushState, migrate, sampleState, saveState, setSaveErrorHandler, uid, gradientsOf, gradSig, type Gradient, type GradState } from "./store";
import { Gradients } from "./Gradients";
import { GradientEditor, newGrad } from "./GradientEditor";
import { cssBlock, css as gradCss } from "./gradient";
import { gradientImage } from "./share";
import { cmykProfileName, generate, setCmykTables } from "./color";
import type { Book } from "./pantone";
import { extract, loadImage } from "./extract";
import type { ValueMode } from "./color";
import { IconChevron, IconDots, IconPlus, IconTrash, IconEdit, IconGear, IconMoon, IconSun, Logo } from "./icons";
import { api, errText, setImagesDir, type FmProject } from "./api";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Explore } from "./Explore";
import { ExportDialog } from "./Export";
import { Settings } from "./Settings";
import { References } from "./References";
import { Generator, newGen } from "./Generator";
import { Palettes } from "./Palettes";
import { Convert } from "./Convert";
import { Compare } from "./Compare";
import { TextTest, type TextTestColor } from "./TextTest";
import { paletteImage } from "./share";
import { copyText } from "./References";

/** Set from the desktop app when it starts. */
export let VERSION = "1.2.0";

export type View = "refs" | "gen" | "palettes" | "text" | "explore" | "grads" | "gedit";

export interface MenuItem { label: string; icon?: React.ReactNode; onClick: (e: React.MouseEvent) => void; danger?: boolean; disabled?: boolean }

export interface Ctx {
  state: AppState;
  project: Project;
  updateProject: (fn: (p: Project) => Project) => void;
  setGen: (g: GenState) => void;
  gen: GenState;
  go: (v: View) => void;
  /** A short message; `undo` adds an Undo button to it. */
  toast: (msg: string, undo?: boolean) => void;
  /** Call before a change that Ctrl+Z (on Color Palettes) or the Undo button can take back. */
  checkpoint: (label: string) => void;
  note: (msg: string, e: { clientX: number; clientY: number }) => void;
  mode: ValueMode;
  tray: string[];
  setTray: (t: string[]) => void;
  /** Pantone conversion of a saved palette, or of colours on screen in the generator. */
  openConvert: (paletteId: string) => void;
  convertColors: (colors: (string | PColor)[], name: string, imageId?: string) => void;
  openCompare: (ids: string[]) => void;
  /** Text on colour test, inside the window. */
  openTextTest: (colors: TextTestColor[], name: string) => void;
  /** Shows the app's own right-click menu. */
  contextMenu: (e: React.MouseEvent, items: MenuItem[]) => void;
  sharePalette: (p: Palette) => void;
  /** Standard actions for a palette, for menus. */
  paletteActions: (p: Palette, projectId: string, extra?: { rename?: () => void }) => MenuItem[];
  /** Opens the generator with new random colours. */
  newPalette: () => void;
  /** Palette to select when the grid opens (picked from the sidebar). */
  focusPal: string | null;
  addImages: (files: Blob[], names?: string[]) => void;
  /** Opens a palette in the generator: in the window, or full screen straight from the grid. */
  openPalette: (paletteId: string, full?: boolean) => void;
  /** Full screen generator: opened from the window (Esc returns to it) or from the grid (Esc returns to the grid). */
  genFull: FullMode;
  setGenFull: (v: FullMode) => void;
  /** Moves palettes to another project, or copies them. */
  sendPalettes: (ids: string[], toProject: string, copy: boolean) => void;
  setBooks: (b: Book[]) => void;
  /** Reads the image on the clipboard; `loud` shows a message when there's none. */
  pasteClipboard: (loud: boolean) => void;
  removeRef: (id: string) => void;
  /** Stores an image in the library folder and reads its colours; doesn't add it to a project. */
  storeImage: (blob: Blob, name: string, extra?: Partial<RefImage>) => Promise<RefImage>;
  /** Adds palettes (and the images they came from) to a project. */
  addToProject: (projectId: string, palettes: Palette[], refs: RefImage[], gradients?: Gradient[]) => void;
  exportPalettes: (palettes: Palette[]) => void;
  /** Export to Illustrator with gradients too. */
  exportItems: (palettes: Palette[], gradients: Gradient[]) => void;
  /** Gradient editor state of this project. */
  grad: GradState;
  setGrad: (g: GradState) => void;
  /** Opens a saved gradient in the editor. */
  openGradient: (id: string) => void;
  /** Opens the editor on a new gradient; `init` fills it (from an image, a suggestion…). */
  newGradient: (init?: Partial<GradState>) => void;
  gradientActions: (g: Gradient, projectId: string, extra?: { rename?: () => void }) => MenuItem[];
  sendGradients: (ids: string[], toProject: string, copy: boolean) => void;
  /** Gradient to select when the grid opens (picked from the sidebar). */
  focusGrad: string | null;
  /** Set by the gradient editor: a colour clicked in the sidebar palettes goes into its selected stop. */
  stopPick: React.MutableRefObject<((hex: string) => void) | null>;
  /** Projects of Buni Font Manager, when it's installed and the link is on. */
  fmProjects: FmProject[] | null;
  openSettings: () => void;
  /** Set by Explore so results can be dropped on a project in the sidebar. */
  exploreDrop: React.MutableRefObject<((projectId: string) => void) | null>;
  /** Bumped when the CMYK profile changes, so values on screen are redrawn. */
  cmykVersion: number;
}

export type FullMode = false | "window" | "grid";
type Theme = "light" | "dark";
function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem("bp.theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* no storage here */
  }
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [view, setView] = useState<View>("palettes");
  const [convertState, setConvertState] = useState<{ pal: Palette; back: View } | null>(null);
  const [compare, setCompare] = useState<Palette[] | null>(null);
  const [textTest, setTextTest] = useState<{ colors: TextTestColor[]; name: string; back: View } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [exporting, setExporting] = useState<{ palettes: Palette[]; gradients: Gradient[] } | null>(null);
  const [focusGrad, setFocusGrad] = useState<string | null>(null);
  const stopPick = useRef<((hex: string) => void) | null>(null);
  const [fmProjects, setFmProjects] = useState<FmProject[] | null>(null);
  const [cmykVersion, setCmykVersion] = useState(0);
  const exploreDrop = useRef<((projectId: string) => void) | null>(null);
  const [focusPal, setFocusPal] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<{ text: string; undo: boolean } | null>(null);
  // Undo for changes made on Color Palettes and in the sidebar: snapshots of the projects before each change.
  const undoStack = useRef<{ label: string; state: AppState }[]>([]);
  const stateRef = useRef<AppState | null>(null);
  stateRef.current = state;
  const [cursorNote, setCursorNote] = useState<{ text: string; x: number; y: number } | null>(null);
  const [tray, setTray] = useState<string[]>([]);
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [genFull, setGenFull] = useState<FullMode>(false);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [settings, setSettings] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const loadCmyk = useCallback(() => {
    api
      .cmykLut()
      .then((t) => {
        setCmykTables(t);
        setCmykVersion((v) => v + 1);
      })
      .catch(() => {});
  }, []);
  const loadFonts = useCallback(() => {
    api.fontManagerProjects().then(setFmProjects).catch(() => setFmProjects(null));
  }, []);

  useEffect(() => {
    api
      .getState()
      .then((st) => {
        VERSION = st.version;
        setImagesDir(st.imagesDir);
        let saved: AppState | null = null;
        try {
          saved = st.data ? (JSON.parse(st.data) as AppState) : null;
        } catch {
          saved = null;
        }
        const st0 = saved && saved.projects?.length ? migrate(saved) : sampleState();
        setState(st0);
        // Image files no project uses (left from an earlier session) are removed.
        api.clearImages(st0.projects.flatMap((p) => p.refs.flatMap((r) => [r.file, r.thumb]))).catch(() => {});
      })
      .catch(() => setState(sampleState()));
    loadCmyk();
    loadFonts();
    setSaveErrorHandler((e) => toast(errText(e)));
    // Write the last change before the window closes.
    const un = getCurrentWindow().onCloseRequested(async () => {
      await flushState();
    });
    // Links open in the browser, not inside the app.
    const onLink = (e: MouseEvent) => {
      const a = (e.target as HTMLElement)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || !/^https?:/.test(a.href)) return;
      e.preventDefault();
      openUrl(a.href).catch(() => {});
    };
    document.addEventListener("click", onLink);
    return () => {
      un.then((f) => f()).catch(() => {});
      document.removeEventListener("click", onLink);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = useCallback((fn: (s: AppState) => AppState) => {
    setState((s) => {
      if (!s) return s;
      const next = fn(s);
      saveState(next);
      // Image files no reference uses any more are deleted.
      const files = (st: AppState) => new Set(st.projects.flatMap((p) => p.refs.flatMap((r) => [r.file, r.thumb])));
      const now = files(next);
      // Images a change could still bring back with Undo stay until the app starts again.
      for (const u of undoStack.current) for (const f of files(u.state)) now.add(f);
      const gone = Array.from(files(s)).filter((f) => f && !now.has(f));
      if (gone.length) api.deleteImages(gone).catch(() => {});
      return next;
    });
  }, []);

  const toastTimer = useRef(0);
  const toast = useCallback((msg: string, undo = false) => {
    setToastMsg({ text: msg, undo });
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), undo ? 7000 : 2600);
  }, []);
  const checkpoint = useCallback((label: string) => {
    if (!stateRef.current) return;
    undoStack.current.push({ label, state: stateRef.current });
    if (undoStack.current.length > 40) undoStack.current.shift();
  }, []);
  const undo = useCallback(() => {
    const last = undoStack.current.pop();
    if (!last) {
      toast("Nothing to undo");
      return;
    }
    // Projects and palettes go back; colour mode, guides and open generators stay as they are.
    set((s) => ({ ...s, projects: last.state.projects, current: last.state.projects.some((p) => p.id === s.current) ? s.current : last.state.current, gen: { ...last.state.gen, ...s.gen } }));
    toast(`Undid ${last.label}`);
  }, [set, toast]);
  // Ctrl+Z on Color Palettes undoes the last delete, move, copy, rename, duplicate or reorder.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== "z" || (view !== "palettes" && view !== "grads")) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (document.querySelector(".overlay, .compare")) return;
      e.preventDefault();
      undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, undo]);
  const noteTimer = useRef(0);
  const note = useCallback((text: string, e: { clientX: number; clientY: number }) => {
    setCursorNote({ text, x: e.clientX + 14, y: e.clientY + 14 });
    clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setCursorNote(null), 1100);
  }, []);

  const updateProject = useCallback(
    (fn: (p: Project) => Project) =>
      set((s) => ({ ...s, projects: s.projects.map((p) => (p.id === s.current ? fn(p) : p)) })),
    [set],
  );

  const storeImage = useCallback(async (blob: Blob, name: string, extra?: Partial<RefImage>): Promise<RefImage> => {
    const img = await loadImage(blob);
    const id = uid();
    const file = `${id}.${img.ext}`;
    const thumb = `${id}-thumb.${img.ext}`;
    await api.saveImage(file, img.full);
    await api.saveImage(thumb, img.thumb);
    const count = extra?.count ?? 5;
    let auto = extra?.auto;
    if (!auto) {
      const tmp = URL.createObjectURL(img.full);
      try {
        auto = await extract(tmp, count);
      } finally {
        URL.revokeObjectURL(tmp);
      }
    }
    return { picked: [], ...extra, id, file, thumb, w: img.w, h: img.h, name, count, auto };
  }, []);

  const addImages = useCallback(
    async (files: Blob[], names?: string[]) => {
      const imgs = files.filter((f) => f.type.startsWith("image/"));
      if (!imgs.length) {
        toast("Drop image files (JPG, PNG, WebP).");
        return;
      }
      setView("refs");
      setConvertState(null);
      setTextTest(null);
      setGenFull(false);
      for (let i = 0; i < imgs.length; i++) {
        try {
          const name = names?.[i] || (imgs[i] as File).name || "Pasted image";
          const ref = await storeImage(imgs[i], name);
          updateProject((p) => ({ ...p, refs: [ref, ...p.refs] }));
        } catch (e) {
          toast(errText(e) || "Couldn't read that image.");
        }
      }
    },
    [toast, updateProject, storeImage],
  );

  const pasteClipboard = useCallback(
    (loud: boolean) => {
      api
        .clipboardImage()
        .then((buf) => addImages([new Blob([buf], { type: "image/png" })], ["Pasted image"]))
        .catch((e) => loud && toast(errText(e)));
    },
    [addImages, toast],
  );

  // Ctrl+V anywhere adds the image on the clipboard (a screenshot, for example).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
        .map((it) => it.getAsFile())
        .filter((f): f is File => !!f);
      if (files.length) {
        e.preventDefault();
        addImages(files, files.map(() => "Pasted image"));
      } else if (!e.clipboardData?.getData("text")) {
        // Some screenshot tools put the image where the window can't see it: ask Windows.
        pasteClipboard(false);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addImages, pasteClipboard]);

  // Drag images anywhere onto the window.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      addImages(Array.from(e.dataTransfer?.files ?? []));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [addImages]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  if (!state) return <div className="app" />;
  const project = state.projects.find((p) => p.id === state.current) ?? state.projects[0];
  const gen = state.gen[project.id] ?? newGen();

  const sharePalette = async (p: Palette) => {
    try {
      await api.copyPng(await paletteImage(p));
      toast(`Copied "${p.name}" as an image. Paste it anywhere.`);
    } catch (e) {
      toast(errText(e));
    }
  };

  /** Switches to a project and runs `after` once that project is current. */
  const inProject = (projectId: string) => {
    if (projectId !== state.current) {
      set((s) => ({ ...s, current: projectId }));
      setTray([]);
    }
  };

  const paletteActions = (p: Palette, projectId: string, extra?: { rename?: () => void }): MenuItem[] => {
    const items: MenuItem[] = [
      { label: "Open", onClick: () => { inProject(projectId); openIn(projectId, p.id, false); } },
      { label: "Open full screen", onClick: () => { inProject(projectId); openIn(projectId, p.id, true); } },
    ];
    if (extra?.rename) items.push({ label: "Rename", onClick: extra.rename });
    if (hasProcess(p))
      items.push({ label: "To Pantone", onClick: () => { inProject(projectId); setGenFull(false); setTextTest(null); setConvertState({ pal: p, back: "palettes" }); setView("palettes"); } });
    items.push(
      { label: "Text on colour", onClick: () => { inProject(projectId); setGenFull(false); setTextTest({ colors: p.colors, name: p.name, back: "palettes" }); setView("text"); } },
      { label: "Copy values", onClick: (e) => copyText(p.colors.map((c) => colorCopy(c, state.mode)).join("\n"), e, ctx) },
      { label: "Share as image", onClick: () => sharePalette(p) },
      { label: "Export to Illustrator", onClick: () => setExporting({ palettes: [p], gradients: [] }) },
      ...(p.colors.some((c) => c.pantone || c.label)
        ? [
            {
              label: "Remove Pantone",
              onClick: () => {
                set((s) => ({ ...s, projects: s.projects.map((pr) => (pr.id === projectId ? { ...pr, palettes: pr.palettes.map((x) => (x.id === p.id ? withoutPantone(x) : x)) } : pr)) }));
                toast(`"${p.name}" has plain colours again`);
              },
            },
          ]
        : []),
      {
        label: "Duplicate",
        onClick: () => {
          const copy: Palette = { ...p, id: uid(), name: `${p.name} copy`, created: Date.now(), colors: p.colors.map((c) => ({ ...c })) };
          checkpoint("duplicate");
          set((s) => ({
            ...s,
            projects: s.projects.map((pr) => {
              if (pr.id !== projectId) return pr;
              const i = pr.palettes.findIndex((x) => x.id === p.id);
              return { ...pr, palettes: [...pr.palettes.slice(0, i + 1), copy, ...pr.palettes.slice(i + 1)] };
            }),
          }));
          toast("Duplicated", true);
        },
      },
      {
        label: "Delete",
        danger: true,
        onClick: () => {
          checkpoint("delete");
          set((s) => ({ ...s, projects: s.projects.map((pr) => (pr.id === projectId ? { ...pr, palettes: pr.palettes.filter((x) => x.id !== p.id) } : pr)) }));
          toast(`Deleted "${p.name}"`, true);
        },
      },
    );
    return items;
  };

  /** Opens a palette of any project in the generator. */
  const openIn = (projectId: string, id: string, full: boolean) => {
    const pr = state.projects.find((x) => x.id === projectId);
    const p = pr?.palettes.find((x) => x.id === id);
    if (!pr || !p) return;
    const colors = p.colors.map((c) => c.hex);
    const g = state.gen[projectId] ?? newGen();
    set((s) => ({ ...s, current: projectId, gen: { ...s.gen, [projectId]: { ...g, colors, meta: p.colors.map(metaOf), baselineMeta: p.colors.map(metaOf), locked: colors.map(() => true), editing: p.id, baseline: colors, from: "palettes" } } }));
    setConvertState(null);
    setTextTest(null);
    setView("gen");
    setGenFull(full ? "grid" : false);
  };

  const gradOf = (projectId: string) => state.grad?.[projectId] ?? newGrad();
  const setGradIn = (projectId: string, g: GradState) => set((s) => ({ ...s, grad: { ...(s.grad ?? {}), [projectId]: g } }));
  const openGradientIn = (projectId: string, id: string) => {
    const pr = state.projects.find((x) => x.id === projectId);
    const gr = pr && gradientsOf(pr).find((x) => x.id === id);
    if (!pr || !gr) return;
    const cur = gradOf(projectId);
    const g: GradState = {
      ...cur,
      type: gr.type,
      angle: gr.angle,
      blend: gr.blend,
      stops: gr.stops.map((x) => ({ ...x, locked: true })),
      editing: gr.id,
      name: undefined,
      imageId: gr.imageId,
      line: gr.line,
      from: "gradients",
      original: { type: gr.type, angle: gr.angle, blend: gr.blend, stops: gr.stops, imageId: gr.imageId, line: gr.line },
    };
    set((s) => ({ ...s, current: projectId, grad: { ...(s.grad ?? {}), [projectId]: { ...g, baseline: gradSig(g) } } }));
    setConvertState(null);
    setTextTest(null);
    setGenFull(false);
    setView("gedit");
  };
  const newGradientIn = (projectId: string, init?: Partial<GradState>) => {
    const cur = gradOf(projectId);
    const fresh = init?.stops ? null : newGrad();
    const g: GradState = {
      ...cur,
      ...(fresh ? { stops: fresh.stops, blend: fresh.blend } : {}),
      editing: undefined,
      baseline: undefined,
      original: undefined,
      name: undefined,
      imageId: undefined,
      line: undefined,
      from: "gradients",
      ...init,
    };
    set((s) => ({ ...s, current: projectId, grad: { ...(s.grad ?? {}), [projectId]: g } }));
    setConvertState(null);
    setTextTest(null);
    setGenFull(false);
    setView("gedit");
  };
  const setGradients = (projectId: string, fn: (gs: Gradient[]) => Gradient[]) =>
    set((s) => ({ ...s, projects: s.projects.map((pr) => (pr.id === projectId ? { ...pr, gradients: fn(gradientsOf(pr)) } : pr)) }));
  const gradientActions = (g: Gradient, projectId: string, extra?: { rename?: () => void }): MenuItem[] => [
    { label: "Open", onClick: () => openGradientIn(projectId, g.id) },
    ...(extra?.rename ? [{ label: "Rename", onClick: extra.rename }] : []),
    { label: "Copy CSS", onClick: (e: React.MouseEvent) => copyText(cssBlock(g), e, ctx) },
    {
      label: "Share as image",
      onClick: async () => {
        try {
          await api.copyPng(await gradientImage(g));
          toast(`Copied "${g.name}" as an image. Paste it anywhere.`);
        } catch (e) {
          toast(errText(e));
        }
      },
    },
    { label: "Export to Illustrator", onClick: () => setExporting({ palettes: [], gradients: [g] }) },
    {
      label: "Duplicate",
      onClick: () => {
        const copy: Gradient = { ...g, id: uid(), name: `${g.name} copy`, created: Date.now(), stops: g.stops.map((x) => ({ ...x })) };
        checkpoint("duplicate");
        setGradients(projectId, (gs) => {
          const i = gs.findIndex((x) => x.id === g.id);
          return [...gs.slice(0, i + 1), copy, ...gs.slice(i + 1)];
        });
        toast("Duplicated", true);
      },
    },
    {
      label: "Delete",
      danger: true,
      onClick: () => {
        checkpoint("delete");
        setGradients(projectId, (gs) => gs.filter((x) => x.id !== g.id));
        toast(`Deleted "${g.name}"`, true);
      },
    },
  ];
  const sendGradients = (ids: string[], to: string, copy: boolean) => {
    if (to === project.id) return;
    const target = state.projects.find((p) => p.id === to);
    const moving = gradientsOf(project).filter((g) => ids.includes(g.id));
    if (!target || !moving.length) return;
    const imgIds = new Set(moving.map((g) => g.imageId).filter(Boolean));
    checkpoint(copy ? "copy" : "move");
    set((s) => ({
      ...s,
      projects: s.projects.map((p) => {
        if (p.id === to) {
          const have = new Set(p.refs.map((r) => r.id));
          const refs = project.refs.filter((r) => imgIds.has(r.id) && !have.has(r.id));
          const gs = moving.map((m) => (copy ? { ...m, id: uid(), created: Date.now(), stops: m.stops.map((x) => ({ ...x })) } : m));
          return { ...p, refs: [...p.refs, ...refs], gradients: [...gradientsOf(p), ...gs] };
        }
        if (p.id === project.id && !copy) return { ...p, gradients: gradientsOf(p).filter((x) => !ids.includes(x.id)) };
        return p;
      }),
    }));
    const what = moving.length === 1 ? `"${moving[0].name}"` : `${moving.length} gradients`;
    toast(`${copy ? "Copied" : "Moved"} ${what} to ${target.name}`, true);
  };

  const newPaletteIn = (projectId: string) => {
    const g = state.gen[projectId] ?? newGen();
    const colors = generate([null, null, null, null, null], g.rule, []);
    set((s) => ({ ...s, current: projectId, gen: { ...s.gen, [projectId]: { ...g, colors, locked: colors.map(() => false), editing: undefined, baseline: undefined, from: "palettes" } } }));
    setConvertState(null);
    setTextTest(null);
    setGenFull(false);
    setView("gen");
  };

  const ctx: Ctx = {
    state,
    project,
    updateProject,
    gen,
    setGen: (g) => set((s) => ({ ...s, gen: { ...s.gen, [project.id]: g } })),
    go: (v) => {
      setConvertState(null);
      setTextTest(null);
      setGenFull(false);
      setView(v);
    },
    toast,
    checkpoint,
    note,
    mode: state.mode,
    tray,
    setTray,
    openConvert: (id) => {
      const pal = project.palettes.find((p) => p.id === id);
      if (pal) setConvertState({ pal, back: view });
    },
    convertColors: (colors, name, imageId) => {
      setGenFull(false);
      setConvertState({
        pal: { id: "unsaved", name, kind: "rgb", created: Date.now(), imageId, colors: colors.map((c) => (typeof c === "string" ? { hex: c } : { ...c })) },
        back: view,
      });
    },
    openCompare: (ids) => setCompare(ids.map((id) => project.palettes.find((p) => p.id === id)).filter((p): p is Palette => !!p)),
    openTextTest: (colors, name) => {
      setGenFull(false);
      setConvertState(null);
      setTextTest({ colors, name, back: view === "text" ? "palettes" : view });
      setView("text");
    },
    contextMenu: (e, items) => {
      e.preventDefault();
      e.stopPropagation();
      setCtxMenu({ x: e.clientX, y: e.clientY, items });
    },
    sharePalette: (p) => sharePalette(p),
    paletteActions: (p, projectId, extra) => paletteActions(p, projectId, extra),
    newPalette: () => newPaletteIn(project.id),
    focusPal,
    addImages,
    openPalette: (id, full = false) => openIn(project.id, id, full),
    sendPalettes: (ids, to, copy) => {
      if (to === project.id) return;
      const target = state.projects.find((p) => p.id === to);
      if (!target) return;
      const moving = project.palettes.filter((p) => ids.includes(p.id));
      if (!moving.length) return;
      const imgIds = new Set(moving.map((p) => p.imageId).filter(Boolean));
      checkpoint(copy ? "copy" : "move");
      set((s) => ({
        ...s,
        projects: s.projects.map((p) => {
          if (p.id === to) {
            // Bring along the reference images the palettes came from, so "where it came from" still works.
            const have = new Set(p.refs.map((r) => r.id));
            const refs = project.refs.filter((r) => imgIds.has(r.id) && !have.has(r.id));
            const pals = moving.map((m) => (copy ? { ...m, id: uid(), created: Date.now(), colors: m.colors.map((c) => ({ ...c })) } : m));
            return { ...p, refs: [...p.refs, ...refs], palettes: [...p.palettes, ...pals] };
          }
          if (p.id === project.id && !copy) return { ...p, palettes: p.palettes.filter((x) => !ids.includes(x.id)) };
          return p;
        }),
      }));
      const what = moving.length === 1 ? `"${moving[0].name}"` : `${moving.length} palettes`;
      toast(`${copy ? "Copied" : "Moved"} ${what} to ${target.name}`, true);
    },
    genFull,
    setGenFull,
    setBooks: (books) => set((s) => ({ ...s, books })),
    pasteClipboard,
    removeRef: (id) => updateProject((p) => ({ ...p, refs: p.refs.filter((x) => x.id !== id) })),
    storeImage,
    addToProject: (projectId, palettes, refs, gradients = []) =>
      set((s) => ({
        ...s,
        projects: s.projects.map((p) => (p.id === projectId ? { ...p, refs: [...refs, ...p.refs], palettes: [...p.palettes, ...palettes], gradients: [...gradientsOf(p), ...gradients] } : p)),
      })),
    exportPalettes: (ps) => setExporting({ palettes: ps, gradients: [] }),
    exportItems: (ps, gs) => setExporting({ palettes: ps, gradients: gs }),
    grad: gradOf(project.id),
    setGrad: (g) => setGradIn(project.id, g),
    openGradient: (id) => openGradientIn(project.id, id),
    newGradient: (init) => newGradientIn(project.id, init),
    gradientActions: (g, projectId, extra) => gradientActions(g, projectId, extra),
    sendGradients,
    focusGrad,
    stopPick,
    fmProjects,
    openSettings: () => setSettings(true),
    exploreDrop,
    cmykVersion,
  };

  const newProject = () => {
    const p: Project = { id: uid(), name: "New project", refs: [], palettes: [] };
    set((s) => ({ ...s, projects: [...s.projects, p], current: p.id }));
    setTray([]);
    setConvertState(null);
    setView("refs");
    setRenaming(p.id);
    setRenameText(p.name);
  };
  const commitRename = () => {
    const name = renameText.trim();
    if (renaming && name && name !== state.projects.find((p) => p.id === renaming)?.name) {
      checkpoint("rename");
      set((s) => ({ ...s, projects: s.projects.map((p) => (p.id === renaming ? { ...p, name } : p)) }));
    }
    setRenaming(null);
  };
  const deleteProject = (id: string) => {
    checkpoint("delete project");
    set((s) => {
      const projects = s.projects.filter((p) => p.id !== id);
      if (!projects.length) {
        const fresh = sampleState();
        return fresh;
      }
      const { [id]: _gone, ...gen } = s.gen;
      return { ...s, projects, gen, current: s.current === id ? projects[0].id : s.current };
    });
    toast("Project deleted", true);
  };

  const collapsed = state.collapsed ?? [];
  const editingPalette: Palette | undefined = convertState?.pal;

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <Logo size={34} />
          <span>Buni Palette</span>
        </div>
        <div className="seg" role="group" aria-label="View">
          {(
            [
              ["palettes", "Color Palettes"],
              ["grads", "Gradients"],
              ["refs", "Image Sampling"],
              ["explore", "Keywords"],
            ] as [View, string][]
          ).map(([v, label]) => (
            <button key={v} type="button" aria-pressed={!editingPalette && (view === v || (v === "grads" && view === "gedit"))} onClick={() => ctx.go(v)}>
              {label}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <label className="label" htmlFor="mode">
          Values
        </label>
        <select
          id="mode"
          className="select"
          value={state.mode}
          onChange={(e) => set((s) => ({ ...s, mode: e.target.value as ValueMode }))}
        >
          <option value="hex">HEX</option>
          <option value="rgb">RGB</option>
          <option value="lab">Lab</option>
          <option value="hsb">HSB</option>
          <option value="cmyk" title={cmykProfileName()}>CMYK</option>
        </select>
        <button
          type="button"
          className="round"
          aria-label={theme === "dark" ? "Light mode" : "Dark mode"}
          title={theme === "dark" ? "Light mode" : "Dark mode"}
          onClick={() => {
            const t = theme === "dark" ? "light" : "dark";
            setTheme(t);
            try {
              localStorage.setItem("bp.theme", t);
            } catch {
              /* remembered for this visit only */
            }
          }}
        >
          {theme === "dark" ? <IconSun /> : <IconMoon />}
        </button>
        <button type="button" className="round" aria-label="Settings" title="Settings" onClick={() => setSettings(true)}>
          <IconGear />
        </button>
      </header>

      <div className="body">
        <nav className="side" aria-label="Projects">
          <div className="colls">
            <div className="colls-head">
              <h2>Projects</h2>
              <button type="button" className="icon-btn" aria-label="New project" title="New project" onClick={newProject}>
                <IconPlus />
              </button>
            </div>
            {state.projects.map((p) =>
              renaming === p.id ? (
                <input
                  key={p.id}
                  id={`rename-${p.id}`}
                  className="rename"
                  autoFocus
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                />
              ) : (
                <div
                  key={p.id}
                  className={`coll${dropOn === p.id ? " drop" : p.id === project.id ? " picked" : ""}`}
                  onDragOver={(e) => {
                    const types = Array.from(e.dataTransfer.types);
                    if (types.includes("application/x-bp-explore")) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "copy";
                      if (dropOn !== p.id) setDropOn(p.id);
                      return;
                    }
                    if (p.id === project.id || !(types.includes("application/x-bp-palettes") || types.includes("application/x-bp-gradients"))) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = e.ctrlKey || e.metaKey ? "copy" : "move";
                    if (dropOn !== p.id) setDropOn(p.id);
                  }}
                  onDragLeave={() => setDropOn((d) => (d === p.id ? null : d))}
                  onContextMenu={(e) =>
                    ctx.contextMenu(e, [
                      { label: "Rename", onClick: () => { setRenaming(p.id); setRenameText(p.name); } },
                      { label: "New palette", onClick: () => newPaletteIn(p.id) },
                      { label: "New gradient", onClick: () => newGradientIn(p.id) },
                      { label: collapsed.includes(p.id) ? "Show palettes and gradients" : "Hide palettes and gradients", onClick: () => set((s) => { const c = s.collapsed ?? []; return { ...s, collapsed: c.includes(p.id) ? c.filter((x) => x !== p.id) : [...c, p.id] }; }) },
                      { label: "Delete project", danger: true, onClick: () => deleteProject(p.id) },
                    ])
                  }
                  onDrop={(e) => {
                    const raw = e.dataTransfer.getData("application/x-bp-palettes");
                    setDropOn(null);
                    if (e.dataTransfer.types.includes("application/x-bp-explore")) {
                      e.preventDefault();
                      exploreDrop.current?.(p.id);
                      return;
                    }
                    const rawG = e.dataTransfer.getData("application/x-bp-gradients");
                    if (rawG && p.id !== project.id) {
                      e.preventDefault();
                      sendGradients(JSON.parse(rawG) as string[], p.id, e.ctrlKey || e.metaKey);
                      return;
                    }
                    if (!raw || p.id === project.id) return;
                    e.preventDefault();
                    ctx.sendPalettes(JSON.parse(raw) as string[], p.id, e.ctrlKey || e.metaKey);
                  }}
                >
                  <button
                    type="button"
                    className="chev"
                    aria-label={collapsed.includes(p.id) ? `Show ${p.name} palettes and gradients` : `Hide ${p.name} palettes and gradients`}
                    aria-expanded={!collapsed.includes(p.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      set((s) => {
                        const c = s.collapsed ?? [];
                        return { ...s, collapsed: c.includes(p.id) ? c.filter((x) => x !== p.id) : [...c, p.id] };
                      });
                    }}
                  >
                    <IconChevron size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      set((s) => ({ ...s, current: p.id }));
                      setTray([]);
                      setConvertState(null);
                      setTextTest(null);
                      setGenFull(false);
                      setView("palettes");
                    }}
                    onDoubleClick={() => {
                      setRenaming(p.id);
                      setRenameText(p.name);
                    }}
                  >
                    <span className="name">{p.name}</span>
                    <span className="count" title={`${p.palettes.length} palettes, ${gradientsOf(p).length} gradients`}>{p.palettes.length + gradientsOf(p).length}</span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`${p.name} options`}
                    aria-expanded={menu === p.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenu(menu === p.id ? null : p.id);
                    }}
                  >
                    <IconDots />
                  </button>
                  {menu === p.id && (
                    <div className="menu" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => {
                          setMenu(null);
                          setRenaming(p.id);
                          setRenameText(p.name);
                        }}
                      >
                        <IconEdit size={16} /> Rename
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => {
                          setMenu(null);
                          deleteProject(p.id);
                        }}
                      >
                        <IconTrash size={16} /> Delete project
                      </button>
                    </div>
                  )}
                </div>
              ),
            ).flatMap((el, i) => {
              const p = state.projects[i];
              const grads = gradientsOf(p);
              if (collapsed.includes(p.id) || (!p.palettes.length && !grads.length) || renaming === p.id) return [el];
              const closed = state.closedSections ?? [];
              const toggle = (key: string) => set((s) => { const c = s.closedSections ?? []; return { ...s, closedSections: c.includes(key) ? c.filter((x) => x !== key) : [...c, key] }; });
              // While a gradient is being edited, colours in the palettes below are picked one by one.
              const picking = view === "gedit" && p.id === project.id;
              const section = (key: string, label: string, count: number, body: React.ReactNode) => (
                <div key={key} className="side-sec">
                  <button type="button" className="sec-head" aria-expanded={!closed.includes(key)} onClick={() => toggle(key)}>
                    <IconChevron size={12} />
                    <span>{label}</span>
                    <span className="count">{count}</span>
                  </button>
                  {!closed.includes(key) && body}
                </div>
              );
              return [
                el,
                <div key={`${p.id}-minis`} className="side-secs">
                  {p.palettes.length > 0 &&
                    section(
                      `${p.id}:p`,
                      "Palettes",
                      p.palettes.length,
                      <div className={`minis${picking ? " picking" : ""}`}>
                        {p.palettes.map((pal) => (
                          <button
                            key={pal.id}
                            type="button"
                            className={`mini${p.id === project.id && focusPal === pal.id && view === "palettes" ? " on" : ""}`}
                            title={picking ? `${pal.name}: click a colour to put it in the selected stop` : pal.name}
                            aria-label={`${pal.name} in ${p.name}`}
                            onContextMenu={(e) => ctx.contextMenu(e, paletteActions(pal, p.id))}
                            onDoubleClick={() => !picking && openIn(p.id, pal.id, false)}
                            onClick={(e) => {
                              if (picking) {
                                // The colour under the pointer goes into the gradient.
                                const r = e.currentTarget.getBoundingClientRect();
                                const k = Math.min(pal.colors.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * pal.colors.length)));
                                stopPick.current?.(pal.colors[k].hex);
                                return;
                              }
                              set((s) => ({ ...s, current: p.id }));
                              setTray([]);
                              setConvertState(null);
                              setGenFull(false);
                              setFocusPal(pal.id);
                              setView("palettes");
                            }}
                          >
                            {pal.colors.map((c, j) => (
                              <i key={j} style={{ background: c.hex }} title={picking ? c.hex : undefined} />
                            ))}
                          </button>
                        ))}
                      </div>,
                    )}
                  {grads.length > 0 &&
                    section(
                      `${p.id}:g`,
                      "Gradients",
                      grads.length,
                      <div className="minis">
                        {grads.map((g) => (
                          <button
                            key={g.id}
                            type="button"
                            className={`mini gmini${p.id === project.id && ((focusGrad === g.id && view === "grads") || (view === "gedit" && ctx.grad.editing === g.id)) ? " on" : ""}`}
                            style={{ background: gradCss({ ...g, type: "linear", angle: 90 }) }}
                            title={g.name}
                            aria-label={`${g.name} in ${p.name}`}
                            onContextMenu={(e) => ctx.contextMenu(e, gradientActions(g, p.id))}
                            onDoubleClick={() => openGradientIn(p.id, g.id)}
                            onClick={() => {
                              set((s) => ({ ...s, current: p.id }));
                              setConvertState(null);
                              setTextTest(null);
                              setGenFull(false);
                              setFocusGrad(g.id);
                              setView("grads");
                            }}
                          />
                        ))}
                      </div>,
                    )}
                </div>,
              ];
            })}
          </div>
          <div className="side-foot">
            <p className="side-note">
              Drop images anywhere, or press <span className="kbd">Ctrl</span> + <span className="kbd">V</span> to add a screenshot to this
              project. Drag palettes or gradients onto a project to move them; hold <span className="kbd">Ctrl</span> to copy.
            </p>
            <a className="credit" href="https://andersonbunidesign.com" target="_blank" rel="noreferrer">
              Vibe coded by Anderson Santos · Version {VERSION}
            </a>
          </div>
        </nav>

        <main className="main" key={project.id + (convertState ? "c" : "") + view + (view === "palettes" ? focusPal ?? "" : view === "grads" ? focusGrad ?? "" : "")}>
          {editingPalette ? (
            <Convert
              ctx={ctx}
              palette={editingPalette}
              onCancel={() => setConvertState(null)}
              onDone={() => {
                setConvertState(null);
                setView("palettes");
              }}
            />
          ) : view === "text" && textTest ? (
            <TextTest
              ctx={ctx}
              colors={textTest.colors}
              name={textTest.name}
              backLabel={textTest.back === "gen" ? "Palette" : textTest.back === "refs" ? "Image Sampling" : textTest.back === "explore" ? "Keywords" : "Color Palettes"}
              onBack={() => {
                setView(textTest.back === "text" ? "palettes" : textTest.back);
                setTextTest(null);
              }}
            />
          ) : view === "refs" ? (
            <References ctx={ctx} />
          ) : view === "explore" ? (
            <Explore ctx={ctx} />
          ) : view === "gen" ? (
            <Generator ctx={ctx} />
          ) : view === "grads" ? (
            <Gradients ctx={ctx} />
          ) : view === "gedit" ? (
            <GradientEditor ctx={ctx} />
          ) : (
            <Palettes ctx={ctx} />
          )}
        </main>
      </div>

      {settings && (
        <Settings
          state={state}
          onClose={() => setSettings(false)}
          onClear={async () => {
            set((s) => ({ ...s, projects: s.projects.map((p) => ({ ...p, refs: [] })) }));
            setTray([]);
            await flushState();
            await api.clearImages([]).catch(() => {});
            toast("Reference images cleared. Your palettes are untouched.");
          }}
          onCmykChange={loadCmyk}
          onFontsChange={loadFonts}
        />
      )}
      {compare && <Compare ctx={ctx} palettes={compare} onClose={() => setCompare(null)} />}
      {ctxMenu && <ContextMenu {...ctxMenu} onClose={() => setCtxMenu(null)} />}
      {exporting && <ExportDialog ctx={ctx} palettes={exporting.palettes} gradients={exporting.gradients} onClose={() => setExporting(null)} />}
      {dragging && (
        <div className="drop-overlay">
          <div>Drop images to add them as references</div>
        </div>
      )}
      {toastMsg && (
        <div className="toast" role="status">
          {toastMsg.text}
          {toastMsg.undo && (
            <button
              type="button"
              className="toast-undo"
              onClick={() => {
                setToastMsg(null);
                undo();
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
      {cursorNote && (
        <div className="cursor-note" style={{ left: cursorNote.x, top: cursorNote.y }}>
          {cursorNote.text}
        </div>
      )}
    </div>
  );
}

function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPos({ left: Math.min(x, window.innerWidth - el.offsetWidth - 8), top: Math.min(y, window.innerHeight - el.offsetHeight - 8) });
  }, [x, y]);
  useEffect(() => {
    const close = (e: Event) => {
      if (e.type === "keydown" && (e as KeyboardEvent).key !== "Escape") return;
      if (e.type === "pointerdown" && ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="menu ctx-menu" role="menu" style={pos} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          className={it.danger ? "danger" : undefined}
          disabled={it.disabled}
          onClick={(e) => {
            onClose();
            it.onClick(e);
          }}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  );
}
