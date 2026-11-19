mod platform;

use bp_core::illustrator::{DocMode, ExportPalette};
use bp_core::{fontmanager, icc, illustrator, store};
use serde::{Deserialize, Serialize};
use std::io::Read as _;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, State};

/// Where everything lives: `<home>/Buni Palette`.
struct Paths {
    root: PathBuf,
}

impl Paths {
    fn data_file(&self) -> PathBuf {
        self.root.join("palettes.json")
    }
    fn settings_file(&self) -> PathBuf {
        self.root.join("settings.json")
    }
    fn images_dir(&self) -> PathBuf {
        self.root.join("Images")
    }
    fn work_dir(&self) -> PathBuf {
        self.root.join(".work")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    /// Path of the CMYK profile; "builtin" for the one in the app; None picks Adobe's
    /// Coated FOGRA39 when it's installed, otherwise the built-in one.
    #[serde(default)]
    cmyk_profile: Option<String>,
    #[serde(default)]
    unsplash_key: Option<String>,
    /// Use Buni Font Manager projects in Text on colour, when it's installed.
    #[serde(default = "yes")]
    font_manager: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self { cmyk_profile: None, unsplash_key: None, font_manager: true }
    }
}

fn yes() -> bool {
    true
}

struct AppData {
    paths: Paths,
    settings: Mutex<Settings>,
    /// Profiles found on this computer (looked for once).
    profiles: Mutex<Option<Vec<icc::ProfileInfo>>>,
}

fn err<E: std::fmt::Display>(what: &str) -> impl Fn(E) -> String + '_ {
    move |e| format!("{what}: {e}")
}

fn found_profiles(data: &AppData) -> Vec<icc::ProfileInfo> {
    let mut p = data.profiles.lock().unwrap();
    if p.is_none() {
        *p = Some(icc::find_profiles(&icc::standard_dirs()));
    }
    p.clone().unwrap_or_default()
}

/// The profile in use: (bytes, name, path or None for the built-in one).
fn active_profile(data: &AppData) -> (Vec<u8>, String, Option<String>) {
    let chosen = data.settings.lock().unwrap().cmyk_profile.clone();
    let path = match chosen.as_deref() {
        Some("builtin") => None,
        Some(p) => Some(p.to_string()),
        None => icc::adobe_fogra39(&found_profiles(data)).and_then(|p| p.path.clone()),
    };
    if let Some(p) = &path {
        if let Ok((bytes, name)) = icc::load(Some(std::path::Path::new(p))) {
            return (bytes, name, Some(p.clone()));
        }
    }
    (icc::BUILTIN.to_vec(), icc::BUILTIN_NAME.to_string(), None)
}

fn save_settings(data: &AppData, s: &Settings) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(s).map_err(|e| e.to_string())?;
    store::write_atomic(&data.paths.settings_file(), &bytes).map_err(err("Could not save the settings"))
}

fn font_manager_root() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join("Buni Font Manager"))
}

// ---------- data ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StateDto {
    /// The saved projects and palettes (JSON written by the interface), None the first time.
    data: Option<String>,
    version: String,
    images_dir: String,
    root: String,
}

#[tauri::command]
fn get_state(app: AppHandle, data: State<AppData>) -> StateDto {
    StateDto {
        data: std::fs::read_to_string(data.paths.data_file()).ok(),
        version: app.package_info().version.to_string(),
        images_dir: data.paths.images_dir().to_string_lossy().to_string(),
        root: data.paths.root.to_string_lossy().to_string(),
    }
}

#[tauri::command]
fn save_data(data: State<AppData>, json: String) -> Result<(), String> {
    store::write_atomic(&data.paths.data_file(), json.as_bytes()).map_err(err("Could not save"))
}

// ---------- reference images ----------

fn header<'a>(req: &'a Request<'_>, name: &str) -> Option<&'a str> {
    req.headers().get(name).and_then(|v| v.to_str().ok())
}

/// Stores one image file (the bytes are the request body; the name comes in the x-name header).
#[tauri::command]
fn save_image(data: State<AppData>, request: Request<'_>) -> Result<(), String> {
    let name = header(&request, "x-name").ok_or("No file name")?.to_string();
    if !store::safe_name(&name) {
        return Err("Bad file name".into());
    }
    let InvokeBody::Raw(bytes) = request.body() else { return Err("No image".into()) };
    store::write_atomic(&data.paths.images_dir().join(name), bytes).map_err(err("Could not save the image"))
}

#[tauri::command]
fn read_image(data: State<AppData>, name: String) -> Result<Response, String> {
    if !store::safe_name(&name) {
        return Err("Bad file name".into());
    }
    std::fs::read(data.paths.images_dir().join(name)).map(Response::new).map_err(err("Could not read the image"))
}

#[tauri::command]
fn delete_images(data: State<AppData>, names: Vec<String>) {
    for n in names.iter().filter(|n| store::safe_name(n)) {
        let _ = std::fs::remove_file(data.paths.images_dir().join(n));
    }
}

#[derive(Serialize)]
struct FolderSize {
    files: usize,
    bytes: u64,
}

#[tauri::command]
fn images_size(data: State<AppData>) -> FolderSize {
    let mut s = FolderSize { files: 0, bytes: 0 };
    if let Ok(rd) = std::fs::read_dir(data.paths.images_dir()) {
        for e in rd.flatten() {
            if let Ok(m) = e.metadata() {
                if m.is_file() {
                    s.files += 1;
                    s.bytes += m.len();
                }
            }
        }
    }
    s
}

/// Deletes every stored reference image except `keep` (images that saved palettes still point to
/// are not kept: the interface clears the references first).
#[tauri::command]
fn clear_images(data: State<AppData>, keep: Vec<String>) -> Result<(), String> {
    let Ok(rd) = std::fs::read_dir(data.paths.images_dir()) else { return Ok(()) };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if !keep.contains(&name) {
            std::fs::remove_file(e.path()).map_err(err("Could not delete an image"))?;
        }
    }
    Ok(())
}

// ---------- clipboard ----------

/// The image on the clipboard (a screenshot, for example) as PNG bytes.
#[tauri::command]
async fn clipboard_image() -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut cb = arboard::Clipboard::new().map_err(err("The clipboard isn't available"))?;
        let img = cb.get_image().map_err(|_| "There's no image on the clipboard. Take a screenshot first.".to_string())?;
        let rgba = image::RgbaImage::from_raw(img.width as u32, img.height as u32, img.bytes.into_owned()).ok_or("The clipboard image is damaged")?;
        let mut out = std::io::Cursor::new(Vec::new());
        rgba.write_to(&mut out, image::ImageFormat::Png).map_err(err("Could not read the clipboard image"))?;
        Ok(Response::new(out.into_inner()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Puts a PNG (the request body) on the clipboard as an image.
#[tauri::command]
async fn copy_png(request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("No image".into()) };
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let img = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png).map_err(err("Could not read the image"))?.to_rgba8();
        let (w, h) = img.dimensions();
        let mut cb = arboard::Clipboard::new().map_err(err("The clipboard isn't available"))?;
        cb.set_image(arboard::ImageData { width: w as usize, height: h as usize, bytes: img.into_raw().into() }).map_err(err("Could not copy the image"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn copy_text(text: String) -> Result<(), String> {
    arboard::Clipboard::new().and_then(|mut c| c.set_text(text)).map_err(err("Could not copy"))
}

// ---------- settings and CMYK ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsDto {
    /// What was chosen: a path, "builtin", or None for automatic.
    cmyk_choice: Option<String>,
    cmyk_name: String,
    cmyk_path: Option<String>,
    profiles: Vec<icc::ProfileInfo>,
    unsplash_key: String,
    font_manager: bool,
    font_manager_found: bool,
    data_folder: String,
}

fn settings_dto(data: &AppData) -> SettingsDto {
    let (_, name, path) = active_profile(data);
    let s = data.settings.lock().unwrap().clone();
    SettingsDto {
        cmyk_choice: s.cmyk_profile,
        cmyk_name: name,
        cmyk_path: path,
        profiles: found_profiles(data),
        unsplash_key: s.unsplash_key.unwrap_or_default(),
        font_manager: s.font_manager,
        font_manager_found: font_manager_root().map(|r| r.join("library.json").exists()).unwrap_or(false),
        data_folder: data.paths.root.to_string_lossy().to_string(),
    }
}

#[tauri::command]
async fn get_settings(app: AppHandle) -> SettingsDto {
    tauri::async_runtime::spawn_blocking(move || settings_dto(&app.state::<AppData>())).await.expect("settings")
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SettingsPatch {
    /// Some(None) = automatic.
    #[serde(default, deserialize_with = "serde_with_none::deserialize")]
    cmyk_profile: Option<Option<String>>,
    #[serde(default)]
    unsplash_key: Option<String>,
    #[serde(default)]
    font_manager: Option<bool>,
}

/// `Option<Option<T>>` that tells a missing field (None) from null (Some(None)).
mod serde_with_none {
    use serde::{Deserialize, Deserializer};
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Option<String>>, D::Error> {
        Ok(Some(Option::<String>::deserialize(d)?))
    }
}

#[tauri::command]
async fn set_settings(app: AppHandle, patch: SettingsPatch) -> Result<SettingsDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let data = app.state::<AppData>();
        if let Some(Some(p)) = &patch.cmyk_profile {
            if p != "builtin" {
                icc::load(Some(std::path::Path::new(p)))?;
            }
        }
        {
            let mut s = data.settings.lock().unwrap();
            if let Some(c) = patch.cmyk_profile {
                s.cmyk_profile = c;
            }
            if let Some(k) = patch.unsplash_key {
                let k = k.trim().to_string();
                s.unsplash_key = if k.is_empty() { None } else { Some(k) };
            }
            if let Some(f) = patch.font_manager {
                s.font_manager = f;
            }
            let copy = s.clone();
            drop(s);
            save_settings(&data, &copy)?;
        }
        Ok(settings_dto(&data))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Lookup tables for the CMYK values the interface shows and reads.
#[tauri::command]
async fn cmyk_lut(app: AppHandle) -> Result<icc::Lut, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let data = app.state::<AppData>();
        let (bytes, name, _) = active_profile(&data);
        icc::lut(&bytes, &name)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------- Illustrator ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportInfo {
    path: String,
}

/// Writes the palettes to an Illustrator file, built by Illustrator itself.
#[tauri::command]
async fn export_illustrator(app: AppHandle, palettes: Vec<ExportPalette>, mode: DocMode, path: String) -> Result<ExportInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let data = app.state::<AppData>();
        let (bytes, name, _) = active_profile(&data);
        let conv = icc::Converter::new(&bytes)?;
        let js = illustrator::script(&palettes, mode, &path, &name, &|rgb| conv.cmyk(rgb))?;
        let work = data.paths.work_dir();
        std::fs::create_dir_all(&work).map_err(err("Could not prepare the export"))?;
        let script = work.join("export-palettes.jsx");
        std::fs::write(&script, &js).map_err(err("Could not write the script"))?;
        match platform::run_illustrator_script(&script) {
            Ok(out) if out.starts_with("OK") => Ok(ExportInfo { path }),
            result => {
                // Keep the script next to where the .ai should have gone, to run by hand.
                let keep = PathBuf::from(&path).with_extension("jsx");
                let _ = std::fs::copy(&script, &keep);
                let why = match result {
                    Ok(out) => out.trim_start_matches("ERROR:").trim().to_string(),
                    Err(e) => e,
                };
                Err(format!(
                    "Illustrator couldn't make the file ({why}). The script was saved as {}: in Illustrator, choose File > Scripts > Other Script and pick it.",
                    keep.display()
                ))
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------- Buni Font Manager ----------

/// Font Manager projects and their fonts, when the link is on and the app is installed.
#[tauri::command]
async fn font_manager_projects(app: AppHandle) -> Option<Vec<fontmanager::FmProject>> {
    tauri::async_runtime::spawn_blocking(move || {
        let data = app.state::<AppData>();
        if !data.settings.lock().unwrap().font_manager {
            return None;
        }
        let list = fontmanager::read(&font_manager_root()?)?;
        // Let the interface load these font files.
        for f in list.iter().flat_map(|p| &p.fonts) {
            let _ = app.asset_protocol_scope().allow_file(&f.path);
        }
        Some(list)
    })
    .await
    .ok()
    .flatten()
}

// ---------- Unsplash (Explore) ----------

fn unsplash_key(data: &AppData) -> Result<String, String> {
    data.settings.lock().unwrap().unsplash_key.clone().ok_or_else(|| "Add your Unsplash access key in Settings first.".to_string())
}

fn unsplash_get(url: &str, key: &str) -> Result<ureq::Response, String> {
    ureq::get(url)
        .set("Authorization", &format!("Client-ID {key}"))
        .set("Accept-Version", "v1")
        .timeout(std::time::Duration::from_secs(25))
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(401, _) => "Unsplash didn't accept the access key. Check it in Settings.".to_string(),
            ureq::Error::Status(403, _) => "Unsplash's hourly limit was reached. Try again later.".to_string(),
            ureq::Error::Status(code, _) => format!("Unsplash answered with an error ({code})."),
            ureq::Error::Transport(_) => "Couldn't reach Unsplash. Check the internet connection.".to_string(),
        })
}

fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

/// One page of photos for a keyword, as Unsplash sends it.
#[tauri::command]
async fn unsplash_search(app: AppHandle, query: String, page: u32) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let key = unsplash_key(&app.state::<AppData>())?;
        let url = format!("https://api.unsplash.com/search/photos?query={}&page={}&per_page=24&content_filter=high", encode(query.trim()), page.max(1));
        unsplash_get(&url, &key)?.into_json::<serde_json::Value>().map_err(err("Unsplash sent something unexpected"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The bytes of an Unsplash photo, so its colours can be read.
#[tauri::command]
async fn unsplash_image(url: String) -> Result<Response, String> {
    if !url.starts_with("https://images.unsplash.com/") {
        return Err("Not an Unsplash image".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let r = ureq::get(&url).timeout(std::time::Duration::from_secs(30)).call().map_err(|_| "Couldn't load the photo".to_string())?;
        let mut bytes = Vec::new();
        std::io::Read::read_to_end(&mut r.into_reader().take(25_000_000), &mut bytes).map_err(|_| "Couldn't load the photo".to_string())?;
        Ok(Response::new(bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Tells Unsplash a photo was used (their rules ask for it when a photo is saved).
#[tauri::command]
async fn unsplash_track(app: AppHandle, location: String) -> Result<(), String> {
    if !location.starts_with("https://api.unsplash.com/") {
        return Ok(());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let key = unsplash_key(&app.state::<AppData>())?;
        unsplash_get(&location, &key).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn run() {
    let root = dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join("Buni Palette");
    let paths = Paths { root };
    let _ = std::fs::create_dir_all(paths.images_dir());
    let settings: Settings = std::fs::read(paths.settings_file()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppData { paths, settings: Mutex::new(settings), profiles: Mutex::new(None) })
        .invoke_handler(tauri::generate_handler![
            get_state,
            save_data,
            save_image,
            read_image,
            delete_images,
            images_size,
            clear_images,
            clipboard_image,
            copy_png,
            copy_text,
            get_settings,
            set_settings,
            cmyk_lut,
            export_illustrator,
            font_manager_projects,
            unsplash_search,
            unsplash_image,
            unsplash_track
        ])
        .setup(|app| {
            // Look for colour profiles in the background, so Settings opens quickly.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                found_profiles(&handle.state::<AppData>());
            });
            show_main(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Buni Palette");
}
