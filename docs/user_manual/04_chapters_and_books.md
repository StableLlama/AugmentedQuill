# Chapters and Books

This part of AugmentedQuill keeps your narrative structure tidy: choose the right story type, keep every chapter summarized, and, for complex arcs, organize chapters into books. The sidebar lets you see each chapter, open its metadata, and cue the AI to help with summaries or conflicts.

`[SCREENSHOT: Sidebar showing story metadata on top, the chapter list, and the metadata dialog open for a selected chapter]`

## Story Types and When to Upgrade

The story type is configured from the **Projects** tab in Settings (see the [Projects and Settings](02_projects_and_settings.md#the-projects-tab) guide for a walkthrough). Each type controls what you can add to the sidebar:

- **Short Story**: A single chapter, no extra buttons. The UI keeps a single entry in the chapter list so you focus on polishing one complete scene.
- **Novel**: Chapters are listed as a flat sequence and you get an `Add Chapter` button above the list. Drag any entry to reorder, delete when a draft is stale, and rename the title inside each card.
- **Series**: Books become the top-level groups. Each book can contain many chapters; you can add, edit, and delete chapters per book while dragging both chapters and books to rearrange the reading order.

You can convert a project between types using the dropdown next to the active project inside the same Projects tab. Conversions that _upscale_ (short story → novel → series) are always allowed. Downsizing enforces limits so you don’t accidentally lose structure:

1. Converting from **series to novel** requires only one book. If more exist, the dropdown shows “Too many items.”
2. Converting to **short story** requires just a single chapter. Neither novels nor series with more than one chapter (or series with >1 book) can yet become short stories until you remove the extras.
3. The dropdown gives instant feedback and disables the target type when the code detects too much content (the enable/disable logic lives in the Projects tab component and mirrors the warning text you read there).

## Managing Chapters

Each chapter card in the sidebar shows the title, a short summary excerpt, and quick controls:

`[SCREENSHOT: Chapters panel with a highlighted chapter card, expand/collapse book controls, and drag handles visible]`

- **Select**: Click a card to load it into the editor. The active chapter highlights with a brighter border.
- **Drag & Drop**: Reorder chapters by dragging the cards up or down. In a series, drag within a book or across books; the UI previews the move before it actually reorders on the server.
- **Actions**: Hover to reveal the <img src="assets/edit-2.svg" alt="Edit icon" width="16" height="16" style="vertical-align:text-bottom;" /> Edit and <img src="assets/trash-2.svg" alt="Trash icon" width="16" height="16" style="vertical-align:text-bottom;" /> Delete icons. Delete immediately removes the chapter after confirmation.
- **Metadata**: The edit button opens the Metadata Editor Dialog, where you can change the title, summary, notes, private notes, and—if it’s a chapter—conflict list.

### Metadata Editor Dialog

The Metadata Editor is a full-screen or sidebar panel that opens whenever you click the <img src="assets/edit-2.svg" alt="Edit icon" width="16" height="16" style="vertical-align:text-bottom;" /> pencil icon on a chapter, book, or story item.

`[SCREENSHOT: Metadata Editor Dialog in fullscreen mode, showing the tab bar, title input, and summary textarea with AI buttons]`

**Header controls:**

| Control                                                    | Description                                                                                                                                                                                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dialog title                                               | Shows "Edit Chapter / Book / Story Metadata" depending on what you opened.                                                                                                                                                                       |
| **Save status indicator**                                  | A small badge that transitions between **Saving…** (spinning icon), **Saved** (green), and **Error saving** (red) as you type. Changes are debounced and written automatically — you don't need to click a Save button while the dialog is open. |
| **Fullscreen / Sidebar toggle** (Maximize / Minimize icon) | Switches the dialog between a fullscreen overlay and an inline panel that sits beside the sidebar. Use fullscreen when you need room to write a long summary; use sidebar mode to keep the chapter list visible.                                 |
| **Close** (✕)                                              | Saves any pending changes and closes the dialog.                                                                                                                                                                                                 |

**Title and Style Tags** (always visible above the tabs):

| Field                                    | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Title** text input                     | Editable name for the chapter, book, or story. Changing the title here updates the sidebar card immediately.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Style Tags** text input _(story only)_ | Comma-separated writing style descriptors (e.g. "Noir, Sci-Fi, Gothic"). These tags are passed to every <img src="assets/book-open.svg" alt="Book Open icon" width="16" height="16" style="vertical-align:text-bottom;" /> <img src="assets/swatches/violet.svg" alt="Violet swatch" width="16" height="16" style="vertical-align:text-bottom;" /> WRITING and <img src="assets/pen.svg" alt="Pen icon" width="16" height="16" style="vertical-align:text-bottom;" /> <img src="assets/swatches/fuchsia.svg" alt="Fuchsia swatch" width="16" height="16" style="vertical-align:text-bottom;" /> EDITING model call to keep the AI's tone consistent with your intentions. |

**Tab bar** — the four tabs control which aspect of the metadata you are editing:

**Summary tab:**

- The text area holds the public description that appears in the sidebar card and is sent to every AI call that involves this chapter or story.
- When the summary is empty, an **AI Write** button (<img src="assets/wand.svg" alt="Wand icon" width="16" height="16" style="vertical-align:text-bottom;" />) asks the <img src="assets/swatches/fuchsia.svg" alt="Fuchsia swatch" width="16" height="16" style="vertical-align:text-bottom;" /> **EDITING** model to draft a summary from the chapter content.
- Once a summary exists, the button becomes **AI Update** (<img src="assets/edit-2.svg" alt="Refresh icon" width="16" height="16" style="vertical-align:text-bottom;" />) which updates the existing text, and an adjacent **AI Rewrite** (<img src="assets/pen.svg" alt="Pen icon" width="16" height="16" style="vertical-align:text-bottom;" />) button regenerates it from scratch — useful when the story direction has changed.

**Notes tab:**

- A textarea for informal notes. These are **visible to the AI** on every call — treat them as persistent reminders, world-building details, or extra context you want the model to always know.
- The tab is labeled "Visible to LLM" to remind you of this.

**Private Notes tab:**

- A textarea for notes that are **never sent to the AI**. Use this for your personal planning: plot spoilers, character secrets you haven't revealed yet, research sources, or draft ideas you are still evaluating.
- The tab is labeled "Not visible to LLM."

**Conflicts tab** _(chapter only)_:

- Conflicts track the tensions or inconsistencies inside a chapter that still need resolving.
- **+ Add Conflict** button: Appends a new empty conflict row.
- Each conflict row contains:
  - **↑** / **↓** buttons to reorder conflicts within the list.
  - A **Conflict Description** textarea (2 rows) — write a brief statement of the problem (e.g. "Elena knows about the letter but hasn't told anyone yet").
  - A **Resolution Plan** textarea (3 rows) — note how and when the conflict will be resolved in a later chapter.
  - A <img src="assets/trash-2.svg" alt="Trash icon" width="16" height="16" style="vertical-align:text-bottom;" /> delete button to remove the row.
- Unresolved conflicts show as a **red count badge** on the chapter card in the sidebar so you can see at a glance which chapters still have open threads.

`[SCREENSHOT: Conflicts tab showing two conflict rows with description, resolution plan, and reorder arrows]`

## Book Controls (Series Only)

When you switch to a series, each book renders as a collapsible panel showing the book title, the number of chapters it contains, and a summary preview. The controls include:

`[SCREENSHOT: Series view with multiple books expanded, showing Add Chapter and drag handles for books]`

- **Add Chapter**: Tap the <img src="assets/plus.svg" alt="Plus icon" width="16" height="16" style="vertical-align:text-bottom;" /> plus icon inside a book to append a new chapter directly into that volume.
- **Edit Metadata**: The same metadata dialog used for chapters opens for books, letting you clarify the book’s focus, notes, and title.
- **Add Book**: A dashed button at the bottom of the list creates a new book (the button uses the same <img src="assets/plus.svg" alt="Plus icon" width="16" height="16" style="vertical-align:text-bottom;" /> icon). Name it, then drag it to place it before or after other books.
- **Delete Book**: Removing a book deletes every chapter inside it; a confirmation prompt (the same <img src="assets/trash-2.svg" alt="Trash icon" width="16" height="16" style="vertical-align:text-bottom;" /> icon) reminds you of the cascade.
- **Drag to Reorder**: Both books and chapters respond to drag-and-drop, so you can reorder entire arcs without leaving the sidebar.

## Story Metadata Panel

- The top of the sidebar shows the Story Metadata view with the title, summary, tags, and a compact notes preview. Click the <img src="assets/edit-2.svg" alt="Edit icon" width="16" height="16" style="vertical-align:text-bottom;" /> pencil icon to open the metadata dialog and adjust the shared story information:

`[SCREENSHOT: Story Metadata panel with tags, notes, and the pencil icon highlighted]`

- **Style Tags** appear as pill chips, helping the AI keep a consistent tone (e.g., `Noir`, `Humor`).
- **Notes** and **Private Notes** keep long-form references so the AI can read (or ignore) them depending on visibility.
- **AI Summary buttons** here also use the Fuchsia EDITING model so that updating the story-wide summary behaves like editing a chapter summary.

Because every piece of metadata feeds the AI, treat the summary, tags, and notes as live prompts that get bundled into context whenever you ask the <img src="assets/book-open.svg" alt="Book Open icon" width="16" height="16" style="vertical-align:text-bottom;" /> <img src="assets/swatches/violet.svg" alt="Violet swatch" width="16" height="16" style="vertical-align:text-bottom;" /> writing or <img src="assets/message-square.svg" alt="Message Square icon" width="16" height="16" style="vertical-align:text-bottom;" /> <img src="assets/swatches/blue.svg" alt="Blue swatch" width="16" height="16" style="vertical-align:text-bottom;" /> chat models for help.

---

Next up: Build your story's world in [The Sourcebook](05_sourcebook.md).
