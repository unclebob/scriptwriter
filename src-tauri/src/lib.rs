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
struct ScriptRoots {
    active: Option<PathBuf>,
    pending: Option<PathBuf>,
}

#[derive(Default)]
struct ActiveScript(Mutex<ScriptRoots>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenedScript {
    root: String,
    text: Option<String>,
}

#[tauri::command]
fn load_startup_script(state: State<'_, ActiveScript>) -> Result<OpenedScript, String> {
    activate(&state, startup_root()?)
}

fn startup_root() -> Result<PathBuf, String> {
    let chosen = script_from_args()?;
    chosen
        .or_else(spec_script_path)
        .ok_or_else(|| "Open a script.".to_string())
}

#[tauri::command]
async fn choose_script(
    app: AppHandle,
    state: State<'_, ActiveScript>,
) -> Result<Option<OpenedScript>, String> {
    stage_script(&state, picked_folder(&app))
}

fn picked_folder(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let Some(selected) = app
        .dialog()
        .file()
        .set_title("Open Script")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    selected
        .into_path()
        .map(Some)
        .map_err(|error| error.to_string())
}

fn stage_script(
    slot: &ActiveScript,
    picked: Result<Option<PathBuf>, String>,
) -> Result<Option<OpenedScript>, String> {
    let Some(path) = picked? else {
        return Ok(None);
    };
    let opened = open_script(path)?;
    store_pending(slot, &opened)?;
    Ok(Some(opened))
}

fn open_script(root: PathBuf) -> Result<OpenedScript, String> {
    let root = canonical_directory(&root)?;
    let text = read_script(&root)?;
    Ok(OpenedScript {
        root: root.to_string_lossy().into_owned(),
        text,
    })
}

fn store_pending(slot: &ActiveScript, opened: &OpenedScript) -> Result<(), String> {
    slot.0
        .lock()
        .map_err(|_| "Script state is unavailable.")?
        .pending = Some(PathBuf::from(&opened.root));
    Ok(())
}

#[tauri::command]
fn commit_script(state: State<'_, ActiveScript>) -> Result<(), String> {
    promote(&state)
}

fn promote(slot: &ActiveScript) -> Result<(), String> {
    let mut roots = slot.0.lock().map_err(|_| "Script state is unavailable.")?;
    let pending = roots
        .pending
        .take()
        .ok_or("No script is selected.".to_string())?;
    roots.active = Some(pending);
    Ok(())
}

#[tauri::command]
fn save_active_script(state: State<'_, ActiveScript>, text: String) -> Result<(), String> {
    save_script(&active_root(&state)?, &text)
}

fn save_script(root: &Path, text: &str) -> Result<(), String> {
    validate_root(root)?;
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
    let kind = export_kind(&extension)?;
    save_picked(pick_export(&app, &state, &suggested_name, kind), &bytes)
}

fn pick_export(
    app: &AppHandle,
    slot: &ActiveScript,
    suggested_name: &str,
    kind: (&str, &str),
) -> Result<Option<PathBuf>, String> {
    selected_path(export_dialog(app, slot, suggested_name, kind).blocking_save_file())
}

fn export_dialog(
    app: &AppHandle,
    slot: &ActiveScript,
    suggested_name: &str,
    kind: (&str, &str),
) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    let (label, extension) = kind;
    let mut dialog = app
        .dialog()
        .file()
        .set_title(format!("Export {label}"))
        .set_file_name(safe_file_name(suggested_name, extension))
        .add_filter(label, &[extension]);
    if let Ok(root) = active_root_of(slot) {
        dialog = dialog.set_directory(root);
    }
    dialog
}

fn selected_path(
    selected: Option<tauri_plugin_dialog::FilePath>,
) -> Result<Option<PathBuf>, String> {
    let Some(file) = selected else {
        return Ok(None);
    };
    file.into_path()
        .map(Some)
        .map_err(|error| error.to_string())
}

fn save_picked(picked: Result<Option<PathBuf>, String>, bytes: &[u8]) -> Result<bool, String> {
    let Some(path) = picked? else {
        return Ok(false);
    };
    save_export(&path, bytes)?;
    Ok(true)
}

fn save_export(path: &Path, bytes: &[u8]) -> Result<(), String> {
    reject_symlink(path)?;
    atomic_write(path, bytes).map_err(|error| error.to_string())
}

fn activate(state: &State<'_, ActiveScript>, root: PathBuf) -> Result<OpenedScript, String> {
    open_remembered(state, root)
}

fn open_remembered(slot: &ActiveScript, root: PathBuf) -> Result<OpenedScript, String> {
    let opened = open_script(root)?;
    remember_active(slot, &opened)?;
    Ok(opened)
}

fn remember_active(slot: &ActiveScript, opened: &OpenedScript) -> Result<(), String> {
    slot.0
        .lock()
        .map_err(|_| "Script state is unavailable.")?
        .active = Some(PathBuf::from(&opened.root));
    Ok(())
}

fn active_root_of(slot: &ActiveScript) -> Result<PathBuf, String> {
    slot.0
        .lock()
        .map_err(|_| "Script state is unavailable.".to_string())?
        .active
        .clone()
        .ok_or_else(|| "No script is open.".to_string())
}

fn active_root(state: &State<'_, ActiveScript>) -> Result<PathBuf, String> {
    state
        .0
        .lock()
        .map_err(|_| "Script state is unavailable.".to_string())?
        .active
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
    commit_write(path, bytes, before_commit, sync_parent)
}

fn sync_parent(parent: &Path) -> io::Result<()> {
    File::open(parent)?.sync_all()
}

fn parent_dir(path: &Path) -> io::Result<&Path> {
    path.parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "destination has no parent"))
}

struct Written {
    renamed: bool,
    result: io::Result<()>,
}

fn commit_write<F, S>(path: &Path, bytes: &[u8], before_commit: F, sync_parent: S) -> io::Result<()>
where
    F: FnOnce(&Path) -> io::Result<()>,
    S: FnOnce(&Path) -> io::Result<()>,
{
    let parent = parent_dir(path)?;
    fs::create_dir_all(parent)?;
    let temp = temporary_path(parent, path.file_name().unwrap_or_default());
    finish_write(
        &temp,
        write_temp(&temp, path, bytes, before_commit, sync_parent, parent),
    )
}

fn write_temp<F, S>(
    temp: &Path,
    path: &Path,
    bytes: &[u8],
    before_commit: F,
    sync_parent: S,
    parent: &Path,
) -> Written
where
    F: FnOnce(&Path) -> io::Result<()>,
    S: FnOnce(&Path) -> io::Result<()>,
{
    let mut renamed = false;
    let result = (|| {
        let mut file = OpenOptions::new().write(true).create_new(true).open(temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        before_commit(temp)?;
        fs::rename(temp, path)?;
        renamed = true;
        sync_parent(parent)?;
        Ok(())
    })();
    Written { renamed, result }
}

fn finish_write(temp: &Path, written: Written) -> io::Result<()> {
    if written.renamed {
        // The new bytes are already the destination file. Failing the command
        // here would leave the session dirty after the previous file is gone.
        return Ok(());
    }
    let _ = fs::remove_file(temp);
    written.result
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
            commit_script,
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
    fn directory_sync_failure_keeps_the_written_file() {
        let dir = temp_dir();
        let file = dir.join(SCRIPT_FILE);
        atomic_write(&file, b"valid").unwrap();
        let result = commit_write(
            &file,
            b"second",
            |_| Ok(()),
            |_| Err(io::Error::other("sync")),
        );
        assert!(result.is_ok());
        assert_eq!(fs::read_to_string(&file).unwrap(), "second");
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

    #[test]
    fn reads_a_regular_script_and_rejects_other_files() {
        let dir = temp_dir().canonicalize().unwrap();
        assert!(read_script(&dir).unwrap().is_none());
        fs::write(dir.join(SCRIPT_FILE), "body").unwrap();
        assert_eq!(read_script(&dir).unwrap().as_deref(), Some("body"));
        fs::remove_file(dir.join(SCRIPT_FILE)).unwrap();
        fs::create_dir(dir.join(SCRIPT_FILE)).unwrap();
        assert!(read_script(&dir)
            .unwrap_err()
            .contains("not a regular file"));
        let notes = dir.join("notes.txt");
        fs::write(&notes, "x").unwrap();
        assert!(read_script(&notes).unwrap_err().contains("not a directory"));
    }

    #[test]
    fn classifies_paths_before_replacing_them() {
        let dir = temp_dir();
        let file = dir.join(SCRIPT_FILE);
        assert!(reject_symlink(&file).is_ok());
        fs::write(&file, "body").unwrap();
        assert!(reject_symlink(&file).is_ok());
        let nested = dir.join("nested");
        fs::create_dir(&nested).unwrap();
        assert!(reject_symlink(&nested)
            .unwrap_err()
            .contains("not a regular file"));
    }

    #[cfg(unix)]
    #[test]
    fn refuses_to_replace_a_symlink() {
        use std::os::unix::fs::symlink;
        let dir = temp_dir();
        let target = dir.join("target.json");
        fs::write(&target, "secret").unwrap();
        let link = dir.join("link.json");
        symlink(&target, &link).unwrap();
        assert!(reject_symlink(&link).unwrap_err().contains("symbolic link"));
        let alias = dir.join("alias");
        symlink(&dir, &alias).unwrap();
        assert!(read_script(&alias).is_err());
    }

    #[test]
    fn saves_and_promotes_a_pending_script() {
        let dir = temp_dir().canonicalize().unwrap();
        save_script(&dir, "saved").unwrap();
        assert_eq!(fs::read_to_string(dir.join(SCRIPT_FILE)).unwrap(), "saved");
        let slot = ActiveScript::default();
        assert!(stage_script(&slot, Ok(None)).unwrap().is_none());
        assert!(stage_script(&slot, Err("cancelled".to_string())).is_err());
        assert!(stage_script(&slot, Ok(Some(dir.join("missing")))).is_err());
        let opened = stage_script(&slot, Ok(Some(dir.clone()))).unwrap().unwrap();
        assert_eq!(opened.root, dir.to_string_lossy());
        promote(&slot).unwrap();
        assert!(promote(&slot).is_err());
        let again = open_remembered(&slot, dir.clone()).unwrap();
        assert_eq!(again.text.as_deref(), Some("saved"));
        assert!(!save_picked(Ok(None), b"nope").unwrap());
        assert!(save_picked(Err("no path".to_string()), b"nope").is_err());
        let copy = dir.join("copy.json");
        assert!(save_picked(Ok(Some(copy.clone())), b"copy").unwrap());
        assert_eq!(fs::read(&copy).unwrap(), b"copy");
    }
}
