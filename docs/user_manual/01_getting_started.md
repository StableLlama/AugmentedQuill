# Getting Started with AugmentedQuill

AugmentedQuill is designed to be a seamless extension of your creative process. It combines a traditional writing environment with powerful AI tools that understand your story's context.

## Core Concepts

Before diving in, it's helpful to understand how AugmentedQuill organizes your work:

- **Projects**: A project is the container for your entire book or story. It holds everything related to that specific work.
- **Story Metadata**: The overarching information about your project — the title, synopsis, style tags, and notes that guide the AI.
- **Chapters**: The actual prose of your story, broken down into manageable sections. In a series, chapters live inside books.
- **Sourcebook**: Your story's encyclopedia. This is where you keep track of characters, locations, lore, items, and other important details. The AI uses this to stay consistent.
- **Chat Assistant**: Your AI co-writer. You can brainstorm, ask for suggestions, or have it generate text based on your instructions and the context of your story.

## The Main Interface

When you open AugmentedQuill, you'll be greeted by the main writing environment. The interface is divided into three main panels plus a persistent header bar across the top:

`[SCREENSHOT: The main dashboard showing the three-panel layout: Left Sidebar, Editor, and Right Sidebar]`

1. **Left Sidebar** — Your project's control center. Scroll through it to find:
   - **Story Metadata**: The story title, summary, style tags, and LLM-visible notes at a glance. Click the <img src="assets/edit-2.svg" alt="Edit icon" width="16" height="16" style="vertical-align:text-bottom;" /> pencil icon to open the full Metadata Editor.
   - **Chapters** (or Books & Chapters in a series): The navigation list for your prose. Click any entry to open it in the editor; drag entries to reorder them.
   - **Sourcebook**: A searchable list of every character, location, and lore entry in your world.

2. **Main Area (The Editor)** — The central writing canvas. It shows the active chapter title and body, along with the AI suggestion footer at the bottom.

3. **Right Sidebar (Chat Assistant)** — Your AI co-writer. Type anything here: brainstorm a scene, ask for a critique, or request the AI to take an action (like creating a Sourcebook entry or updating your story summary).

On mobile and small tablets the left sidebar slides in from the left edge and the chat panel slides in from the right, keeping the editor full-screen until you need them.

## The Top Header Bar

A persistent bar runs across the top of the screen. From left to right it contains:

`[SCREENSHOT: The top header bar with all controls labeled: logo, undo/redo, view modes, format toolbar, Chapter AI buttons, model selectors, and right-side icons]`

### Left Section

| Control                                                                                                                                      | Description                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **☰ menu** (mobile only)                                                                                                                    | Tap the hamburger icon to open the left sidebar on small screens.                                                                   |
| **AugmentedQuill logo + project title**                                                                                                      | Click the logo or the application name to open the **Settings** dialog. The active project's name appears just below as a subtitle. |
| **Undo** (<img src="assets/edit-2.svg" alt="Edit icon" width="16" height="16" style="vertical-align:text-bottom;" /> counterclockwise arrow) | Undoes the last text change in the editor. Disabled when there is nothing left to undo.                                             |
| **Redo** (clockwise arrow)                                                                                                                   | Re-applies the last undone change. Disabled when you are already at the most recent version.                                        |

### Center Section

The center of the header packs in four groups of controls that help you write and interact with the AI. On smaller screens some groups collapse into dropdown menus so the header stays tidy.

**View Mode** — Choose how the editor displays your text:

- **Raw**: Plain-text mode for clean markdown editing with a monospace look.
- **MD**: Markdown-highlighted mode — syntax highlighting shows heading markers, bold, and italic without rendering them.
- **Visual**: WYSIWYG (What You See Is What You Get) — headings and bold text render as they would in a finished document.
- **WS** (<img src="assets/pilcrow.svg" alt="Pilcrow icon" width="16" height="16" style="vertical-align:text-bottom;" /> Pilcrow): Toggle to show invisible whitespace characters (spaces, tabs, paragraph breaks). Useful when formatting is behaving unexpectedly.

On mobile a single **View** dropdown (showing the current mode and a chevron) collapses these four options.

**Format Toolbar** — Shortcuts for common markdown formatting (visible on larger screens; available inside the Format menu on mobile):

- **B** (Bold): Wraps the selected text in `**bold**` markers.
- **I** (Italic): Wraps the selection in `_italic_` markers.
- **Link** (<img src="assets/edit-2.svg" alt="Link icon" width="16" height="16" style="vertical-align:text-bottom;" />): Inserts a `[text](url)` link skeleton.
- **H1**, **H2**, **H3**: Prepend the appropriate heading level to the selected line.
- **Quote** (blockquote icon): Inserts a `> ` blockquote prefix.
- **List** (bullet list icon): Starts an unordered `- ` list.
- **Numbered List** (numbered list icon): Starts an ordered `1. ` list.

On medium screens the heading and list buttons collapse into a **Format** dropdown (the <img src="assets/type.svg" alt="Type icon" width="16" height="16" style="vertical-align:text-bottom;" /> Type icon with chevron).

**Chapter AI** — Two quick actions that call the <img src="assets/book-open.svg" alt="Book Open icon" width="16" height="16" style="vertical-align:text-bottom;" /> <img src="assets/swatches/violet.svg" alt="Violet swatch" width="16" height="16" style="vertical-align:text-bottom;" /> [WRITING model](02_projects_and_settings.md#the-three-ai-models) on the current chapter:

- **Extend** (<img src="assets/wand.svg" alt="Wand icon" width="16" height="16" style="vertical-align:text-bottom;" />): Appends a continuation of the chapter using the story context.
- **Rewrite** (<img src="assets/file-pen.svg" alt="File Edit icon" width="16" height="16" style="vertical-align:text-bottom;" />): Regenerates the chapter body while keeping the same summary and style tags.

**Model Selectors** (visible on wide screens) — Three small dropdowns show which AI provider is assigned to each role. Click one to swap providers on the fly without opening Settings. See [Projects and Settings](02_projects_and_settings.md#the-three-ai-models) for the meaning of each role.

### Right Section

| Control                                                                                                                             | Description                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Images** (<img src="assets/eye.svg" alt="Image icon" width="16" height="16" style="vertical-align:text-bottom;" /> image icon)    | Opens the **Project Images** dialog to manage all visual assets for this project. (See [Project Images](06_project_images.md).)                                         |
| **Settings** (<img src="assets/settings.svg" alt="Settings icon" width="16" height="16" style="vertical-align:text-bottom;" />)     | Opens the Settings dialog (same as clicking the logo).                                                                                                                  |
| **Appearance** (<img src="assets/type.svg" alt="Type icon" width="16" height="16" style="vertical-align:text-bottom;" /> Type icon) | Opens the Appearance popup to adjust the visual theme, font size, and line width. (See [Appearance and Display](08_appearance_and_display.md).)                         |
| **Debug Logs** (bug icon)                                                                                                           | Opens the LLM Debug Logs overlay — a developer-focused view of all AI requests and responses. (See [Appearance and Display](08_appearance_and_display.md#debug-logs).)  |
| **Hide / AI** (panel icon)                                                                                                          | Toggles the right Chat Assistant panel open or closed. The current label flips between **Hide** (chevron-right) and **AI** (chevron-left) depending on the panel state. |

---

Next up: Learn how to manage your [Projects and Settings](02_projects_and_settings.md).
