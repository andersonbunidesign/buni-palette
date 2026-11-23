// Calls into the desktop side (Rust). Everything that touches files, the clipboard,
// Illustrator, colour profiles or the internet goes through here.
import { invoke, convertFileSrc } from "@tauri-apps/api/core";

export interface Lut { name: string; rgbSteps: number; cmykSteps: number; toCmyk: string; toRgb: string }
export interface ProfileInfo { name: string; path: string | null }
export interface Settings {
  cmykChoice: string | null;
  cmykName: string;
  cmykPath: string | null;
  profiles: ProfileInfo[];
  unsplashKey: string;
  fontManager: boolean;
  fontManagerFound: boolean;
  dataFolder: string;
}
export interface FmFont { id: string; name: string; family: string; style: string; weight: number; italic: boolean; path: string; index: number }
export interface FmProject { name: string; fonts: FmFont[] }
export interface ExportColor { hex: string; pantone?: string; label?: string }
export interface ExportStop { hex: string; pos: number }
export interface ExportGradient { name: string; radial: boolean; angle: number; stops: ExportStop[]; key: ExportStop[] }

let imagesDir = "";
export const setImagesDir = (d: string) => (imagesDir = d);
/** URL the window can show for a stored image file. */
export const imageUrl = (name: string) => convertFileSrc(`${imagesDir}${imagesDir.includes("\\") ? "\\" : "/"}${name}`);
export const fileUrl = (path: string) => convertFileSrc(path);

const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

export const api = {
  getState: () => invoke<{ data: string | null; version: string; imagesDir: string; root: string }>("get_state"),
  saveData: (json: string) => invoke<void>("save_data", { json }),
  saveImage: async (name: string, blob: Blob) => invoke<void>("save_image", await bytes(blob), { headers: { "x-name": name } }),
  readImage: (name: string) => invoke<ArrayBuffer>("read_image", { name }),
  deleteImages: (names: string[]) => invoke<void>("delete_images", { names }),
  imagesSize: () => invoke<{ files: number; bytes: number }>("images_size"),
  clearImages: (keep: string[]) => invoke<void>("clear_images", { keep }),
  clipboardImage: () => invoke<ArrayBuffer>("clipboard_image"),
  copyPng: async (blob: Blob) => invoke<void>("copy_png", await bytes(blob)),
  copyText: (text: string) => invoke<void>("copy_text", { text }),
  getSettings: () => invoke<Settings>("get_settings"),
  setSettings: (patch: { cmykProfile?: string | null; unsplashKey?: string; fontManager?: boolean }) => invoke<Settings>("set_settings", { patch }),
  cmykLut: () => invoke<Lut>("cmyk_lut"),
  exportIllustrator: (palettes: { name: string; colors: ExportColor[] }[], gradients: ExportGradient[], mode: "rgb" | "cmyk", path: string) =>
    invoke<{ path: string }>("export_illustrator", { palettes, gradients, mode, path }),
  fontManagerProjects: () => invoke<FmProject[] | null>("font_manager_projects"),
  unsplashSearch: (query: string, page: number) => invoke<UnsplashPage>("unsplash_search", { query, page }),
  unsplashImage: (url: string) => invoke<ArrayBuffer>("unsplash_image", { url }),
  unsplashTrack: (location: string) => invoke<void>("unsplash_track", { location }),
};

export interface UnsplashPhoto {
  id: string;
  width: number;
  height: number;
  description: string | null;
  alt_description: string | null;
  urls: { small: string; regular: string; thumb: string };
  links: { html: string; download_location: string };
  user: { name: string; links: { html: string } };
}
export interface UnsplashPage { total: number; total_pages: number; results: UnsplashPhoto[] }

/** Error text from a failed call. */
export const errText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "Something went wrong.");
