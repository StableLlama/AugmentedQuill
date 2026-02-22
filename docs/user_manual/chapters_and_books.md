# Chapters and Books

This part of AugmentedQuill keeps your narrative structure tidy: choose the right story type, keep every chapter summarized, and, for complex arcs, organize chapters into books. The sidebar lets you see each chapter, open its metadata, and cue the AI to help with summaries or conflicts.

`[SCREENSHOT: Sidebar showing story metadata on top, the chapter list, and the metadata dialog open for a selected chapter]`

## Story Types and When to Upgrade

The story type is configured from the **Projects** tab in Settings (see the [Projects and Settings](projects_and_settings.md#the-projects-tab) guide for a walkthrough). Each type controls what you can add to the sidebar:

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
- **Actions**: Hover to reveal Edit and Delete icons. Delete immediately removes the chapter after confirmation.
- **Metadata**: The edit button opens the Metadata Editor Dialog, where you can change the title, summary, notes, private notes, and—if it’s a chapter—conflict list.

The Metadata Editor Dialog auto-saves changes and exposes tabs:

- **Summary**: Public story descriptions appear in the chapter card and help the AI understand context. When it is empty, `AI Write` uses the <img src="assets/pen.svg" alt="Pen icon" width="16" height="16" style="vertical-align:text-bottom;" /> Fuchsia **EDITING** model <img src="assets/swatches/fuchsia.svg" alt="Fuchsia swatch" width="16" height="16" style="vertical-align:text-bottom;" /> to draft a summary automatically. Once a summary exists the same button turns into `AI Update`, and an adjacent `AI Rewrite` button lets you regenerate a sharper summary while still using the EDITING model.
- **Notes**: Visible to every AI call as informal prompts (brainstorming facts, world details, reminders). Use them to feed the AI extra context without cluttering public prose.
- **Private Notes**: Hidden from the AI (the dialog labels them clearly). Keep planning ideas or research there so the model never sees them.
- **Conflicts**: Chapters let you record each tension with a short description and a matching resolution plan. You can add, delete, and reorder conflicts; these remain handy references for future rewrites or for bringing a new AI chat session up to speed.

## Book Controls (Series Only)

When you switch to a series, each book renders as a collapsible panel showing the book title, the number of chapters it contains, and a summary preview. The controls include:

`[SCREENSHOT: Series view with multiple books expanded, showing Add Chapter and drag handles for books]`

- **Add Chapter**: Tap the plus icon inside a book to append a new chapter directly into that volume.
- **Edit Metadata**: The same metadata dialog used for chapters opens for books, letting you clarify the book’s focus, notes, and title.
- **Add Book**: A dashed button at the bottom of the list creates a new book. Name it, then drag it to place it before or after other books.
- **Delete Book**: Removing a book deletes every chapter inside it; a confirmation prompt reminds you of the cascade.
- **Drag to Reorder**: Both books and chapters respond to drag-and-drop, so you can reorder entire arcs without leaving the sidebar.

## Story Metadata Panel

The top of the sidebar shows the Story Metadata view with the title, summary, tags, and a compact notes preview. Click the pencil icon to open the metadata dialog and adjust the shared story information:

`[SCREENSHOT: Story Metadata panel with tags, notes, and the pencil icon highlighted]`

- **Style Tags** appear as pill chips, helping the AI keep a consistent tone (e.g., `Noir`, `Humor`).
- **Notes** and **Private Notes** keep long-form references so the AI can read (or ignore) them depending on visibility.
- **AI Summary buttons** here also use the Fuchsia EDITING model so that updating the story-wide summary behaves like editing a chapter summary.

Because every piece of metadata feeds the AI, treat the summary, tags, and notes as live prompts that get bundled into context whenever you ask the writing or chat models for help.
