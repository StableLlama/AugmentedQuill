# The Sourcebook

The Sourcebook is your story's encyclopedia. It is crucial for keeping both you and the AI consistent. When you ask the AI to generate text or brainstorm, it references the Sourcebook to ensure it uses the right names, places, and rules of your world.

![The Sourcebook panel in the left sidebar showing a list of entries with category icons and the search filter field](screenshots/05_sourcebook_panel.png)

## Sourcebook Browser

The Sourcebook list lives at the bottom of the left sidebar, below the chapter list. It shows every entry in the current project as a scrollable list. Each row displays the category icon, the entry name, and (on hover) a floating preview tooltip with the description excerpt and associated image.

| Control                         | Description                                                                                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **+** (Plus icon) in the header | Opens the **Sourcebook Entry Dialog** to create a new entry.                                                                                                                |
| **Auto** checkbox in header     | Turns automatic sourcebook relevance selection on or off. When enabled, a background AI helper updates which entries are checked based on the chapter text.                 |
| **Spinning icon** next to Auto  | Appears while the automatic relevance helper is running.                                                                                                                    |
| **Search / filter** text field  | Type to filter the list in real time by name, category name, or any synonym. Useful in large world-building projects with dozens or hundreds of entries.                    |
| **Entry row** (click)           | Opens the entry in the Sourcebook Entry Dialog for editing.                                                                                                                 |
| **Include/Exclude** (Checkbox)  | Toggle whether this entry is explicitly included in the AI context. These checkboxes are disabled (greyed out) while **Auto** is enabled, but still show current selection. |
| **Hover tooltip**               | Appears automatically when you hover an entry — shows the category badge, description preview, and primary image thumbnail (if any) without opening the full dialog.        |

> **In this screenshot:** hover any entry to preview it without opening the editor. The floating card shows the entry's category badge, a short description excerpt, and — when the entry has one — its linked image. Here, hovering **Nora** reveals her portrait.

![Hover card previewing the Nora entry with its linked portrait, category badge, and description](screenshots/05_sourcebook_hover.png)

When the AI chat assistant creates or updates a Sourcebook entry, the app can surface that change immediately and open the relevant entry for review. This helps you inspect and refine AI-generated lore without losing your place in the writing workflow.

---

## Categories

Every Sourcebook entry belongs to one of seven categories. The category is shown as an icon on each row and as a colored badge inside the entry dialog.

| Category         | Icon                | What belongs here                                                                                                                                                    |
| ---------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Character**    | Person silhouette   | Any person, creature, or conscious being — protagonist, antagonist, side character, or faction member. Include personality, backstory, appearance, and motivations.  |
| **Location**     | Map pin             | Places that appear in the story — cities, rooms, planets, ruins, forests. Include sensory details and any rules that govern the place (e.g. forbidden to outsiders). |
| **Organization** | Building/group icon | Guilds, factions, companies, governments, cults — any named group with shared goals. Include hierarchy, goals, and relationship to other groups.                     |
| **Item**         | Package             | Objects that matter to the story — artifacts, weapons, heirlooms, macguffins. Include appearance, powers or restrictions, and current owner.                         |
| **Event**        | Calendar/clock      | Key historical or in-story events (wars, prophecies, past traumas) that characters reference or that shape the world.                                                |
| **Lore**         | Scroll/book         | World rules, magic systems, religions, languages, or any abstract knowledge that the AI should respect when generating text.                                         |
| **Other**        | Ellipsis            | Anything that doesn't fit the above categories.                                                                                                                      |

The category selector inside the entry dialog shows a short description of each category when you hover it, helping you choose consistently.

---

## Entry Dialog

The Sourcebook Entry Dialog opens when you create a new entry or click an existing one.

![The Sourcebook Entry Dialog showing name field, category grid, synonyms, associated images, and description textarea](screenshots/05_sourcebook_entry_dialog.png)

### Name and Category

- **Name** text field: The canonical label for this entry (e.g. "Captain Ahab"). This is the primary name the AI will use when referring to this entity.
- **Category selector**: A seven-button grid. The selected category highlights with a colored background and a subtle ring. A short description below the grid explains what belongs in the chosen category.

### Synonyms and Nicknames

The Synonyms section shows existing synonyms as removable pill chips. Synonyms serve two purposes:

1. The search bar matches them, so you can find "Ahab" even if the canonical name is "Captain Ahab".
2. The AI is made aware that these are alternative names for the same entity.

- Click the **✕** on any pill to remove a synonym.
- Type a new synonym in the inline input field and press **Enter** to add it.

### Associated Images

This panel shows thumbnail images currently linked to this entry. Use images to give yourself (and the AI) a visual reference for the entry.

- **Manage Images** button (<img src="assets/plus.svg" alt="ImagePlus icon" width="16" height="16" style="vertical-align:text-bottom;" />): Opens the **Image Picker** sub-modal (see below).
- Hover a selected image thumbnail and click the **✕** overlay to remove that association without deleting the image.

### Description & Facts

A large, resizable textarea where you write all the details about this entry that the AI should know — personality, history, rules, quirks, or appearance. There is no length limit; write as much or as little as the story needs. The content of this field is included in the AI context whenever this entry is relevant.

This usually works best after you have rough story notes and a preliminary summary, but before heavy chapter drafting. CHAT uses Sourcebook material to maintain logic, while WRITING and EDITING receive relevant entries as read-only context.

### Dialog Footer

| Button                                                                                                                      | Description                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Delete** (<img src="assets/trash-2.svg" alt="Trash icon" width="16" height="16" style="vertical-align:text-bottom;" />)   | Available only when editing an existing entry. Permanently deletes the entry after a confirmation prompt. |
| **Cancel**                                                                                                                  | Closes the dialog without saving any changes.                                                             |
| **Save Entry** (<img src="assets/edit-2.svg" alt="Save icon" width="16" height="16" style="vertical-align:text-bottom;" />) | Saves the entry. Disabled until the Name field is non-empty.                                              |

---

## Image Picker

The Image Picker is a sub-modal that appears when you click **Manage Images** inside a Sourcebook entry. It shows every image in the current project as a responsive grid of thumbnails.

- Click an image to **select** it — a checkmark overlay and a colored ring appear on selected images.
- Click a selected image again to **deselect** it.
- A count below the grid shows how many images are currently selected.
- Click **Done** (✓) to close the picker and apply the selection to the entry.

Images shown here are managed in the [Project Images](09_project_images.md) dialog. You can upload new images there and they will appear in this picker immediately.

---

## Why it Matters

The Sourcebook keeps every collaborator and AI call referring to the same canonical lore. A well-maintained Sourcebook is the single most effective thing you can do to prevent the AI from hallucinating wrong names, places, and world rules. Updating descriptions, pulling in new visuals, or reorganizing categories here means every writing session and AI prompt stays on-model.

## Automatic Selection Mode

The **Auto** checkbox in the Sourcebook header controls whether a dedicated AI helper should continuously select relevant entries for the current chapter.

- **Auto enabled**:
  - The app periodically asks the model which entries are relevant to the current chapter text.
  - Entry checkboxes become read-only (greyed out) so the automatic selection remains authoritative.
  - The checkmarks still update and remain visible, so you can always see what the model selected.
  - A spinning status icon appears beside **Auto** while that request is currently running.
- **Auto disabled**:
  - The automatic relevance helper is not run.
  - Entry checkboxes become editable again so you can choose entries manually.

Mouse-over tooltips on the **Auto** control, spinner, and disabled checkboxes explain this behavior directly in the UI.

---

Next up: Apply everything you've learned in the [Tutorial: Writing Your First Story](06_tutorial_first_story.md).
