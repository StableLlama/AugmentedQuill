# Search and Replace

AugmentedQuill provides a project-wide **Search and Replace** tool that lets you find text across all your writing — chapter prose, metadata summaries, sourcebook entries — and replace it in bulk or one match at a time.

![Search and Replace dialog open with results grouped by section](screenshots/12_search_and_replace_dialog.png)

> **In this screenshot:** the Search and Replace dialog after a project-wide search. Results are grouped by section (chapter prose, metadata, sourcebook), and each match can be replaced individually or all at once.

---

## Opening Search & Replace

There are two ways to open the Search and Replace dialog:

- Click the **<img src="assets/search.svg" alt="Search icon" width="16" height="16" style="vertical-align:text-bottom;" /> Search** icon in the top-right toolbar.
- Press **Ctrl+F** (Windows / Linux) or **Cmd+F** (macOS) from anywhere in the app, including when the editor has focus.

## Search Options

### Case Sensitive (`Aa`)

By default, search is case-insensitive: searching for `the` also finds `The` and `THE`. Toggle **Aa** to restrict results to the exact case you typed.

### Regular Expression (`.*`)

Enable **`.*`** to use [regular expressions](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions). Examples:

| Pattern      | Matches                     |                           |
| ------------ | --------------------------- | ------------------------- |
| `\bElena\b`  | Only the whole word "Elena" |                           |
| `Elena       | Elara`                      | Either "Elena" or "Elara" |
| `Chapt(er)?` | "Chapter" or "Chapt"        |                           |
| `[0-9]+`     | Any sequence of digits      |                           |

> **Note:** Regex and Phonetic modes are mutually exclusive — enabling one disables the other.

### Phonetic (`~`)

Enable **`~`** to search by sound rather than spelling. Phonetic mode is powered by the Soundex algorithm and is ideal for finding name variants when you are not sure of the spelling:

- Searching for `Elena` also finds `Elana`, `Ellena`, `Alayna` (if they share the same Soundex code).
- Searching for `Smith` also finds `Smyth`.

Phonetic search is always case-insensitive.

---

## Search Scopes

Use the radio buttons below the options toggles to narrow the scope:

| Scope           | What is searched                                                                |
| --------------- | ------------------------------------------------------------------------------- |
| Current Chapter | Only the prose of the chapter currently open in the editor                      |
| All Chapters    | The prose of every chapter in the project                                       |
| Sourcebook      | All sourcebook entries (names, descriptions, fields)                            |
| Metadata        | Story-level and chapter-level metadata: titles, summaries, notes, conflict text |
| All _(default)_ | Everything above, globally                                                      |

---

## Navigating Results

After clicking **Find** (or pressing **Enter** in the Search field), results appear grouped by section in the lower panel.

- Each group is labelled with the section name (e.g. _Chapter 3: The Forest_, _Sourcebook_, _Story Metadata_) and a match count in parentheses.
- Click the arrow next to a group header to collapse or expand it.
- The current highlighted match is shown with a blue left-border highlight; all other matches show a yellow highlight on the matching text.
- Use the **▲ prev** and **▼ next** buttons (or the counter, e.g. `3 / 42`) to move through matches one by one.

---

## Jumping to a Match in the Editor

When the **Current Chapter** scope is active and a match belongs to the chapter currently open in the editor, clicking on that match row in the results panel scrolls the editor to the position of the match and places the cursor there.

> This only works in **Raw** and **Markdown** view modes because jump-to-position relies on character offsets in the raw text.

---

## Replace

### Replace Current

1. Type the replacement text in the **Replace** field.
2. Navigate to the match you want to change using **▲ prev** / **▼ next**.
3. Click **Replace**.

Only the currently highlighted match is replaced; the search reruns automatically so the counter stays accurate.

### Replace All

Click **Replace All** to replace every match in the current scope simultaneously. The match count updates to reflect the result (typically 0 if all replacements succeeded).

> **Caution:** Replace All modifies files on disk immediately. Use [Project Checkpoints](02_projects_and_settings.md#project-checkpoints) to save a snapshot before a mass replacement if you want an easy way to undo.

---

## Replace in Metadata

When the scope includes **Metadata** or **All**, replacements are also applied to:

- Story-level fields: summary, notes, private notes, conflict descriptions and resolutions.
- Chapter-level fields: summary, notes, private notes, conflict text.

This is especially useful when a character is renamed and you want the name updated everywhere, not only in the prose.

---

## Using Search & Replace via AI Chat

The AI assistant exposes search/replace through a single manager tool that you can invoke conversationally:

### `search_and_replace` (action=`search`)

Ask the AI to find text and it will use **`search_and_replace`** with `action="search"`:

> _"Find all mentions of Elena in my chapters."_
> _"Search for the word 'sword' across everything."_
> _"Are there any chapter summaries that reference the castle?"_

The tool returns a list of matches grouped by section, which the AI formats into a readable reply.

### `search_and_replace` (action=`replace`)

Ask the AI to rename a character or fix a recurring phrase:

> _"Rename Elena to Elara everywhere in the project."_
> _"Replace all occurrences of 'the king's sword' with 'Excalibur'."_

The tool runs a global replace and reports how many occurrences were changed and in which sections.

> **Tip:** The AI tools support the same literal and regex modes as the dialog, but not phonetic search. For phonetic name-hunting, use the dialog directly.

---

## Tips and Examples

| Goal                                       | Setting                         | Query               |
| ------------------------------------------ | ------------------------------- | ------------------- |
| Find all uses of "said"                    | Case-insensitive, All scope     | `said`              |
| Find only whole-word "King" (not "Viking") | Regex enabled                   | `\bKing\b`          |
| Find name variants of Elara                | Phonetic enabled, All scope     | `Elara`             |
| Rename a character across all chapters     | Replace All, All Chapters scope | old name → new name |
| Check if any chapter summary lacks a date  | Metadata scope                  | `[0-9]{4}`          |

---

Next up: Manage your project's visual assets in [Project Images](09_project_images.md).
