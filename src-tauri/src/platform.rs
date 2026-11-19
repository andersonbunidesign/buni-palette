//! Windows-specific pieces. Everything else in the app is shared.

/// Runs an ExtendScript file in Illustrator through its COM interface and returns what
/// the script returned. Illustrator is started if it isn't running.
#[cfg(windows)]
pub fn run_illustrator_script(script: &std::path::Path) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let p = script.to_string_lossy().replace('\'', "''");
    let cmd = format!(
        "$ErrorActionPreference='Stop'; try {{ $ai = New-Object -ComObject Illustrator.Application }} catch {{ Write-Output 'ERROR:Illustrator is not installed or could not be started'; exit }}; $r = $ai.DoJavaScriptFile('{p}'); Write-Output $r"
    );
    let out = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &cmd])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("could not start PowerShell: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if stdout.is_empty() {
        let err = String::from_utf8_lossy(&out.stderr).lines().next().unwrap_or("no answer from Illustrator").to_string();
        return Err(err);
    }
    Ok(stdout)
}

#[cfg(not(windows))]
pub fn run_illustrator_script(_script: &std::path::Path) -> Result<String, String> {
    Err("Illustrator files can only be made on Windows".into())
}
