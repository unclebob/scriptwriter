use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

const SCRIPT_FILE: &str = "script.json";
const USAGE: &str = include_str!("../../usage.txt");
static TEMP_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Default)]
struct ScriptRoots {
    active: Option<PathBuf>,
    pending: Option<PathBuf>,
    seen: Option<String>,
    saw_file: bool,
    companion: Option<CompanionProc>,
}

struct CompanionProc {
    session: String,
    window_id: Option<String>,
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
    save_active(&state, text)
}

fn save_active(slot: &ActiveScript, text: String) -> Result<(), String> {
    save_script(&active_root_of(slot)?, &text)?;
    note_seen(slot, Some(text))
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
    note_seen(slot, opened.text.clone())?;
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
    let Some(name) = Path::new(suggested).file_name() else {
        return format!("Untitled.{extension}");
    };
    name.to_string_lossy().into_owned()
}

fn spec_script_path() -> Option<PathBuf> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../spec-script");
    path.canonicalize().ok()
}

fn script_from_args() -> Result<Option<PathBuf>, String> {
    let mut args = std::env::args();
    args.next();
    script_from(args)
}

fn help_requested() -> bool {
    let mut args = std::env::args();
    args.next();
    help_flag(args)
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
    launch_app();
}

fn launch_app() {
    tauri::Builder::default()
        .manage(ActiveScript::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            load_startup_script,
            choose_script,
            commit_script,
            save_active_script,
            export_file,
            read_external_script,
            acknowledge_script,
            ensure_companion,
            stop_companion
        ])
        .build(tauri::generate_context!())
        .expect("error while running Scriptwriter")
        .run(on_runtime);
}

fn on_runtime(app: &tauri::AppHandle, event: tauri::RunEvent) {
    if let tauri::RunEvent::Exit = event {
        stop_on_exit(&app.state::<ActiveScript>());
    }
}

fn stop_on_exit(state: &ActiveScript) {
    let _ = stop_companion_for(state);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalScript {
    changed: bool,
    text: Option<String>,
}

#[tauri::command]
fn read_external_script(state: State<'_, ActiveScript>) -> Result<ExternalScript, String> {
    external_script(&state)
}

fn external_script(slot: &ActiveScript) -> Result<ExternalScript, String> {
    let text = read_script(&active_root_of(slot)?)?;
    if seen_match(slot, &text)? {
        return Ok(ExternalScript {
            changed: false,
            text: None,
        });
    }
    Ok(ExternalScript {
        changed: true,
        text,
    })
}

fn seen_match(slot: &ActiveScript, text: &Option<String>) -> Result<bool, String> {
    let roots = slot
        .0
        .lock()
        .map_err(|_| "Script state is unavailable.".to_string())?;
    if !roots.saw_file {
        return Ok(false);
    }
    Ok(roots.seen == *text)
}

#[tauri::command]
fn acknowledge_script(state: State<'_, ActiveScript>, text: Option<String>) -> Result<(), String> {
    note_seen(&state, text)
}

fn note_seen(slot: &ActiveScript, text: Option<String>) -> Result<(), String> {
    let mut roots = slot
        .0
        .lock()
        .map_err(|_| "Script state is unavailable.".to_string())?;
    roots.saw_file = true;
    roots.seen = text;
    Ok(())
}

const STANDING_RULES: &str = "\
You are the Scriptwriter companion. The current working directory is the\n\
screenplay folder that is open in Scriptwriter, not the Scriptwriter source.\n\
script.json in this folder is the whole script. It has title, credit, author,\n\
draft, contact, and elements. contact may be several lines. The other title\n\
fields are one line. Each element is {\"type\", \"text\", \"blanksBefore\"}.\n\
text is one line, the text the writer sees. A parenthetical includes its\n\
parentheses. blanksBefore is 0 or 1. The first element has none.\n\
Element types are scene, action, character, parenthetical, dialogue,\n\
transition, shot, and act. Text never chooses a type. A scene heading is one\n\
opaque line. Do not split it into a prefix, a location, and a time of day.\n\
Write character, scene, shot, act, and transition text in the case the writer\n\
sees. Edit script.json to change the script. Scriptwriter reloads that file\n\
when the writer has nothing unsaved, and shows the change on screen.\n\
Do not start Scriptwriter. Closing its window stops only this companion.\n\
Do not commit or push unless asked.\n";

const LAUNCH_PROMPT: &str = "\
The screenplay in this directory is open in Scriptwriter. When asked, edit \
script.json. The window reloads the file and shows the change. Wait for directives.";

fn standing_rules() -> &'static str {
    STANDING_RULES
}

fn launch_prompt() -> &'static str {
    LAUNCH_PROMPT
}

#[tauri::command]
fn ensure_companion(state: State<'_, ActiveScript>) -> Result<(), String> {
    ensure_companion_for(&state)
}

fn ensure_companion_for(slot: &ActiveScript) -> Result<(), String> {
    let root = active_root_of(slot)?;
    open_companion(slot, &root)
}

fn open_companion(slot: &ActiveScript, root: &Path) -> Result<(), String> {
    let session = session_id(root);
    prepare_companion(slot, root, &session)?;
    remember_companion(slot, root, &session)
}

fn prepare_companion(slot: &ActiveScript, root: &Path, session: &str) -> Result<(), String> {
    retire_other(slot, session)?;
    start_unless_live(root, session)
}

fn retire_other(slot: &ActiveScript, session: &str) -> Result<(), String> {
    stop_record(take_if_other(slot, session)?);
    Ok(())
}

fn take_if_other(slot: &ActiveScript, session: &str) -> Result<Option<CompanionProc>, String> {
    let mut roots = slot
        .0
        .lock()
        .map_err(|_| "Script state is unavailable.".to_string())?;
    if same_companion(&roots, session) {
        return Ok(None);
    }
    Ok(roots.companion.take())
}

fn same_companion(roots: &ScriptRoots, session: &str) -> bool {
    roots
        .companion
        .as_ref()
        .is_some_and(|companion| companion.session == session)
}

fn start_unless_live(root: &Path, session: &str) -> Result<(), String> {
    if session_live(session) {
        return publish_terminal(root, session);
    }
    launch_session(root, session)
}

fn session_live(session: &str) -> bool {
    matches!(
        command_status("tmux", &tmux_args(&["has-session", "-t", session])),
        Ok(0)
    )
}

fn launch_session(root: &Path, session: &str) -> Result<(), String> {
    let code = command_status("tmux", &new_session_args(root, session))?;
    started_session(root, session, code)
}

fn started_session(root: &Path, session: &str, code: i32) -> Result<(), String> {
    if code != 0 {
        return Err(format!(
            "Scriptwriter could not start the companion for {session}."
        ));
    }
    arm_respawn(session);
    let _ = publish_terminal(root, session);
    Ok(())
}

fn arm_respawn(session: &str) {
    let pane = format!("{session}:0.0");
    let _ = command_status(
        "tmux",
        &tmux_args(&["set-option", "-p", "-t", &pane, "remain-on-exit", "on"]),
    );
    let _ = command_status(
        "tmux",
        &tmux_args(&["set-hook", "-t", session, "pane-died", "respawn-pane -k"]),
    );
    let _ = command_status(
        "tmux",
        &tmux_args(&["set-option", "-t", session, "status", "off"]),
    );
}

fn publish_terminal(root: &Path, session: &str) -> Result<(), String> {
    let out = command_output(
        "osascript",
        &[
            "-e".to_string(),
            terminal_script(session, &applescript_title(root)),
        ],
    )?;
    write_companion(root, session, first_number(&out).as_deref())
}

fn remember_companion(slot: &ActiveScript, root: &Path, session: &str) -> Result<(), String> {
    let record = read_companion(root).unwrap_or(CompanionProc {
        session: session.to_string(),
        window_id: None,
    });
    let mut roots = slot
        .0
        .lock()
        .map_err(|_| "Script state is unavailable.".to_string())?;
    roots.companion = Some(record);
    Ok(())
}

#[tauri::command]
fn stop_companion(state: State<'_, ActiveScript>) -> Result<(), String> {
    stop_companion_for(&state)
}

fn stop_companion_for(slot: &ActiveScript) -> Result<(), String> {
    stop_record(take_companion(slot)?);
    stop_record(disk_companion(slot));
    Ok(())
}

fn take_companion(slot: &ActiveScript) -> Result<Option<CompanionProc>, String> {
    let mut roots = slot
        .0
        .lock()
        .map_err(|_| "Script state is unavailable.".to_string())?;
    Ok(roots.companion.take())
}

fn disk_companion(slot: &ActiveScript) -> Option<CompanionProc> {
    read_companion(&active_root_of(slot).ok()?)
}

fn stop_record(record: Option<CompanionProc>) {
    let Some(record) = record else {
        return;
    };
    stop_name(&record.session);
    close_window(record.window_id.as_deref());
}

fn stop_name(session: &str) {
    let _ = command_status(
        "tmux",
        &tmux_args(&["set-hook", "-t", session, "-u", "pane-died"]),
    );
    let _ = command_status("tmux", &tmux_args(&["kill-session", "-t", session]));
}

fn close_window(window: Option<&str>) {
    let Some(digits) = all_digits(window.unwrap_or("")) else {
        return;
    };
    let _ = command_status(
        "osascript",
        &["-e".to_string(), close_terminal_script(digits)],
    );
}

fn all_digits(window: &str) -> Option<&str> {
    if window.is_empty() {
        return None;
    }
    nonempty_digits(window)
}

fn nonempty_digits(window: &str) -> Option<&str> {
    if window.chars().all(|ch| ch.is_ascii_digit()) {
        return Some(window);
    }
    None
}

fn session_id(root: &Path) -> String {
    let name = root
        .file_name()
        .and_then(|item| item.to_str())
        .unwrap_or("script");
    format!(
        "scriptwriter-{}-{}",
        session_label(name),
        stable_hash(&root.to_string_lossy())
    )
}

fn session_label(name: &str) -> String {
    let label: String = name.chars().map(session_char).collect();
    if label.is_empty() {
        return "script".to_string();
    }
    label
}

fn session_char(ch: char) -> char {
    if allowed_session_char(ch) {
        return ch;
    }
    '-'
}

fn allowed_session_char(ch: char) -> bool {
    if ch.is_ascii_alphanumeric() {
        return true;
    }
    hyphen_or_underscore(ch)
}

fn hyphen_or_underscore(ch: char) -> bool {
    ch == '-' || ch == '_'
}

fn stable_hash(text: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:x}")
}

fn new_session_args(root: &Path, session: &str) -> Vec<String> {
    let cwd = root.to_string_lossy().into_owned();
    let mut args = tmux_args(&[
        "new-session",
        "-d",
        "-s",
        session,
        "-c",
        &cwd,
        "-e",
        "GROK_THEME=terminal",
        "-e",
        "GROK_TERMINAL_THEME=1",
        "-e",
        "COLORTERM=truecolor",
    ]);
    args.push(grok_executable());
    args.push("--yolo".into());
    args.push("--trust".into());
    args.push("--rules".into());
    args.push(standing_rules().to_string());
    args.push(launch_prompt().to_string());
    args
}

fn tmux_args(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|part| (*part).to_string()).collect()
}

fn grok_executable() -> String {
    if let Some(path) = env_executable("GROK_BIN") {
        return path;
    }
    default_grok()
}

fn env_executable(key: &str) -> Option<String> {
    executable_file(&std::env::var(key).ok()?)
}

fn default_grok() -> String {
    grok_candidates()
        .into_iter()
        .find_map(|path| executable_file(&path))
        .unwrap_or_else(|| "grok".to_string())
}

fn grok_candidates() -> Vec<String> {
    let mut paths = Vec::new();
    if let Some(home) = std::env::var_os("HOME") {
        paths.push(
            PathBuf::from(home)
                .join(".grok/bin/grok")
                .to_string_lossy()
                .into_owned(),
        );
    }
    paths.push("/opt/homebrew/bin/grok".into());
    paths.push("/usr/local/bin/grok".into());
    paths
}

fn executable_file(path: &str) -> Option<String> {
    if runnable_file(Path::new(path)) {
        return Some(path.to_string());
    }
    None
}

fn runnable_file(file: &Path) -> bool {
    file.is_file() && executable_mode(file)
}

#[cfg(unix)]
fn executable_mode(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .map(|meta| meta.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn executable_mode(path: &Path) -> bool {
    path.metadata().is_ok()
}

fn terminal_script(session: &str, title: &str) -> String {
    format!(
        "tell application \"Terminal\"\n\
         launch\n\
         set grokTab to do script \"tmux attach -t {session}; exit\"\n\
         set custom title of grokTab to \"{title}\"\n\
         set title displays custom title of grokTab to true\n\
         set winID to id of front window\n\
         end tell\n\
         return winID"
    )
}

fn applescript_title(root: &Path) -> String {
    let name = root
        .file_name()
        .and_then(|item| item.to_str())
        .unwrap_or("script");
    format!("Scriptwriter: {}", session_label(name))
}

fn close_terminal_script(window: &str) -> String {
    format!(
        "tell application \"Terminal\"\n\
         try\n\
         close (first window whose id is {window}) saving no\n\
         end try\n\
         end tell"
    )
}

fn first_number(text: &str) -> Option<String> {
    let digits: String = text
        .chars()
        .skip_while(|ch| !ch.is_ascii_digit())
        .take_while(|ch| ch.is_ascii_digit())
        .collect();
    if digits.is_empty() {
        return None;
    }
    Some(digits)
}

fn companion_path(root: &Path) -> PathBuf {
    root.join(".scriptwriter").join("companion.txt")
}

fn write_companion(root: &Path, session: &str, window: Option<&str>) -> Result<(), String> {
    let dir = root.join(".scriptwriter");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    fs::write(dir.join("companion.txt"), encode_companion(session, window))
        .map_err(|error| error.to_string())
}

fn encode_companion(session: &str, window: Option<&str>) -> String {
    format!("{session}\n{}\n", window.unwrap_or(""))
}

fn read_companion(root: &Path) -> Option<CompanionProc> {
    decode_companion(&fs::read_to_string(companion_path(root)).ok()?)
}

fn decode_companion(text: &str) -> Option<CompanionProc> {
    named_companion(first_line(text)?, second_line(text))
}

fn named_companion(session: String, window: Option<String>) -> Option<CompanionProc> {
    if session.is_empty() {
        return None;
    }
    Some(CompanionProc {
        session,
        window_id: window,
    })
}

fn first_line(text: &str) -> Option<String> {
    Some(text.lines().next()?.trim().to_string())
}

fn second_line(text: &str) -> Option<String> {
    present_line(text.lines().nth(1)?)
}

fn present_line(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

fn command_status(program: &str, args: &[String]) -> Result<i32, String> {
    let status = std::process::Command::new(program)
        .args(args)
        .status()
        .map_err(|error| error.to_string())?;
    Ok(status.code().unwrap_or(1))
}

fn command_output(program: &str, args: &[String]) -> Result<String, String> {
    let output = std::process::Command::new(program)
        .args(args)
        .output()
        .map_err(|error| error.to_string())?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
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
    fn distinguishes_temporary_files_and_ignores_the_program_name() {
        let parent = std::env::temp_dir();
        let name = std::ffi::OsStr::new("script.json");
        assert_ne!(temporary_path(&parent, name), temporary_path(&parent, name));
        assert!(script_from_args().unwrap().is_none());
        assert!(!help_requested());
        assert!(active_root_of(&ActiveScript::default())
            .unwrap_err()
            .contains("No script is open."));
    }

    #[test]
    fn sanitizes_export_suggestions_and_extensions() {
        assert_eq!(safe_file_name("../../draft.pdf", "pdf"), "draft.pdf");
        assert_eq!(safe_file_name("", "csv"), "Untitled.csv");
        assert_eq!(safe_file_name(".", "pdf"), "Untitled.pdf");
        assert_eq!(safe_file_name("..", "csv"), "Untitled.csv");
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

    #[test]
    fn reports_an_external_script_once() {
        let dir = temp_dir().canonicalize().unwrap();
        let slot = ActiveScript::default();
        open_remembered(&slot, dir.clone()).unwrap();
        assert!(!external_script(&slot).unwrap().changed);
        fs::write(dir.join(SCRIPT_FILE), "from the agent").unwrap();
        let changed = external_script(&slot).unwrap();
        assert!(changed.changed);
        assert_eq!(changed.text.as_deref(), Some("from the agent"));
        note_seen(&slot, changed.text).unwrap();
        assert!(!external_script(&slot).unwrap().changed);
        save_active(&slot, "typed".into()).unwrap();
        assert_eq!(fs::read_to_string(dir.join(SCRIPT_FILE)).unwrap(), "typed");
        assert!(!external_script(&slot).unwrap().changed);
        fs::remove_file(dir.join(SCRIPT_FILE)).unwrap();
        let removed = external_script(&slot).unwrap();
        assert!(removed.changed);
        assert!(removed.text.is_none());
    }

    #[test]
    fn names_a_companion_for_the_screenplay_folder() {
        let dir = temp_dir();
        let nested = dir.join("My Script");
        fs::create_dir(&nested).unwrap();
        let id = session_id(&nested);
        assert_eq!(id, session_id(&nested));
        assert!(id.starts_with("scriptwriter-My-Script-"));
        assert!(!id.contains(' '));
        assert_eq!(stable_hash("same"), stable_hash("same"));
        assert_ne!(stable_hash("a"), stable_hash("b"));
        assert_eq!(session_label(""), "script");
        assert_eq!(session_char('.'), '-');
        assert!(standing_rules().contains("script.json"));
        assert!(standing_rules().contains("opaque line"));
        assert!(launch_prompt().contains("script.json"));
        let args = new_session_args(&nested, &id);
        assert!(args.iter().any(|arg| arg == "--yolo"));
        assert!(args.iter().any(|arg| arg == "--trust"));
        assert!(args.iter().any(|arg| arg == &id));
        assert!(args.iter().any(|arg| arg.contains("GROK_THEME=terminal")));
        write_companion(&nested, &id, Some("42")).unwrap();
        let record = read_companion(&nested).unwrap();
        assert_eq!(record.session, id);
        assert_eq!(record.window_id.as_deref(), Some("42"));
        write_companion(&nested, &id, None).unwrap();
        assert_eq!(read_companion(&nested).unwrap().window_id, None);
        assert!(decode_companion("").is_none());
        assert!(decode_companion("\n\n").is_none());
        assert_eq!(first_number("window id 15\n").as_deref(), Some("15"));
        assert!(first_number("none").is_none());
        assert_eq!(all_digits("15"), Some("15"));
        assert!(all_digits("").is_none());
        assert!(all_digits("15a").is_none());
        assert!(terminal_script(&id, "Scriptwriter: My-Script").contains(&id));
        assert!(close_terminal_script("15").contains("15"));
        assert_eq!(applescript_title(&nested), "Scriptwriter: My-Script");
        let slot = ActiveScript::default();
        slot.0.lock().unwrap().companion = Some(CompanionProc {
            session: "scriptwriter-old".into(),
            window_id: Some("9".into()),
        });
        let taken = take_if_other(&slot, &id).unwrap().unwrap();
        assert_eq!(taken.session, "scriptwriter-old");
        assert!(take_if_other(&slot, &id).unwrap().is_none());
        assert!(executable_file("missing-grok").is_none());
        let program = dir.join("grok-test");
        fs::write(&program, "").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&program, fs::Permissions::from_mode(0o644)).unwrap();
            assert!(executable_file(program.to_str().unwrap()).is_none());
            fs::set_permissions(&program, fs::Permissions::from_mode(0o755)).unwrap();
            assert_eq!(
                executable_file(program.to_str().unwrap()).as_deref(),
                program.to_str()
            );
        }
        assert!(!grok_candidates().is_empty());
    }
}
