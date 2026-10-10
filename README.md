# Scriptwriter

Scriptwriter is a writing application for one screenplay. You write in screenplay elements. Return moves among those elements. Tab cycles through the element types. The page breaks are computed when the script is printed.

The rules of the script live in `scriptwriter-spec.md`. This file is how you run the program and how a script is laid out on disk.

## Usage

Clone the repository, install the dependencies, and link `sw` onto your `PATH`:

```
git clone git@github.com:unclebob/scriptwriter.git
cd scriptwriter
npm install
ln -s "$(pwd)/sw" ~/cmds/sw
```

`~/cmds` is one directory already on `PATH`. Any other directory on `PATH` works the same way. The link points at `sw` in the clone. The script resolves that link and uses the clone as its home.

The machine needs `zsh`, Node and npm, Rust (`cargo`), the Xcode Command Line Tools,
and `cargo-audit` for the Rust dependency audit:

```
cargo install cargo-audit --locked
```

Then:

```
Usage:
  sw <directory>
  sw --help

Build Scriptwriter and open the script in <directory>.
The directory must already exist. A folder with no script yet becomes an empty script.

scriptwriter <directory> opens that script without rebuilding.
scriptwriter --help prints this usage.
With no directory, scriptwriter opens spec-script/.
```

`sw --help` and `scriptwriter --help` print that usage and exit. `sw` with no directory prints the usage and exits with status 64. A path that is not a directory exits with status 1. `sw` opens the script from a Scriptwriter app bundle, so the Dock and the app switcher show the script icon.

Inside the window:

- **File → Open Script** (⌘O) opens another folder. **Export PDF** (⌘⇧E) writes a PDF. **Export Scenes** (⌘⇧L) writes a CSV of the scenes, sorted by location, with the scene number, script page, act, and actors. **Shooting Schedule** writes that same list as a PDF narrow enough for an iPhone, keeps the script's scene numbers, and includes every element of each scene.
- The title at the top of the window is the title page title. The fields beside the page are the credit, the author, the draft, and the contact. The list under the fields is the acts and the numbered scene headings. Choosing one scrolls to it.
- The page is monospaced, 12 point, on US Letter. Return moves among the elements. Tab cycles through the element types and leaves the cursor on the same character. ⌘1 through ⌘8 set the element. Text never chooses an element type: prefixes such as `INT.` and `EXT.` are ordinary text. Find is ⌘F. Scene numbers sit in the margins. The current element is named in grey italics in the left margin. A blank line is not named and cannot be edited. A click or a right-click on that name opens the Format menu. An up arrow to the left of the scene number inserts an empty scene heading before that scene. An act is centered and starts a new page unless it is already the first element on the page. A selection inside an element edits that text. A selection across elements takes each of those elements, and Copy or Delete applies to all of them.
- Edits are saved atomically into the open folder after a short pause. Closing or opening another script first flushes the latest edit.

## A script on disk

```text
my-script/
  script.json
```

`script.json` is the whole script. The title, the credit, the author, the draft, and the contact are the title page. `elements` is the screenplay, in order. `contact` may be several lines. The other title fields are one line. An element has either no blank line before it or one. An empty folder becomes an empty script. The credit on a new script is `Written by`. A new script opens on an empty scene heading, and that empty heading is not written until the script has text. The rules are in `scriptwriter-spec.md`.

## Source

| Path | What it is |
|---|---|
| `sw` | Builds the app and opens a script |
| `usage.txt` | The text `--help` prints |
| `scriptwriter-spec.md` | Living spec |
| `spec-script/` | The script opened when `scriptwriter` is started with no directory |
| `index.html`, `src/main/styles.css` | The window |
| `src/main/main.ts` | Window and DOM wiring |
| `src/application/session.ts` | Load, save, close, switching, and export lifecycle |
| `src/domain/` | Element rules and immutable typed documents |
| `src/editor/adapter.ts` | CodeMirror text and explicit element metadata |
| `src/editor/commands.ts` | Return, Tab, Backspace, and structured paste |
| `src/projections/` | Cached pages, outline, scenes, and completion |
| `src/projections/layout.ts` | Pages, `(MORE)`, `(CONT'D)` |
| `src/projections/scenes.ts` | Scene numbers, acts, and the scene CSV |
| `src/domain/script.ts` | Validate and serialize `script.json` |
| `src/infrastructure/` | The narrow native repository adapter |
| `src/export/pdf.ts` | Unicode PDF rendering |
| `src-tauri/src/lib.rs` | Authorized roots, atomic saves, and export dialogs |

Tests are the `*.test.ts` files next to the source, and the tests at the bottom of `src-tauri/src/lib.rs`.

```
npm test
npm run check
npm run audit
```
