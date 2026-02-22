# The Writing Interface

The main column of AugmentedQuill is your prose studio. It shows the active chapter (title plus editable body), hosts the AI buttons that extend or rewrite the draft, and keeps suggestions, uploads, and formatting controls just within reach. The chapter and book management UI lives in the sidebar, which is described in [Chapters and Books](04_chapters_and_books.md).

`[SCREENSHOT: Main editor view with the Chapter AI badge visible at the top and the suggestion footer offering cards]`

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

Drag an image file (PNG, JPEG, GIF, WEBP) and drop it onto the editor paper area. A highlighted drop zone appears while the image is being dragged over. On release, the image uploads to the server and an inline markdown image tag (`![title](url)`) is inserted at the current cursor position. You can manage all project images from the **Project Images** dialog (see [Project Images](06_project_images.md)).

---

## Top Bar Controls

The condensed bar above the editor holds view toggles, formatting helpers, AI buttons, and the <img src="assets/book-open.svg" alt="Book Open icon" width="16" height="16" style="vertical-align:text-bottom;" /> <img src="assets/swatches/violet.svg" alt="Violet swatch" width="16" height="16" style="vertical-align:text-bottom;" /> WRITING / <img src="assets/pen.svg" alt="Pen icon" width="16" height="16" style="vertical-align:text-bottom;" /> <img src="assets/swatches/fuchsia.svg" alt="Fuchsia swatch" width="16" height="16" style="vertical-align:text-bottom;" /> EDITING / <img src="assets/message-square.svg" alt="Message Square icon" width="16" height="16" style="vertical-align:text-bottom;" /> <img src="assets/swatches/blue.svg" alt="Blue swatch" width="16" height="16" style="vertical-align:text-bottom;" /> CHAT model selectors. On desktop the buttons are exposed; smaller screens wrap the view and formatting controls inside expandable menus so the same commands stay within reach.

`[SCREENSHOT: Top header bar focused on the center section: view toggles, format toolbar, Chapter AI, and model selectors]`

### View and Whitespace

From left to right, you can pick between `Raw` (<img src="assets/file-text.svg" alt="File Text icon" width="16" height="16" style="vertical-align:text-bottom;" /> File Text), `MD` (<img src="assets/code.svg" alt="Code icon" width="16" height="16" style="vertical-align:text-bottom;" /> Code), and `Visual` (<img src="assets/eye.svg" alt="Eye icon" width="16" height="16" style="vertical-align:text-bottom;" /> Eye) modes or toggle whitespace visibility with the <img src="assets/pilcrow.svg" alt="Pilcrow icon" width="16" height="16" style="vertical-align:text-bottom;" /> Pilcrow `WS`. On mobile and tablets these options share a single View menu (the <img src="assets/chevron-down.svg" alt="Chevron Down icon" width="16" height="16" style="vertical-align:text-bottom;" /> ChevronDown icon shows the current mode) so you can still pick any mode without crowding the header.

### Formatting Tools

Next along the bar are the text-formatting shortcuts:

| Button            | Effect                                                              |
| ----------------- | ------------------------------------------------------------------- |
| **B** Bold        | Wraps the selection in `**...**` or bold-formats it in Visual mode. |
| **I** Italic      | Wraps the selection in `_..._` or italic-formats it.                |
| **Link**          | Inserts a `[text](url)` link template at the cursor.                |
| **H1**            | Applies a top-level heading (`# `) to the selected line.            |
| **H2**            | Applies a second-level heading (`## `).                             |
| **H3**            | Applies a third-level heading (`### `).                             |
| **Quote**         | Prepends `> ` to turn the line into a blockquote.                   |
| **List**          | Starts an unordered list with `- `.                                 |
| **Numbered List** | Starts an ordered list with `1. `.                                  |

Bold, Italic, and Link are always visible. Heading, Blockquote, and List helpers show up on larger breakpoints and inside the mobile Format menu (<img src="assets/type.svg" alt="Type icon" width="16" height="16" style="vertical-align:text-bottom;" /> Type icon + dropdown). A button highlights when its style is currently active at the cursor, providing instant feedback.

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

---

## AI Writing Tools (<img src="assets/book-open.svg" alt="Book Open icon" width="16" height="16" style="vertical-align:text-bottom;" /> WRITING Model <img src="assets/swatches/violet.svg" alt="Violet swatch" width="16" height="16" style="vertical-align:text-bottom;" />)

All three writing-focused actions — Extend, Rewrite, and Suggest — use the **WRITING** model (<img src="assets/book-open.svg" alt="Book Open icon" width="16" height="16" style="vertical-align:text-bottom;" /> Book Open, <img src="assets/swatches/violet.svg" alt="Violet swatch" width="16" height="16" style="vertical-align:text-bottom;" /> Violet) explained in the machine settings guide. The action buttons live in the floating toolbar and the persistent footer, so they are always available even as you scroll.

`[SCREENSHOT: Chapter AI badge showing Extend and Rewrite on a light background plus the Suggest button in the footer]`

### Extend Chapter

The first Chapter AI button is `Extend` with the <img src="assets/wand.svg" alt="Wand icon" width="16" height="16" style="vertical-align:text-bottom;" /> Wand icon. Clicking it asks the <img src="assets/book-open.svg" alt="Book Open icon" width="16" height="16" style="vertical-align:text-bottom;" /> <img src="assets/swatches/violet.svg" alt="Violet swatch" width="16" height="16" style="vertical-align:text-bottom;" /> WRITING model to continue from the end of the current chapter, injecting new prose while keeping existing formatting and style tags intact. The button is disabled while the model is processing, and a spinner appears until the new text is appended.

### Rewrite Chapter

Next to Extend is `Rewrite`, decorated with the <img src="assets/file-pen.svg" alt="File Edit icon" width="16" height="16" style="vertical-align:text-bottom;" /> File Edit icon. Unlike a simple grammar pass, Rewrite asks the <img src="assets/book-open.svg" alt="Book Open icon" width="16" height="16" style="vertical-align:text-bottom;" /> <img src="assets/swatches/violet.svg" alt="Violet swatch" width="16" height="16" style="vertical-align:text-bottom;" /> WRITING model to re-generate the chapter content entirely (using the same summary and style tags it already knows). This makes it easy to reset the voice or framing of a chapter while retaining the story structure.

### Suggest Next Paragraph

`[SCREENSHOT: The suggestion footer open with two or three continuation cards and the Dismiss button]`

At the bottom of the editor sits the pulsing `Suggest next paragraph` pill with the <img src="assets/sparkles.svg" alt="Sparkles icon" width="16" height="16" style="vertical-align:text-bottom;" /> Sparkles icon. Click it to open the **continuation pane**. The <img src="assets/book-open.svg" alt="Book Open icon" width="16" height="16" style="vertical-align:text-bottom;" /> <img src="assets/swatches/violet.svg" alt="Violet swatch" width="16" height="16" style="vertical-align:text-bottom;" /> WRITING model generates two or more short continuation options, each shown as a card. Click any card to insert that text at the cursor and close the pane, or press **Dismiss** to discard all suggestions without changing your draft.

While suggestions are still generating, the button shows a spinner and the word "Working…" The suggestion cards appear as they stream in, so you may see partial text before generation finishes.

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

`[SCREENSHOT: Metadata summary tab with AI Write/Update/Rewrite buttons highlighted]`

---

## Keyboard and Flow Tips

- `Ctrl+Enter`/`Cmd+Enter` is the quickest way to open suggestions; you never have to reach for the mouse.
- The suggestion pane always shows the last set of continuations, so you can keep requesting more or hit `Dismiss` once you are satisfied.
- Even when AI actions are running, you can keep typing because the UI disables only the relevant button and leaves the rest of the editor responsive.
- Switch between Raw, MD, and Visual modes freely — the underlying file is the same markdown source regardless of which view you use.

---

Next up: Learn how to organize your story structure in [Chapters and Books](04_chapters_and_books.md).
