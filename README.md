# Buni Palette

Per-project colour palettes and gradients for packaging and brand work: collect references, generate harmonies
and gradients, find palettes by keyword, match to Pantone, test text on colour, and export to Illustrator.

Windows app built with Tauri 2, React and TypeScript, like Buni Font Manager. Every push to `main`
builds the installer on GitHub and publishes it on the Releases page (download the `-setup.exe`).

## Where things are

- `src/` — the interface (React + TypeScript), grown from the web prototype.
- `src-tauri/` — the desktop side: files, clipboard, settings, Unsplash, Illustrator.
- `crates/bp-core/` — colour profiles (CMYK with Little CMS), the Illustrator script and the
  Buni Font Manager link, with tests (`cargo test -p bp-core`).
- `prototype/` — the web prototype (v0.6), kept for reference. `HANDOFF.md` has the decisions.

## Your data

Everything lives in `Buni Palette` in your user folder: `palettes.json` (projects and palettes),
`settings.json`, and `Images/` (reference images and their thumbnails). Settings can clear the images.

## Notes

- **CMYK** uses Adobe's Coated FOGRA39 when it's on the computer (it comes with Illustrator), otherwise
  the FOGRA39L Coated profile built into the app (from colord, made with ArgyllCMS, licence CC0).
  Any other CMYK profile can be picked in Settings.
- **Pantone** values are community approximations (MIT: pantoner, color2library), not official data:
  confirm every colour in the printed guide.
- **Explore** needs a free Unsplash access key (unsplash.com/developers), pasted in Settings.
- **Export to Illustrator** runs a script in Illustrator, which makes the `.ai` itself. If Illustrator
  can't be driven, the script is saved next to where the file should go, to run with File > Scripts > Other Script.

Vibe coded by Anderson Santos · [andersonbunidesign.com](https://andersonbunidesign.com)

## Blender add-on

`blender/buni_palette_blender.py` puts a palette into Blender's Shader Editor as a frame with one RGB node per colour.
Install it in Blender under Edit > Preferences > Add-ons > Install from Disk, then use the Buni Palette tab in the
Shader Editor sidebar (N).
