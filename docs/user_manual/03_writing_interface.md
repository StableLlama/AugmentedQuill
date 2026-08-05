# The Writing Interface

The main column of AugmentedQuill is your prose studio. It shows the active chapter (title plus editable body), hosts the AI buttons that extend or rewrite the draft, and keeps suggestions, uploads, and formatting controls just within reach. The chapter and book management UI lives in the sidebar, which is described in [Chapters and Books](04_chapters_and_books.md).

![Main editor view with the Chapter AI badge visible at the top and the suggestion footer offering cards](screenshots/main.png)

> **In this screenshot:** the writing surface. The **Chapter AI** badge floats above the paper with **Extend** and **Rewrite**, and the **Suggest next paragraph** footer waits at the bottom. The header above holds view modes, formatting, and model selectors.

## Editor Workspace

The editor is a flexible canvas: when the view mode is **Visual**, the prose renders like a word processor; when it is **Markdown** or **Raw**, you edit the UTF-8 markdown directly.

### Starting State

When you first open a project or have no chapter selected, the editor shows a centered placeholder with the AugmentedQuill logo and the message "Select or create a chapter to start writing." Use the left sidebar to click an existing chapter or create a new one to begin.

### Chapter Title

At the top of the paper area is an editable **chapter title** field rendered in a large serif font. Click it to place the cursor and type freely. The title is saved automatically as you type and appears in the sidebar chapter list.

### Chapter Body

Below the title is the main text area. All three view modes share the same font, line height, and page width; the only difference is how the markdown source is rendered:

- **Raw mode**: The markdown source is shown as-is in a monospace font. Every `#`, `**`, and `_` marker is visible.
- **MD (Markdown) mode**: Syntax highlighting colors heading markers, bold, italic, and other markdown tokens without rendering them — a good middle ground for writers who also care about the raw source.
- **Visual (WYSIWYG) mode**: Headings appear as large text, bold is bold, and you can edit as if you were in a traditional word processor.

You can switch modes at any time without losing data; the underlying markdown file is always the source of truth.

### Dropping Images Into the Editor

Drag an image file (PNG, JPEG, GIF, WEBP) and drop it onto the editor paper area. A highlighted drop zone appears while the image is being dragged over. On release, the image uploads to the server and an inline markdown image tag (`![title](url)`) is inserted at the current cursor position. You can manage all project images from the **Project Images** dialog (see [Project Images](09_project_images.md)).

---

## Top Bar Controls

The condensed bar above the editor holds view toggles, formatting helpers, AI buttons, and the <img src="assets/book-open.svg" alt="Book Open icon" width="16" height="16" style="vertical-align:text-bottom;" /> <img src="assets/swatches/violet.svg" alt="Violet swatch" width="16" height="16" style="vertical-align:text-bottom;" /> WRITING / <img src="assets/pen.svg" alt="Pen icon" width="16" height="16" style="vertical-align:text-bottom;" /> <img src="assets/swatches/fuchsia.svg" alt="Fuchsia swatch" width="16" height="16" style="vertical-align:text-bottom;" /> EDITING / <img src="assets/message-square.svg" alt="Message Square icon" width="16" height="16" style="vertical-align:text-bottom;" /> <img src="assets/swatches/blue.svg" alt="Blue swatch" width="16" height="16" style="vertical-align:text-bottom;" /> CHAT model selectors. On desktop the buttons are exposed; smaller screens wrap the view and formatting controls inside expandable menus so the same commands stay within reach.

![Top header bar focused on the center section: view toggles, format toolbar, Chapter AI, and model selectors](screenshots/main.png)

### View and Whitespace

From left to right, you can pick between `Raw` (<img src="assets/file-text.svg" alt="File Text icon" width="16" height="16" style="vertical-align:text-bottom;" /> File Text), `MD` (<img src="assets/code.svg" alt="Code icon" width="16" height="16" style="vertical-align:text-bottom;" /> Code), and `Visual` (<img src="assets/eye.svg" alt="Eye icon" width="16" height="16" style="vertical-align:text-bottom;" /> Eye) modes or toggle whitespace visibility with the <img src="assets/pilcrow.svg" alt="Pilcrow icon" width="16" height="16" style="vertical-align:text-bottom;" /> Pilcrow `WS`. On mobile and tablets these options share a single View menu (the <img src="assets/chevron-down.svg" alt="Chevron Down icon" width="16" height="16" style="vertical-align:text-bottom;" /> ChevronDown icon shows the current mode) so you can still pick any mode without crowding the header.

### Formatting Tools

Next along the bar are the text-formatting shortcuts:

| Button            | Effect                                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **B** Bold        | Wraps the selection in `**...**` or bold-formats it in Visual mode.                                                                    |
| **I** Italic      | Wraps the selection in `_..._` or italic-formats it.                                                                                   |
| **Image**         | Opens the project image picker; inserts an `![alt](url)` image tag at the cursor.                                                      |
| **H1**            | Applies a top-level heading (`# `) to the selected line.                                                                               |
| **H2**            | Applies a second-level heading (`## `).                                                                                                |
| **H3**            | Applies a third-level heading (`### `).                                                                                                |
| **List**          | Starts an unordered list with `- `.                                                                                                    |
| **Numbered List** | Starts an ordered list with `1. `.                                                                                                     |
| **Quote**         | Prepends `> ` to turn the line into a blockquote.                                                                                      |
| **Link**          | Inserts a `[text](url)` hyperlink at the cursor.                                                                                       |
| **Footnote**      | Inserts a numbered footnote reference `[^n]` at the cursor and appends a matching `[^n]: (footnote text)` definition block at the end. |
| **Code Block**    | Wraps the selection (or inserts an empty block) in a fenced code block ` ``` … ``` ` for multi-line preformatted text.                 |
| **Subscript**     | Wraps the selection in `~…~` (e.g., `H~2~O` → H₂O). Mutually exclusive with superscript at the same position.                          |
| **Superscript**   | Wraps the selection in `^…^` (e.g., `E=mc^2^` → E=mc²). Mutually exclusive with subscript at the same position.                        |
| **Strikethrough** | Wraps the selection in `~~…~~` for struck-through text.                                                                                |

Buttons are ordered by frequency of use. On narrower screens the less common ones (Strikethrough, Superscript, Subscript, Code Block, Footnote, Link, Quote, then List buttons) progressively collapse into the **Format** dropdown (<img src="assets/type.svg" alt="Type icon" width="16" height="16" style="vertical-align:text-bottom;" /> Type icon + dropdown). On mobile all formatting controls move into the mobile Format menu. A button highlights when its style is currently active at the cursor, providing instant feedback.

### Icon Reference

The application UI uses the following core icons. This reference is kept aligned with the live interface; add entries here whenever new icons are introduced.

| Icon                                                                                                                             | Name             | Meaning                                       |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------- |
| <img src="assets/book-open.svg" alt="Book Open icon" width="16" height="16" style="vertical-align:text-bottom;" />               | book-open        | WRITING model / prose actions                 |
| <img src="assets/pen.svg" alt="Pen icon" width="16" height="16" style="vertical-align:text-bottom;" />                           | pen              | EDITING model / summary actions               |
| <img src="assets/message-square.svg" alt="Message Square icon" width="16" height="16" style="vertical-align:text-bottom;" />     | message-square   | CHAT model                                    |
| <img src="assets/eye.svg" alt="Eye icon" width="16" height="16" style="vertical-align:text-bottom;" />                           | eye              | Images / Vision capability                    |
| <img src="assets/type.svg" alt="Type icon" width="16" height="16" style="vertical-align:text-bottom;" />                         | type             | Format menu toggle                            |
| <img src="assets/wand.svg" alt="Wand icon" width="16" height="16" style="vertical-align:text-bottom;" />                         | wand             | Chapter AI action (extend/rewrite)            |
| <img src="assets/wand-2.svg" alt="Wand2 icon" width="16" height="16" style="vertical-align:text-bottom;" />                      | wand-2           | Model capability indicator (function calling) |
| <img src="assets/swatches/violet.svg" alt="Violet mark" width="16" height="16" style="vertical-align:text-bottom;" />            | swatch-violet    | WRITING role color                            |
| <img src="assets/swatches/fuchsia.svg" alt="Fuchsia mark" width="16" height="16" style="vertical-align:text-bottom;" />          | swatch-fuchsia   | EDITING role color                            |
| <img src="assets/swatches/blue.svg" alt="Blue mark" width="16" height="16" style="vertical-align:text-bottom;" />                | swatch-blue      | CHAT role color                               |
| <img src="assets/plus.svg" alt="Plus icon" width="16" height="16" style="vertical-align:text-bottom;" />                         | plus             | Add / new item                                |
| <img src="assets/edit-2.svg" alt="Edit icon" width="16" height="16" style="vertical-align:text-bottom;" />                       | edit-2           | Edit item                                     |
| <img src="assets/trash-2.svg" alt="Trash icon" width="16" height="16" style="vertical-align:text-bottom;" />                     | trash-2          | Delete item                                   |
| <img src="assets/settings.svg" alt="Settings icon" width="16" height="16" style="vertical-align:text-bottom;" />                 | settings         | Main settings                                 |
| <img src="assets/settings-2.svg" alt="Settings2 icon" width="16" height="16" style="vertical-align:text-bottom;" />              | settings-2       | Chat settings                                 |
| <img src="assets/globe.svg" alt="Globe icon" width="16" height="16" style="vertical-align:text-bottom;" />                       | globe            | Web search                                    |
| <img src="assets/ghost.svg" alt="Ghost icon" width="16" height="16" style="vertical-align:text-bottom;" />                       | ghost            | Incognito chat                                |
| <img src="assets/history.svg" alt="History icon" width="16" height="16" style="vertical-align:text-bottom;" />                   | history          | Chat history                                  |
| <img src="assets/save.svg" alt="Save icon" width="16" height="16" style="vertical-align:text-bottom;" />                         | save             | Save/checkpoint                               |
| <img src="assets/search.svg" alt="Search icon" width="16" height="16" style="vertical-align:text-bottom;" />                     | search           | Search                                        |
| <img src="assets/link.svg" alt="Link icon" width="16" height="16" style="vertical-align:text-bottom;" />                         | link             | Insert link                                   |
| <img src="assets/download.svg" alt="Download icon" width="16" height="16" style="vertical-align:text-bottom;" />                 | download         | Export ZIP                                    |
| <img src="assets/chevron-down.svg" alt="Chevron Down icon" width="16" height="16" style="vertical-align:text-bottom;" />         | chevron-down     | Dropdown indicator                            |
| <img src="assets/chevron-right.svg" alt="Chevron Right icon" width="16" height="16" style="vertical-align:text-bottom;" />       | chevron-right    | Collapsible sections                          |
| <img src="assets/refresh-cw.svg" alt="Refresh icon" width="16" height="16" style="vertical-align:text-bottom;" />                | refresh-cw       | Regenerate / refresh                          |
| <img src="assets/x.svg" alt="X icon" width="16" height="16" style="vertical-align:text-bottom;" />                               | x                | Close/cancel                                  |
| <img src="assets/arrow-right.svg" alt="Arrow Right icon" width="16" height="16" style="vertical-align:text-bottom;" />           | arrow-right      | Navigate / accept                             |
| <img src="assets/arrow-right-left.svg" alt="Arrow Right Left icon" width="16" height="16" style="vertical-align:text-bottom;" /> | arrow-right-left | Switch context                                |
| <img src="assets/alert-triangle.svg" alt="Alert Triangle icon" width="16" height="16" style="vertical-align:text-bottom;" />     | alert-triangle   | Warning / invalid input                       |

### Supported Markdown Elements

All chapter content is stored as CommonMark-compatible markdown with GFM extensions and a few custom inline extensions. The complete set of elements rendered in Visual mode and previewed in MD mode is shown below. Elements marked **toolbar** have a dedicated button; the rest can be typed directly in Raw or MD mode.

#### Inline elements

| Syntax                                  | Result                           | Toolbar |
| --------------------------------------- | -------------------------------- | ------- |
| `**bold**` or `__bold__`                | **bold**                         | ✓       |
| `_italic_` or `*italic*`                | _italic_                         | ✓       |
| `~~strikethrough~~`                     | ~~strikethrough~~                | ✓       |
| `~subscript~`                           | H₂O                              | ✓       |
| `^superscript^`                         | E=mc²                            | ✓       |
| `` `inline code` ``                     | `inline code`                    | —       |
| `[link text](https://example.com)`      | [link text](https://example.com) | ✓       |
| `![alt text](image-url)`                | (rendered image)                 | ✓       |
| `[^1]` (reference) + `[^1]: text` (def) | Footnote¹                        | ✓       |

#### Block elements

| Syntax                             | Result                  | Toolbar |
| ---------------------------------- | ----------------------- | ------- |
| `# Heading 1`                      | Large heading           | ✓       |
| `## Heading 2`                     | Medium heading          | ✓       |
| `### Heading 3`                    | Small heading           | ✓       |
| `> blockquote`                     | Indented quote block    | ✓       |
| `- item` or `* item`               | Unordered (bullet) list | ✓       |
| `1. item`                          | Ordered (numbered) list | ✓       |
| ` ``` ` … ` ``` `                  | Fenced code block       | ✓       |
| `\| col \| col \|` + separator row | Table (GFM)             | —       |

Tables follow standard GFM format: a header row, a separator row (`| --- | --- |`), and one or more data rows. Column alignment markers (`:---`, `:---:`, `---:`) are also supported.

### Chapter AI (AI Actions)

The **Chapter AI** badge on the right side of the center bar exposes two quick actions that call the <img src="assets/swatches/violet.svg" alt="Violet swatch" width="16" height="16" style="vertical-align:text-bottom;" /> **WRITING** model directly on the open chapter:

- **Extend** (<img src="assets/wand.svg" alt="Wand icon" width="16" height="16" style="vertical-align:text-bottom;" />): Appends new prose to the end of the current chapter, continuing from where you left off. The AI uses the story summary, style tags, and your Sourcebook entries as context. The button is disabled while the model is generating, and a spinner replaces it until the text appears.
- **Rewrite** (<img src="assets/file-pen.svg" alt="File Edit icon" width="16" height="16" style="vertical-align:text-bottom;" />): Re-generates the entire chapter body using the same summary and style tags. Use this when you want a fresh take on a scene without changing its purpose or structure.

On mobile and tablet, the same Extend and Rewrite buttons appear in a small toolbar directly above the editor paper area so they remain accessible without scrolling back to the header.

### Model Selectors

On wide screens, three small dropdowns appear at the far right of the center bar, one for each AI role:

- **Writing** (<img src="assets/swatches/violet.svg" alt="Violet swatch" width="16" height="16" style="vertical-align:text-bottom;" /> Violet)
- **Editing** (<img src="assets/swatches/fuchsia.svg" alt="Fuchsia swatch" width="16" height="16" style="vertical-align:text-bottom;" /> Fuchsia)
- **Chat** (<img src="assets/swatches/blue.svg" alt="Blue swatch" width="16" height="16" style="vertical-align:text-bottom;" /> Blue)

Each dropdown button shows a colored status dot (green = connected, red = failed) and the provider's name. Click it to swap providers instantly without opening Settings. If the selected provider supports image input (<img src="assets/eye.svg" alt="Eye icon" width="16" height="16" style="vertical-align:text-bottom;" /> Vision icon) or function calling (<img src="assets/wand.svg" alt="Wand icon" width="16" height="16" style="vertical-align:text-bottom;" /> Wand icon), small indicators appear beside the name. Configure providers in [Machine Settings](02_projects_and_settings.md#the-machine-settings-tab).

### Model Settings Popup

On narrower wide screens — or whenever the inline selectors are not shown — the same three role selectors are tucked behind a single **Models** button in the center bar (tooltip: _Model settings_), shown as a CPU icon with a <img src="assets/chevron-down.svg" alt="Chevron down icon" width="16" height="16" style="vertical-align:text-bottom;" /> chevron.

- Click **Models** to open a small popup listing the three roles — **Writing** (<img src="assets/swatches/violet.svg" alt="Violet swatch" width="16" height="16" style="vertical-align:text-bottom;" /> Violet), **Editing** (<img src="assets/swatches/fuchsia.svg" alt="Fuchsia swatch" width="16" height="16" style="vertical-align:text-bottom;" /> Fuchsia) and **Chat** (<img src="assets/swatches/blue.svg" alt="Blue swatch" width="16" height="16" style="vertical-align:text-bottom;" /> Blue) — stacked vertically.
- Each row is the same dropdown selector described in [Model Selectors](#model-selectors): a colored status dot (green = connected, red = unreachable, spinner = testing), the provider's name, and small capability icons when supported.
- Pick a provider from any row to instantly reassign that role, exactly as you would from the inline selectors; the change applies immediately and is saved with your app settings.
- Clicking a row also triggers a connectivity re-check for that provider, so the status dot stays fresh.

Clicking **Models** again (or clicking elsewhere) closes the popup. Adding, removing, or editing the underlying providers is still done in [Machine Settings](02_projects_and_settings.md#the-machine-settings-tab).

---

## AI Writing Tools (<img src="assets/book-open.svg" alt="Book Open icon" width="16" height="16" style="vertical-align:text-bottom;" /> WRITING Model <img src="assets/swatches/violet.svg" alt="Violet swatch" width="16" height="16" style="vertical-align:text-bottom;" />)

All three writing-focused actions — Extend, Rewrite, and Suggest — use the **WRITING** model (<img src="assets/book-open.svg" alt="Book Open icon" width="16" height="16" style="vertical-align:text-bottom;" /> Book Open, <img src="assets/swatches/violet.svg" alt="Violet swatch" width="16" height="16" style="vertical-align:text-bottom;" /> Violet) explained in the machine settings guide. The action buttons live in the floating toolbar and the persistent footer, so they are always available even as you scroll.

![Chapter AI badge showing Extend and Rewrite on a light background plus the Suggest button in the footer](screenshots/03_chapter_ai.png)

> **In this screenshot:** the three AI writing tools — **Extend** and **Rewrite** in the floating badge, and **Suggest next paragraph** in the footer — all powered by the WRITING model.

### Extend Chapter

The first Chapter AI button is `Extend` with the <img src="assets/wand.svg" alt="Wand icon" width="16" height="16" style="vertical-align:text-bottom;" /> Wand icon. Clicking it asks the <img src="assets/book-open.svg" alt="Book Open icon" width="16" height="16" style="vertical-align:text-bottom;" /> <img src="assets/swatches/violet.svg" alt="Violet swatch" width="16" height="16" style="vertical-align:text-bottom;" /> WRITING model to continue from the end of the current chapter, injecting new prose while keeping existing formatting and style tags intact. The button is disabled while the model is processing, and a spinner appears until the new text is appended.

### Rewrite Chapter

Next to Extend is `Rewrite`, decorated with the <img src="assets/file-pen.svg" alt="File Edit icon" width="16" height="16" style="vertical-align:text-bottom;" /> File Edit icon. Unlike a simple grammar pass, Rewrite asks the <img src="assets/book-open.svg" alt="Book Open icon" width="16" height="16" style="vertical-align:text-bottom;" /> <img src="assets/swatches/violet.svg" alt="Violet swatch" width="16" height="16" style="vertical-align:text-bottom;" /> WRITING model to re-generate the chapter content entirely using the story summary, style tags, sourcebook context, and chapter metadata included in that request. This makes it easy to reset the voice or framing of a chapter while retaining the story structure.

### Suggest Next Paragraph

![The suggestion footer open with two or three continuation cards and the Dismiss button](screenshots/03_continuation.png)

> **In this screenshot:** the continuation pane open. Each card is a different way to continue your scene — click one to insert it at the cursor, or press **Dismiss** to keep your draft untouched.

At the bottom of the editor sits the pulsing `Suggest next paragraph` pill with the <img src="assets/sparkles.svg" alt="Sparkles icon" width="16" height="16" style="vertical-align:text-bottom;" /> Sparkles icon. Click it to open the **continuation pane**. The <img src="assets/book-open.svg" alt="Book Open icon" width="16" height="16" style="vertical-align:text-bottom;" /> <img src="assets/swatches/violet.svg" alt="Violet swatch" width="16" height="16" style="vertical-align:text-bottom;" /> WRITING model generates two or more short continuation options, each shown as a card. Click any card to insert that text at the cursor and close the pane, or press **Dismiss** to discard all suggestions without changing your draft.

While suggestions are still generating, the button shows a spinner and the word "Working…" The suggestion cards appear as they stream in, so you may see partial text before generation finishes.

### Suggestion Mode Selector

To the right of the **Suggest next paragraph** control, a mode selector lets you choose how much context the <img src="assets/book-open.svg" alt="Book Open icon" width="16" height="16" style="vertical-align:text-bottom;" /> <img src="assets/swatches/violet.svg" alt="Violet swatch" width="16" height="16" style="vertical-align:text-bottom;" /> WRITING model receives:

- **Guided**: Uses full story and chapter context and applies stronger guidance for continuation quality.
- **Instructed**: Uses full story and chapter context with an explicit "write the immediate next paragraph" instruction.
- **Pure**: Uses only the current chapter text, with no extra story/chapter context.

You can change the mode before requesting suggestions and also while the suggestion pane is open.

Suggestion quality is controlled by the active **WRITING provider** settings in **Machine Settings**:

- **Suggestion Loop Guard** (On/Off)
- **Loop N-gram** (3-gram or 4-gram)
- **Min Repeats**
- **Max Regenerations**

If the end of a suggested paragraph looks weak or repetitive, keep Loop Guard enabled and increase **Max Regenerations** by one step.

**Keyboard shortcuts for suggestions:**

| Key                        | Action                                                         |
| -------------------------- | -------------------------------------------------------------- |
| `Ctrl+Enter` / `Cmd+Enter` | Trigger the suggestion pane at the current cursor position.    |
| `←` / `→` Arrow keys       | Cycle through the available continuation options.              |
| `↓` Arrow key              | Request a new set of suggestions (regenerate).                 |
| `↑` Arrow key              | Undo the last accepted suggestion (removes the inserted text). |
| `Escape`                   | Close the suggestion pane without inserting any text.          |

---

## Summary AI Controls (<img src="assets/pen.svg" alt="Pen icon" width="16" height="16" style="vertical-align:text-bottom;" /> EDITING Model <img src="assets/swatches/fuchsia.svg" alt="Fuchsia swatch" width="16" height="16" style="vertical-align:text-bottom;" />)

The summary tab inside the Metadata Editor dialog (covered in [Chapters and Books](04_chapters_and_books.md)) exposes `AI Write`, `AI Update`, and `AI Rewrite` buttons. They use the <img src="assets/pen.svg" alt="Pen icon" width="16" height="16" style="vertical-align:text-bottom;" /> Fuchsia **EDITING** model <img src="assets/swatches/fuchsia.svg" alt="Fuchsia swatch" width="16" height="16" style="vertical-align:text-bottom;" /> to craft concise descriptions, tweak tone, or polish the storytelling focus without touching the chapter body.

These controls update the planning layer around a chapter rather than the prose itself. The summaries they produce help CHAT steer the project and help WRITING stay aligned when it generates new text.

![Metadata summary tab with AI Write/Update/Rewrite buttons highlighted](screenshots/03_metadata_summary.png)

> **In this screenshot:** the Metadata Editor's Summary tab. **AI Write** drafts a summary from your chapter, then becomes **AI Update** and **AI Rewrite** once text exists.

---

## Keyboard and Flow Tips

- `Ctrl+Enter`/`Cmd+Enter` is the quickest way to open suggestions; you never have to reach for the mouse.
- The suggestion pane always shows the last set of continuations, so you can keep requesting more or hit `Dismiss` once you are satisfied.
- Even when AI actions are running, you can keep typing because the UI disables only the relevant button and leaves the rest of the editor responsive.
- Switch between Raw, MD, and Visual modes freely — the underlying file is the same markdown source regardless of which view you use.
- Press **Ctrl+F** (or **Cmd+F** on macOS) at any time — or click the **<img src="assets/search.svg" alt="Search icon" width="16" height="16" style="vertical-align:text-bottom;" /> Search** icon in the top-right header — to open the project-wide **Search and Replace** dialog. See [Search and Replace](08_search_and_replace.md) for the full guide.

---

Next up: Learn how to organize your story structure in [Chapters and Books](04_chapters_and_books.md).
