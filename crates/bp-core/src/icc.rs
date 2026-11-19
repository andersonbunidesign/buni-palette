//! CMYK through an ICC profile (Coated FOGRA39 by default), with Little CMS.
//!
//! The interface converts colours constantly (sliders, typed values), so instead of asking
//! for every colour it gets two lookup tables once and interpolates between their points:
//! RGB to CMYK on a 33-step cube and CMYK to RGB on a 17-step grid.

use base64::Engine;
use lcms2::{ColorSpaceSignature, Flags, InfoType, Intent, Locale, PixelFormat, Profile, ProfileClassSignature, Transform};
use serde::Serialize;
use std::path::{Path, PathBuf};

/// "FOGRA39L Coated" from colord, made with ArgyllCMS (licence CC0). Used when Adobe's
/// Coated FOGRA39 isn't on the computer.
pub const BUILTIN: &[u8] = include_bytes!("../profiles/FOGRA39L_coated.icc");
pub const BUILTIN_NAME: &str = "Coated FOGRA39 (built in)";

pub const RGB_STEPS: usize = 33;
pub const CMYK_STEPS: usize = 17;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileInfo {
    pub name: String,
    /// None for the built-in profile.
    pub path: Option<String>,
}

/// The profile's description, if the bytes are a CMYK profile that can print (output class).
pub fn describe(bytes: &[u8]) -> Result<String, String> {
    let p = Profile::new_icc(bytes).map_err(|_| "This file isn't an ICC profile".to_string())?;
    if p.color_space() != ColorSpaceSignature::CmykData {
        return Err("This isn't a CMYK profile".into());
    }
    if p.device_class() != ProfileClassSignature::OutputClass {
        return Err("This CMYK profile can't be used for printing".into());
    }
    Ok(p.info(InfoType::Description, Locale::none()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).unwrap_or_else(|| "CMYK profile".into()))
}

/// Where Windows and Adobe keep colour profiles.
pub fn standard_dirs() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(w) = std::env::var_os("WINDIR") {
        v.push(PathBuf::from(w).join("System32").join("spool").join("drivers").join("color"));
    }
    for var in ["CommonProgramFiles(x86)", "CommonProgramFiles"] {
        if let Some(c) = std::env::var_os(var) {
            let base = PathBuf::from(c).join("Adobe").join("Color").join("Profiles");
            v.push(base.join("Recommended"));
            v.push(base);
        }
    }
    v.push(PathBuf::from("/Library/ColorSync/Profiles"));
    v.push(PathBuf::from("/Library/Application Support/Adobe/Color/Profiles/Recommended"));
    v.push(PathBuf::from("/usr/share/color/icc"));
    v
}

/// Every CMYK printing profile in `dirs` (not in sub-folders), sorted by name, duplicates once.
pub fn find_profiles(dirs: &[PathBuf]) -> Vec<ProfileInfo> {
    let mut out: Vec<ProfileInfo> = Vec::new();
    for d in dirs {
        let Ok(rd) = std::fs::read_dir(d) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            let ext = p.extension().map(|x| x.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
            if ext != "icc" && ext != "icm" {
                continue;
            }
            // Printer profiles are well under 10 MB; skip anything odd.
            if e.metadata().map(|m| m.len() > 12_000_000).unwrap_or(true) {
                continue;
            }
            let Ok(bytes) = std::fs::read(&p) else { continue };
            if let Ok(name) = describe(&bytes) {
                if !out.iter().any(|o| o.name == name) {
                    out.push(ProfileInfo { name, path: Some(p.to_string_lossy().to_string()) });
                }
            }
        }
    }
    out.sort_by_key(|p| p.name.to_lowercase());
    out
}

/// Adobe's Coated FOGRA39, when it's installed (Illustrator uses the same one).
pub fn adobe_fogra39(found: &[ProfileInfo]) -> Option<&ProfileInfo> {
    found.iter().find(|p| {
        let n = p.name.to_lowercase();
        n.contains("coated fogra39") && !n.contains("uncoated")
    })
}

type Pair = (Transform<[u8; 3], [u16; 4]>, Transform<[u16; 4], [u8; 3]>);

fn transforms(bytes: &[u8]) -> Result<Pair, String> {
    let cmyk = Profile::new_icc(bytes).map_err(|e| format!("Could not read the profile: {e}"))?;
    let srgb = Profile::new_srgb();
    // Relative colorimetric with black point compensation, as Illustrator and Photoshop do by default.
    let to_cmyk = Transform::new_flags(&srgb, PixelFormat::RGB_8, &cmyk, PixelFormat::CMYK_16, Intent::RelativeColorimetric, Flags::BLACKPOINT_COMPENSATION)
        .map_err(|e| format!("Could not use the profile: {e}"))?;
    let to_rgb = Transform::new_flags(&cmyk, PixelFormat::CMYK_16, &srgb, PixelFormat::RGB_8, Intent::RelativeColorimetric, Flags::BLACKPOINT_COMPENSATION)
        .map_err(|e| format!("Could not use the profile: {e}"))?;
    Ok((to_cmyk, to_rgb))
}

pub struct Converter {
    to_cmyk: Transform<[u8; 3], [u16; 4]>,
    to_rgb: Transform<[u16; 4], [u8; 3]>,
}

impl Converter {
    pub fn new(bytes: &[u8]) -> Result<Self, String> {
        let (to_cmyk, to_rgb) = transforms(bytes)?;
        Ok(Self { to_cmyk, to_rgb })
    }

    /// CMYK in percent, 0–100.
    pub fn cmyk(&self, rgb: [u8; 3]) -> [f64; 4] {
        let mut out = [[0u16; 4]];
        self.to_cmyk.transform_pixels(&[rgb], &mut out);
        out[0].map(|v| v as f64 / 655.35)
    }

    pub fn rgb(&self, cmyk: [f64; 4]) -> [u8; 3] {
        let src = [cmyk.map(|v| (v.clamp(0.0, 100.0) * 655.35).round() as u16)];
        let mut out = [[0u8; 3]];
        self.to_rgb.transform_pixels(&src, &mut out);
        out[0]
    }
}

/// Lookup tables for the interface, base64 encoded.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lut {
    pub name: String,
    pub rgb_steps: usize,
    pub cmyk_steps: usize,
    /// RGB to CMYK: for r, g, b (b fastest) four little-endian u16, hundredths of a percent.
    pub to_cmyk: String,
    /// CMYK to RGB: for c, m, y, k (k fastest) three bytes.
    pub to_rgb: String,
}

pub fn lut(bytes: &[u8], name: &str) -> Result<Lut, String> {
    let (to_cmyk, to_rgb) = transforms(bytes)?;
    let step = |i: usize, n: usize| ((i as f64) * 255.0 / ((n - 1) as f64)).round() as u8;
    let mut src = Vec::with_capacity(RGB_STEPS.pow(3));
    for r in 0..RGB_STEPS {
        for g in 0..RGB_STEPS {
            for b in 0..RGB_STEPS {
                src.push([step(r, RGB_STEPS), step(g, RGB_STEPS), step(b, RGB_STEPS)]);
            }
        }
    }
    let mut dst = vec![[0u16; 4]; src.len()];
    to_cmyk.transform_pixels(&src, &mut dst);
    let mut a = Vec::with_capacity(dst.len() * 8);
    for px in &dst {
        for v in px {
            let hundredths = ((*v as f64) / 6.5535).round() as u16;
            a.extend_from_slice(&hundredths.to_le_bytes());
        }
    }
    let lvl = |i: usize| ((i as f64) * 65535.0 / ((CMYK_STEPS - 1) as f64)).round() as u16;
    let mut src2 = Vec::with_capacity(CMYK_STEPS.pow(4));
    for c in 0..CMYK_STEPS {
        for m in 0..CMYK_STEPS {
            for y in 0..CMYK_STEPS {
                for k in 0..CMYK_STEPS {
                    src2.push([lvl(c), lvl(m), lvl(y), lvl(k)]);
                }
            }
        }
    }
    let mut dst2 = vec![[0u8; 3]; src2.len()];
    to_rgb.transform_pixels(&src2, &mut dst2);
    let b: Vec<u8> = dst2.iter().flatten().copied().collect();
    let e = base64::engine::general_purpose::STANDARD;
    Ok(Lut { name: name.to_string(), rgb_steps: RGB_STEPS, cmyk_steps: CMYK_STEPS, to_cmyk: e.encode(a), to_rgb: e.encode(b) })
}

/// Reads a profile from disk, or the built-in one for None.
pub fn load(path: Option<&Path>) -> Result<(Vec<u8>, String), String> {
    match path {
        None => Ok((BUILTIN.to_vec(), BUILTIN_NAME.to_string())),
        Some(p) => {
            let bytes = std::fs::read(p).map_err(|e| format!("Could not read the profile: {e}"))?;
            let name = describe(&bytes)?;
            Ok((bytes, name))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_is_fogra39() {
        let name = describe(BUILTIN).unwrap();
        assert!(name.contains("FOGRA39"), "{name}");
    }

    #[test]
    fn converts() {
        let c = Converter::new(BUILTIN).unwrap();
        let white = c.cmyk([255, 255, 255]);
        assert!(white.iter().all(|v| *v < 0.5), "{white:?}");
        let black = c.cmyk([0, 0, 0]);
        assert!(black[3] > 80.0, "{black:?}");
        // Pure cyan ink comes back as a cyan-ish blue.
        let cyan = c.rgb([100.0, 0.0, 0.0, 0.0]);
        assert!(cyan[0] < 60 && cyan[2] > 180, "{cyan:?}");
        // A round trip lands close to where it started.
        let back = c.rgb(c.cmyk([180, 90, 60]));
        assert!((back[0] as i32 - 180).abs() < 8 && (back[1] as i32 - 90).abs() < 8, "{back:?}");
    }

    #[test]
    fn makes_tables() {
        let l = lut(BUILTIN, BUILTIN_NAME).unwrap();
        let e = base64::engine::general_purpose::STANDARD;
        assert_eq!(e.decode(&l.to_cmyk).unwrap().len(), RGB_STEPS.pow(3) * 8);
        assert_eq!(e.decode(&l.to_rgb).unwrap().len(), CMYK_STEPS.pow(4) * 3);
    }

    #[test]
    fn rejects_rgb_profiles() {
        let srgb = Profile::new_srgb().icc().unwrap();
        assert!(describe(&srgb).is_err());
    }
}
