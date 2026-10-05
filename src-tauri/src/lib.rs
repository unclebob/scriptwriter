use std::fs;
use std::path::PathBuf;

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|error| error.to_string())
}

fn ensure_parent(path: &str) -> Result<(), String> {
    if let Some(parent) = PathBuf::from(path).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn write_text(path: String, text: String) -> Result<(), String> {
    ensure_parent(&path)?;
    fs::write(&path, text).map_err(|error| error.to_string())
}

const USAGE: &str = include_str!("../../usage.txt");

fn spec_script_path() -> Option<String> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../spec-script");
    path.canonicalize()
        .ok()
        .map(|found| found.to_string_lossy().into_owned())
}

fn script_from_args() -> Result<Option<String>, String> {
    script_from(std::env::args().skip(1))
}

fn help_requested() -> bool {
    help_flag(std::env::args().skip(1))
}

fn help_flag<I>(args: I) -> bool
where
    I: IntoIterator,
    I::Item: AsRef<str>,
{
    for arg in args {
        let arg = arg.as_ref();
        if arg == "--" {
            return false;
        }
        if is_help(arg) {
            return true;
        }
    }
    false
}

fn is_help(arg: &str) -> bool {
    arg == "--help" || arg == "-h"
}

fn script_from<I>(args: I) -> Result<Option<String>, String>
where
    I: IntoIterator,
    I::Item: AsRef<str>,
{
    for arg in args {
        let arg = arg.as_ref();
        if arg == "--" || arg.starts_with('-') {
            continue;
        }
        let path = PathBuf::from(arg);
        if !path.is_dir() {
            return Err(format!("not a directory: {arg}"));
        }
        let full = path.canonicalize().map_err(|error| error.to_string())?;
        return Ok(Some(full.to_string_lossy().into_owned()));
    }
    Ok(None)
}

#[tauri::command]
fn startup_script_path() -> Result<String, String> {
    if let Some(path) = script_from_args()? {
        return Ok(path);
    }
    spec_script_path().ok_or_else(|| "Open a script.".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if help_requested() {
        print!("{USAGE}");
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![read_text, write_text, startup_script_path])
        .run(tauri::generate_context!())
        .expect("error while running Scriptwriter");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir().join(format!("scriptwriter-{nanos}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn writes_and_reads_a_script_file() {
        let dir = temp_dir();
        let file = dir.join("script.json");
        let path = file.to_string_lossy().into_owned();
        write_text(path.clone(), "INT. KITCHEN - DAY\n".into()).unwrap();
        assert_eq!(read_text(path).unwrap(), "INT. KITCHEN - DAY\n");
        let nested = dir.join("notes").join("aside.txt");
        write_text(nested.to_string_lossy().into_owned(), "hello".into()).unwrap();
        assert_eq!(fs::read_to_string(nested).unwrap(), "hello");
    }

    #[test]
    fn reads_a_script_path_from_arguments() {
        let dir = temp_dir();
        let found = script_from(["--", "-x", dir.to_str().unwrap()]).unwrap().unwrap();
        assert_eq!(found, dir.canonicalize().unwrap().to_string_lossy());
        assert!(script_from(["notes.json"]).is_err());
        assert!(script_from(["--", "-h"]).unwrap().is_none());
        assert!(help_flag(["--help"]));
        assert!(help_flag(["-h", "/tmp"]));
        assert!(!help_flag(["--", "--help"]));
        assert!(!help_flag([dir.to_str().unwrap()]));
        assert!(include_str!("../../README.md").contains(USAGE.trim_end()));
        let _ = startup_script_path();
        assert!(spec_script_path().unwrap().ends_with("spec-script"));
    }
}
