# Scriptwriter

Living spec. This is a draft. Expect it to change.

Scriptwriter is a small writing application for one screenplay. You write in screenplay elements. Return moves among those elements. Tab cycles through the element types. The page breaks, the `(MORE)`, and the `(CONT'D)` are computed when the script is printed.

## The script

A script is a folder.

```text
my-script/
  script.json
```

The folder is the only stored form. There is no database and no separate project file.

`script.json` is the whole script. The title, the credit, the author, the draft, and the contact are the title page. `elements` is the screenplay, in order. The application owns the file and rewrites it.

```json
{
  "title": "The Kettle",
  "credit": "Written by",
  "author": "A. Writer",
  "draft": "October 2026",
  "contact": "A. Writer\nwriter@example.com",
  "elements": [
    { "type": "act", "text": "ACT I" },
    { "type": "scene", "text": "KITCHEN", "blanksBefore": 1 }
  ]
}
```

`contact` may be several lines. The other title fields are one line. An empty folder becomes an empty script. The credit on a new script is `Written by`.

Each element is one object. `text` is one line, the text the writer sees. A parenthetical includes its parentheses. `blanksBefore` is 0 or 1, the blank lines before that element. Left out, it uses the usual count from the table below. A larger count is read as 1. The first element has none.

A new script opens on an empty scene heading. That empty heading is not written. `elements` stays empty until the script has text.

The file is UTF-8 with LF line endings.

## Elements

A screenplay is a sequence of elements. These are the elements, and they are the only ones.

| Element | What it is | Case | Blank lines before |
|---|---|---|---|
| Scene Heading | Where and when the scene is. | Uppercase | 1 |
| Action | What is seen and heard. | As typed | 1 |
| Character | Who speaks. | Uppercase | 1 |
| Parenthetical | How a line is said, in parentheses. | As typed | 0 |
| Dialogue | What the character says. | As typed | 0 |
| Transition | How the scene ends, such as `CUT TO:`. | Uppercase | 1 |
| Shot | A camera direction. | Uppercase | 1 |
| Act | The act the following scenes belong to, such as `ACT ONE`. | Uppercase | 1 |

Blank lines are not elements. At most one blank line stands before the next element. Dialogue and a parenthetical sit on the next line under the character, so that count is 0.

A parenthetical is a whole line in parentheses. The editor keeps the parentheses. The cursor sits between them.

## What a line is

Each element is one line in the editor. A blank line is the space before the next element. It is not an element. The status bar calls it Blank. The left margin does not name it. Typing, Delete, and Backspace do not change it. Wrapping is done by the editor and by the PDF. The file does not hard-wrap.

CodeMirror stores the visible text and an explicit element type for every element line. Blank separator lines have no type. Text and type metadata change in the same undoable transaction. Saving combines that visible text and metadata directly; it does not classify text.

Text has no special prefixes or hidden characters. `INT.`, `EXT.`, `ACT ONE`, leading punctuation, zero-width characters, and every other string are ordinary content. Typing or pasting them never changes an element's type. A scene heading exists only when the writer selects Scene Heading or reaches it through an explicit Return rule.

## Writing

The status bar names the element the cursor is in. On a blank line it says Blank.

Return adds the next element and moves the cursor there. Text after the cursor moves into the new element when the element is action, dialogue, or a shot. A scene heading, a character, a parenthetical, a transition, and an act are not split.

| From | Return adds |
|---|---|
| Scene Heading | Action |
| Action | Action |
| Character | Dialogue |
| Parenthetical | Dialogue |
| Dialogue | Action |
| Transition | Scene Heading |
| Shot | Action |
| Act | Scene Heading |

Tab cycles through every element type, in the order below, and then back to the start. The cursor stays on the same character. Shift-Tab cycles the other way. The text stays. Case and parentheses change to fit the explicitly selected type.

| Element | Tab | Shift-Tab |
|---|---|---|
| Scene Heading | Action | Act |
| Action | Character | Scene Heading |
| Character | Parenthetical | Action |
| Parenthetical | Dialogue | Character |
| Dialogue | Transition | Parenthetical |
| Transition | Shot | Dialogue |
| Shot | Act | Transition |
| Act | Scene Heading | Shot |

Backspace in an empty element removes it and returns to the end of the previous element. Backspace at the start of a line and Delete at the end of an element do not join elements.

A selection inside one element selects that text. Copy and Delete act on those characters. A selection that reaches another element expands to cover every element from the first one it touches through the last. Copy takes those elements. Delete removes them. Pasting that copy inserts the elements after the element the cursor is in, or replaces the elements the selection covers.

The Format menu and the number keys set the current element.

| Key | Element |
|---|---|
| ⌘1 | Scene Heading |
| ⌘2 | Action |
| ⌘3 | Character |
| ⌘4 | Parenthetical |
| ⌘5 | Dialogue |
| ⌘6 | Transition |
| ⌘7 | Shot |
| ⌘8 | Act |

## Completion

The lists come from the script. They are not stored.

- A character cue offers the character names already used. In a scene where two people have been talking, the name offered first is the one who did not speak last.
- A scene heading offers the scene headings already used, each as a whole line. The heading used most recently comes first. A heading is not split into a prefix, a location, and a time of day.
- After `(` in a cue, the extensions are `(V.O.)`, `(O.S.)`, `(O.C.)`, `(CONT'D)`, `(PRE-LAP)`, and `(FILTER)`.
- A transition offers `CUT TO:`, `DISSOLVE TO:`, `SMASH CUT TO:`, `MATCH CUT TO:`, `FADE IN:`, `FADE OUT.`, `FADE TO BLACK.`, and `BACK TO:`.

The list opens as the name or heading is typed. It stays inside the window, and opens above the cursor when there is more room above than below. Tab and Return accept a highlighted entry. In a character cue, Return then opens dialogue.

## The window

The title in the header is the title page title. The fields under it are the credit, the author, the draft, and the contact. The list under the fields is the acts and the scene headings, in script order. A scene shows its number. Choosing one scrolls to it. The row the cursor is in is marked.

The script is monospaced, 12 point, on US Letter. The sheet grows with the script, and the window scrolls to the later pages. The editor wraps to the element widths. A rule marks where each new page starts, at the start of the line that crosses onto that page. The status bar shows the element and the page, as `Page 2 of 40`. The status bar and the PDF share one cached page projection for the document revision.

The element the cursor is in is also named in the left margin, on that line, in grey italics. A blank line has no margin name.

A right-click on that name opens the Format menu at the pointer. The current element is marked in the menu.

An up arrow sits to the left of the scene number. Clicking it inserts an empty scene heading before that scene and puts the cursor in it.

Find is ⌘F.

Edits are saved atomically into the open folder after a short pause. Closing or switching scripts waits for the latest revision to save. A failed save leaves the earlier valid file in place and keeps the window open for retry.

## Pages

A page is US Letter. The type is a Unicode-capable monospaced font at 12 point, approximately 10 characters to the inch and 6 lines to the inch. Fifty-four lines fit under a one-inch top margin and above a one-inch bottom margin.

| Element | Left edge | Width |
|---|---|---|
| Scene Heading, Action, Shot | 1.5 in | 6.0 in |
| Character | 3.7 in | 3.8 in |
| Dialogue | 2.5 in | 3.5 in |
| Parenthetical | 3.1 in | 2.5 in |
| Transition | right edge at 7.5 in | |
| Act | centered in the 6.0 in column | |

The page number is the script page, at the right margin, half an inch from the top. The title page is not numbered and is not page 1.

A scene number is drawn on the scene heading's line, in both margins. The left number ends at 1.35 inches. The right number starts at 7.65 inches. The number is not part of the line and it is not stored.

Blank lines at the top of a page are dropped. An act starts a new page unless it is already the first element on the page. A scene heading, an act, a shot, a character, and a parenthetical move to the next page instead of standing alone at the bottom. Each keeps up to two lines of whatever follows it.

Dialogue that does not fit ends the page with `(MORE)`, centered. The next page starts with the character cue and ` (CONT'D)`, then the rest of the speech. A cue that already says `(CONT'D)` is not given a second one. Action that does not fit continues on the next page with no `(MORE)`.

The PDF is this pagination. The first page is the title page: the title, centered and underlined, then the credit, the author, and the draft. The contact sits at the lower left.

## Scenes

Scene numbers are counted from the top of the script. The first scene heading is 1. An act is not a scene and has no number. The numbers are computed. They are not written into the file.

An act names the scenes that follow it, until the next act. A scene before the first act has no act.

Export Scenes (⌘⇧L) writes a CSV, sorted by location and then by scene number.

| Column | What it is |
|---|---|
| Location | The complete, opaque scene-heading text. |
| Scene | The scene number. |
| Page | The script page containing the scene heading. The title page is not counted. |
| Act | The act in effect at that heading. |
| Actors | The character cues after the heading and before the next scene heading or act, in order. A name is listed once. An extension such as `(V.O.)` is left off. |

Text cells that begin with spreadsheet formula characters, including after leading whitespace or controls, are escaped before CSV quoting.

## What this is not

No revision marks, no cards, no dual dialogue, no locked pages, no production reports. The script is the elements, the tab and return keys, the lists, and the page.
