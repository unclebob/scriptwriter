use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

const SCRIPT_FILE: &str = "script.json";
const USAGE: &str = include_str!("../../usage.txt");
static TEMP_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Default)]
struct ActiveScript(Mutex<Option<PathBuf>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenedScript {
    root: String,
    text: Option<String>,
}

#[tauri::command]
fn load_startup_script(state: State<'_, ActiveScript>) -> Result<OpenedScript, String> {
    let root = script_from_args()?
        .or_else(spec_script_path)
        .ok_or_else(|| "Open a script.".to_string())?;
    activate(&state, root)
}

#[tauri::command]
async fn choose_script(
    app: AppHandle,
    state: State<'_, ActiveScript>,
) -> Result<Option<OpenedScript>, String> {
    let selected = app
        .dialog()
        .file()
        .set_title("Open Script")
        .blocking_pick_folder();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected.into_path().map_err(|error| error.to_string())?;
    activate(&state, path).map(Some)
}

#[tauri::command]
fn save_active_script(state: State<'_, ActiveScript>, text: String) -> Result<(), String> {
    let root = active_root(&state)?;
    validate_root(&root)?;
    let path = root.join(SCRIPT_FILE);
    reject_symlink(&path)?;
    atomic_write(&path, text.as_bytes()).map_err(|error| error.to_string())
}

#[tauri::command]
async fn export_file(
    app: AppHandle,
    state: State<'_, ActiveScript>,
    suggested_name: String,
    extension: String,
    bytes: Vec<u8>,
) -> Result<bool, String> {
    let (label, extension) = export_kind(&extension)?;
    let mut dialog = app
        .dialog()
        .file()
        .set_title(format!("Export {label}"))
        .set_file_name(safe_file_name(&suggested_name, extension))
        .add_filter(label, &[extension]);
    if let Ok(root) = active_root(&state) {
        dialog = dialog.set_directory(root);
    }
    let Some(selected) = dialog.blocking_save_file() else {
        return Ok(false);
    };
    let path = selected.into_path().map_err(|error| error.to_string())?;
    reject_symlink(&path)?;
    atomic_write(&path, &bytes).map_err(|error| error.to_string())?;
    Ok(true)
}

fn activate(state: &State<'_, ActiveScript>, root: PathBuf) -> Result<OpenedScript, String> {
    let root = canonical_directory(&root)?;
    let text = read_script(&root)?;
    *state.0.lock().map_err(|_| "Script state is unavailable.")? = Some(root.clone());
    Ok(OpenedScript {
        root: root.to_string_lossy().into_owned(),
        text,
    })
}

fn active_root(state: &State<'_, ActiveScript>) -> Result<PathBuf, String> {
    state
        .0
        .lock()
        .map_err(|_| "Script state is unavailable.".to_string())?
        .clone()
        .ok_or_else(|| "No script is open.".to_string())
}

fn canonical_directory(path: &Path) -> Result<PathBuf, String> {
    if !path.is_dir() {
        return Err(format!("not a directory: {}", path.display()));
    }
    path.canonicalize().map_err(|error| error.to_string())
}

fn validate_root(root: &Path) -> Result<(), String> {
    let current = canonical_directory(root)?;
    if current != root {
        return Err("The active script folder changed after it was opened.".to_string());
    }
    Ok(())
}

fn read_script(root: &Path) -> Result<Option<String>, String> {
    validate_root(root)?;
    let path = root.join(SCRIPT_FILE);
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err("script.json must not be a symbolic link.".to_string())
        }
        Ok(metadata) if !metadata.is_file() => {
            Err("script.json is not a regular file.".to_string())
        }
        Ok(_) => fs::read_to_string(path)
            .map(Some)
            .map_err(|error| error.to_string()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn reject_symlink(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(format!(
            "refusing to replace symbolic link: {}",
            path.display()
        )),
        Ok(metadata) if !metadata.is_file() => {
            Err(format!("not a regular file: {}", path.display()))
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    atomic_write_before_commit(path, bytes, |_| Ok(()))
}

fn atomic_write_before_commit<F>(path: &Path, bytes: &[u8], before_commit: F) -> io::Result<()>
where
    F: FnOnce(&Path) -> io::Result<()>,
{
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "destination has no parent"))?;
    fs::create_dir_all(parent)?;
    let temp = temporary_path(parent, path.file_name().unwrap_or_default());
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        before_commit(&temp)?;
        fs::rename(&temp, path)?;
        File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn temporary_path(parent: &Path, name: &std::ffi::OsStr) -> PathBuf {
    let id = TEMP_ID.fetch_add(1, Ordering::Relaxed);
    let name = name.to_string_lossy();
    parent.join(format!(".{name}.{}.{}.tmp", std::process::id(), id))
}

fn export_kind(extension: &str) -> Result<(&'static str, &'static str), String> {
    match extension {
        "pdf" => Ok(("PDF", "pdf")),
        "csv" => Ok(("CSV", "csv")),
        _ => Err("Unsupported export type.".to_string()),
    }
}

fn safe_file_name(suggested: &str, extension: &str) -> String {
    let fallback = format!("Untitled.{extension}");
    let Some(name) = Path::new(suggested).file_name() else {
        return fallback;
    };
    let name = name.to_string_lossy();
    if name.is_empty() || name == "." || name == ".." {
        fallback
    } else {
        name.into_owned()
    }
}

fn spec_script_path() -> Option<PathBuf> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../spec-script");
    path.canonicalize().ok()
}

fn script_from_args() -> Result<Option<PathBuf>, String> {
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
        if arg == "--help" || arg == "-h" {
            return true;
        }
    }
    false
}

fn script_from<I>(args: I) -> Result<Option<PathBuf>, String>
where
    I: IntoIterator,
    I::Item: AsRef<str>,
{
    for arg in args {
        let arg = arg.as_ref();
        if arg == "--" || arg.starts_with('-') {
            continue;
        }
        return canonical_directory(Path::new(arg)).map(Some);
    }
    Ok(None)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if help_requested() {
        print!("{USAGE}");
        return;
    }
    tauri::Builder::default()
        .manage(ActiveScript::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            load_startup_script,
            choose_script,
            save_active_script,
            export_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Scriptwriter");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let id = TEMP_ID.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("scriptwriter-{nanos}-{id}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn atomically_replaces_a_script_file() {
        let dir = temp_dir();
        let file = dir.join(SCRIPT_FILE);
        atomic_write(&file, b"first").unwrap();
        atomic_write(&file, b"second").unwrap();
        assert_eq!(fs::read_to_string(file).unwrap(), "second");
    }

    #[test]
    fn failed_commit_preserves_the_previous_script() {
        let dir = temp_dir();
        let file = dir.join(SCRIPT_FILE);
        atomic_write(&file, b"valid").unwrap();
        let result = atomic_write_before_commit(&file, b"partial", |_| {
            Err(io::Error::other("simulated failure"))
        });
        assert!(result.is_err());
        assert_eq!(fs::read_to_string(file).unwrap(), "valid");
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_script_symlink() {
        use std::os::unix::fs::symlink;
        let dir = temp_dir();
        let outside = dir.parent().unwrap().join("scriptwriter-outside.json");
        fs::write(&outside, "secret").unwrap();
        symlink(&outside, dir.join(SCRIPT_FILE)).unwrap();
        assert!(read_script(&dir.canonicalize().unwrap())
            .unwrap_err()
            .contains("symbolic link"));
        fs::remove_file(outside).unwrap();
    }

    #[test]
    fn reads_a_script_path_from_arguments() {
        let dir = temp_dir();
        let found = script_from(["--", "-x", dir.to_str().unwrap()])
            .unwrap()
            .unwrap();
        assert_eq!(found, dir.canonicalize().unwrap());
        assert!(script_from(["notes.json"]).is_err());
        assert!(script_from(["--", "-h"]).unwrap().is_none());
        assert!(help_flag(["--help"]));
        assert!(help_flag(["-h", "/tmp"]));
        assert!(!help_flag(["--", "--help"]));
        assert!(!help_flag([dir.to_str().unwrap()]));
        assert!(include_str!("../../README.md").contains(USAGE.trim_end()));
        assert!(spec_script_path().unwrap().ends_with("spec-script"));
    }

    #[test]
    fn sanitizes_export_suggestions_and_extensions() {
        assert_eq!(safe_file_name("../../draft.pdf", "pdf"), "draft.pdf");
        assert_eq!(safe_file_name("", "csv"), "Untitled.csv");
        assert!(export_kind("html").is_err());
    }
}
