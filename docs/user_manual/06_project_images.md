# Project Images

The **Project Images** dialog is where you manage all visual assets attached to a story — reference artwork, character portraits, location sketches, or any images you want the AI to describe or use in prompts. Open it from the header by clicking the <img src="assets/eye.svg" alt="Image icon" width="16" height="16" style="vertical-align:text-bottom;" /> Image icon on the right side of the top bar.

`[SCREENSHOT: The Project Images dialog showing the settings accordion, the action bar with three buttons, and an image grid with cards]`

---

## Project Image Settings

At the top of the dialog is a collapsible **Project Image Settings** accordion. Click the header row (or the chevron icon) to expand or collapse it.

| Setting                    | Description                                                                                                                                                                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Global Style**           | A free-text field for a style that should apply to all AI-generated image prompts in this project (e.g. "watercolor painting", "dark fantasy digital art", "pencil sketch"). When you generate prompts for images, this style description is automatically included. |
| **Additional Information** | A textarea for extra hints, negative prompts, or LoRA trigger words that should be appended to every generated prompt. Useful for model-specific instructions (e.g. "no anime style, no text in image").                                                             |

---

## Action Bar

Below the settings section is a row of three action buttons:

| Button                           | Icon                                                                                                             | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Generate Placeholder Prompts** | <img src="assets/sparkles.svg" alt="Sparkles icon" width="16" height="16" style="vertical-align:text-bottom;" /> | Scans the project for all placeholder image slots (images that have a title/description but no uploaded file) and generates an AI image-generation prompt for each one in a single batch. Uses the <img src="assets/message-square.svg" alt="Message Square icon" width="16" height="16" style="vertical-align:text-bottom;" /> <img src="assets/swatches/blue.svg" alt="Blue swatch" width="16" height="16" style="vertical-align:text-bottom;" /> CHAT model and incorporates the Global Style and Additional Information settings. |
| **Create Placeholder**           | <img src="assets/plus.svg" alt="Plus icon" width="16" height="16" style="vertical-align:text-bottom;" />         | Adds a new named placeholder slot to the image grid. A placeholder has a title and description but no image file yet — use it to plan artwork you intend to generate or commission later.                                                                                                                                                                                                                                                                                                                                             |
| **Upload New Image**             | ↑ Upload                                                                                                         | Opens the system file picker. Accepts PNG, JPEG, GIF, and WEBP files. The uploaded image appears immediately in the grid.                                                                                                                                                                                                                                                                                                                                                                                                             |

You can also drag and drop an image file directly anywhere onto the dialog to upload it.

---

## Image Grid

Uploaded and placeholder images are shown in a responsive grid (1–4 columns depending on screen width). Each image card contains:

`[SCREENSHOT: A single image card showing the thumbnail, title input, description textarea, and action buttons]`

### Thumbnail Area

- **Click the thumbnail** to open the full-size **Lightbox** view (see below).
- **Replace** button (appears on hover): Opens the file picker to swap the image file while keeping the same title and description.
- **Drag-and-drop**: Drag an image file onto a card to replace it.

### Title and Description

| Field                                                | Description                                                                                                                               |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Title** text input                                 | An editable name for this image (e.g. "Elara — Chapter 3"). Shown below the thumbnail and used when inserting the image into the editor.  |
| **Description** textarea                             | A resizable text area for a written description of the image. The AI uses this description when referencing the image in prompts or chat. |
| **Save** button (appears when unsaved changes exist) | Writes the title and description to disk. Changes to the text fields are not auto-saved — you must click Save to persist them.            |

### Per-Image Actions

Four small action buttons appear below the description:

| Button                            | Icon                                                                                                             | Description                                                                                                                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Insert**                        | ✎ TextCursor                                                                                                     | Inserts a markdown image reference (`![title](url)`) at the current editor cursor position, embedding this image inline in the chapter you are editing.                                      |
| **Generate / Update description** | <img src="assets/wand.svg" alt="Wand icon" width="16" height="16" style="vertical-align:text-bottom;" />         | Asks the AI to generate a written description for this image (requires a multimodal / Vision-capable model to be assigned to the CHAT role). If a description already exists, it is updated. |
| **Create prompt**                 | <img src="assets/sparkles.svg" alt="Sparkles icon" width="16" height="16" style="vertical-align:text-bottom;" /> | Generates an image-generation prompt for this specific image. The prompt is shown in the **Generated Prompt popup** (see below) and can be copied to your clipboard.                         |
| **Delete**                        | <img src="assets/trash-2.svg" alt="Trash icon" width="16" height="16" style="vertical-align:text-bottom;" />     | Permanently deletes the image file from the project after a confirmation prompt.                                                                                                             |

---

## Lightbox

Clicking a thumbnail opens the **Lightbox** — a full-screen overlay showing the image at maximum size (up to 90 % of the screen width and height). The filename and description appear as a caption below the image. Click the **✕** button or the backdrop to close it.

---

## Generated Prompt Popup

When you click **Create prompt** on an image card, a popup panel appears showing the AI-generated image-generation prompt. The prompt streams in word by word so you can see it being written.

| Control                                                                                                                            | Description                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Close** (✕)                                                                                                                      | Closes the popup without copying.                                                                   |
| **Output text area**                                                                                                               | Read-only display of the generated prompt. Updates in real time while streaming.                    |
| **Generating…** indicator                                                                                                          | A spinner shown while the generation is still in progress.                                          |
| **Copy to Clipboard** (<img src="assets/edit-2.svg" alt="Copy icon" width="16" height="16" style="vertical-align:text-bottom;" />) | Copies the full prompt text. The button label changes to "Copied!" for two seconds as confirmation. |

Paste the copied prompt into your preferred image generation tool (Stable Diffusion, Midjourney, DALL-E, etc.) to create the artwork.

---

## Tips for Best Results

- Fill in **Title** and **Description** for every image before generating prompts — the richer the description, the more accurate the generated prompt.
- Use the **Global Style** field to keep a consistent art style across all generated prompts for the project.
- **Placeholders** are powerful for planning: create them and name them (e.g. "Cover art — night scene") before you have the final images, then generate prompts later when you are ready.
- Link images to Sourcebook entries (via the [Sourcebook Image Picker](05_sourcebook.md#image-picker)) so the AI knows which visual reference belongs to which character or location.

---

Next up: Discover your AI writing partner in [The AI Chat Assistant](07_ai_chat_assistant.md).
