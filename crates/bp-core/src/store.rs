//! Saving files safely: a temporary file first, then a rename, so a crash never leaves half a file.

use std::path::Path;

pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)
}

/// File names the interface may use inside the images folder: letters, digits, - and _ and one dot.
pub fn safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() < 120
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        && name.matches('.').count() == 1
        && !name.starts_with('.')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert!(safe_name("abc123-thumb.jpg"));
        assert!(!safe_name("../x.jpg"));
        assert!(!safe_name("a/b.jpg"));
        assert!(!safe_name("noext"));
    }

    #[test]
    fn writes() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("sub").join("a.json");
        write_atomic(&p, b"{}").unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"{}");
    }
}
