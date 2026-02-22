# Projects and Settings

To access your projects and configure the application, click the <img src="assets/settings.svg" alt="Settings icon" width="20" height="20" style="vertical-align:text-bottom;" /> **Settings** icon (or the logo/title area) in the top navigation bar. This opens the Settings Dialog, which has two main tabs: **Projects** and **Machine Settings**.

## The Projects Tab

The Projects tab lists every project stored on this machine and lets you create, rename, delete, import, and export them.

`[SCREENSHOT: The Settings Dialog showing the Projects tab with a list of projects]`

### Toolbar

Three buttons sit above the project list:

| Button          | Icon                                                                                                            | Action                                                                                                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Refresh**     | <img src="assets/edit-2.svg" alt="Refresh icon" width="16" height="16" style="vertical-align:text-bottom;" /> ↺ | Rescans the projects folder from disk — useful if you have added or removed project folders manually.                                                                                         |
| **Import**      | ↑ Upload                                                                                                        | Opens a file picker that accepts `.zip` files. AugmentedQuill will unpack the archive and add the project to your list. This is the matching action to the Export button on each project row. |
| **New Project** | <img src="assets/plus.svg" alt="Plus icon" width="16" height="16" style="vertical-align:text-bottom;" />        | Opens the **Create Project** dialog (see below).                                                                                                                                              |

### Project Cards

Each project in the list shows:

- **Project name** — click the <img src="assets/edit-2.svg" alt="Edit icon" width="16" height="16" style="vertical-align:text-bottom;" /> pencil icon next to the name to edit it inline. A text field appears; press **Enter** or click the **Save** icon to confirm. The name change takes effect on disk immediately.
- **Active badge** — the currently loaded project has an "Active" label in place of the Open button.
- **Project type selector** — a `<select>` dropdown that lets you convert the current type (Short Story → Novel → Series or any combination). Rules apply (see [Chapters and Books](04_chapters_and_books.md#story-types-and-when-to-upgrade) for the full conversion rules). When a conversion is blocked because of too much content, the blocked option shows "Too many items" and is disabled.
- **Export** (↓ Download icon) — downloads a `.zip` archive of the project that you can share, move to another computer, or use as a backup.
- **Open** button (secondary, non-active projects only) — loads that project and closes the Settings dialog.
- **Delete** (<img src="assets/trash-2.svg" alt="Trash icon" width="16" height="16" style="vertical-align:text-bottom;" />) — permanently removes the project after a confirmation prompt. This cannot be undone.

### Create Project Dialog

Clicking **New Project** opens a small dialog:

`[SCREENSHOT: The Create Project dialog showing the name field and three project type radio buttons]`

| Field                        | Description                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Project Name** text field  | Type the title of your new story. The **Create Project** button stays disabled until you enter at least one character.   |
| **Short Story** radio button | Best for poems, flash fiction, or a single-scene story — gives you exactly one chapter to work in.                       |
| **Novel** radio button       | Standard multi-chapter structure. Use this for any full-length story.                                                    |
| **Series** radio button      | Chapters are organized inside books. Choose this for a trilogy, serial fiction, or any work that spans multiple volumes. |
| **Cancel**                   | Closes the dialog without creating anything.                                                                             |
| **Create Project**           | Creates the project and loads it immediately.                                                                            |

---

## The Machine Settings Tab

The Machine Settings tab is where you configure the AI models (providers) that power AugmentedQuill. You can add multiple providers and assign each one to specific roles.

`[SCREENSHOT: The Machine Settings tab showing the provider list on the left and the configuration form on the right]`

### The Three AI Model Roles

AugmentedQuill uses three distinct model roles, each optimized for a specific part of the writing process. You can assign a different provider to each role based on its strengths. The application uses color hints everywhere in the UI to help you see which role is active.

1. **WRITING Model** — <img src="assets/book-open.svg" alt="Book Open icon" width="16" height="16" style="vertical-align:text-bottom;" /> <img src="assets/swatches/violet.svg" alt="Violet swatch" width="16" height="16" style="vertical-align:text-bottom;" /> **Violet**
   - Called when generating new prose: **Extend Chapter**, **Rewrite Chapter**, and **Suggest Next Paragraph**.
   - Optimized for creativity, narrative flow, and honoring your style tags.

2. **EDITING Model** — <img src="assets/pen.svg" alt="Pen icon" width="16" height="16" style="vertical-align:text-bottom;" /> <img src="assets/swatches/fuchsia.svg" alt="Fuchsia swatch" width="16" height="16" style="vertical-align:text-bottom;" /> **Fuchsia**
   - Called for structured text tasks: writing or updating chapter summaries, story summaries, and the **AI Write / AI Update / AI Rewrite** summary buttons in the Metadata Editor.
   - Optimized for accuracy, conciseness, and following specific instructions without adding new plot points.

3. **CHAT Model** — <img src="assets/message-square.svg" alt="Message Square icon" width="16" height="16" style="vertical-align:text-bottom;" /> <img src="assets/swatches/blue.svg" alt="Blue swatch" width="16" height="16" style="vertical-align:text-bottom;" /> **Blue**
   - Powers the AI Chat Assistant panel.
   - Supports tool calls (creating Sourcebook entries, managing chapters, generating images, etc.) and optionally web search.
   - Optimized for conversation, reasoning, and multi-step actions.

By separating these tasks you can use a highly creative model for writing, a precise model for editing, and a fast conversational model for chatting — mix and match according to your budget and needs.

### Provider List

The left column of the Machine Settings tab shows all configured providers as clickable cards. Each card displays:

- The provider **name**.
- Small **role badges** (Writing / Editing / Chat) showing which roles this provider is currently assigned to.
- A **connection status dot**: green = connected, red = failed, grey = not yet tested.
- A **model status dot**: shows whether the configured model ID was confirmed available.
- **Vision** (<img src="assets/eye.svg" alt="Eye icon" width="16" height="16" style="vertical-align:text-bottom;" />) and/or **Function Calling** (<img src="assets/wand.svg" alt="Wand icon" width="16" height="16" style="vertical-align:text-bottom;" />) capability icons when those features are enabled.

Click the **+** button above the list to add a new provider. Click any card to select it for editing.

### Provider Configuration Form

Selecting a provider opens its configuration in the right two-thirds of the panel.

`[SCREENSHOT: Machine Settings provider form showing role toggles, connection fields, model selector, and parameter sliders]`

#### Role Assignment

Three toggle buttons at the top assign roles:

| Toggle      | Color   | Effect                                                          |
| ----------- | ------- | --------------------------------------------------------------- |
| **Writing** | Violet  | This provider will be used for all prose-generation calls.      |
| **Editing** | Fuchsia | This provider will be used for all summary and editing calls.   |
| **Chat**    | Blue    | This provider powers the Chat Assistant (including tool calls). |

Exactly one provider should be assigned to each role. You can assign all three roles to the same provider if preferred, or use separate providers with different strengths for each.

#### Connection Fields

| Field                 | Description                                                                                                                                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**              | A display name for this provider (e.g. "OpenAI GPT-4o" or "Local Llama").                                                                                                                                                                                                                                     |
| **Base URL**          | The OpenAI-compatible API endpoint (e.g. `https://api.openai.com/v1`). Use this to point to Ollama, LM Studio, or any other compatible API.                                                                                                                                                                   |
| **API Key**           | Your API key. Displayed in plain text — keep this page private. Not required for local providers that skip authentication.                                                                                                                                                                                    |
| **Connection status** | A dot and label showing: **Connected** (green), **Connection failed** (red), **Testing…** (spinning), or **Idle** (grey, not yet tested).                                                                                                                                                                     |
| **Model ID**          | The model identifier to use (e.g. `gpt-4o`, `llama3.2`). Start typing to filter, or click the <img src="assets/chevron-down.svg" alt="Chevron icon" width="16" height="16" style="vertical-align:text-bottom;" /> chevron button to fetch the list of available models from the API and pick from a dropdown. |
| **Model status**      | A dot and label: **Model OK** (green), **Model unavailable** (red), **Checking…**, or **Idle**.                                                                                                                                                                                                               |
| **Timeout (ms)**      | How many milliseconds to wait for a response before giving up. Increase this for slow local models; decrease it to fail fast.                                                                                                                                                                                 |

#### Model Capabilities

| Setting              | Options                        | Description                                                                                                                                                                                                                                                     |
| -------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Multimodal**       | Auto / Supported / Unsupported | Controls whether the app sends image data to this model. **Auto** detects based on the model ID. Set to **Supported** if you know the model accepts images (used when inserting images into chat). Set to **Unsupported** to prevent image attachments.         |
| **Function Calling** | Auto / Supported / Unsupported | Controls whether the app sends tool schemas to this model. **Auto** detects by model ID. Set to **Supported** to force tool use (required for the Chat Assistant's project-management actions). Set to **Unsupported** to disable tool calls for this provider. |

#### Generation Parameters

Two sliders fine-tune the model's output style:

| Slider          | Range                 | Effect                                                                                                                                                                          |
| --------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Temperature** | 0.0 – 2.0 (step 0.1)  | Higher values produce more varied, creative output; lower values produce more focused, deterministic text. A value around 0.7–1.0 is a good starting point for fiction writing. |
| **Top P**       | 0.0 – 1.0 (step 0.05) | Nucleus sampling threshold. Lowering this below 1.0 can reduce repetition. Most users leave this at 1.0.                                                                        |

#### Expert: Prompt Overrides

Below the parameter sliders is an expandable **Prompt Overrides** section. This is an advanced feature for users who want to customize exactly what the AI receives as its instructions.

`[SCREENSHOT: The Expert Prompt Overrides section expanded, showing several labeled textareas with role badges]`

AugmentedQuill has 22 built-in prompts, split into two groups:

**System Messages** (the persona and instruction set given to the model before any user content):

| Prompt                     | Role    |
| -------------------------- | ------- |
| Chat Assistant             | CHAT    |
| Editing Assistant          | EDITING |
| Story Writer               | WRITING |
| Story Continuer            | WRITING |
| Chapter Summarizer         | EDITING |
| Story Summarizer           | EDITING |
| AI Action: Update Summary  | EDITING |
| AI Action: Rewrite Summary | EDITING |
| AI Action: Extend Chapter  | WRITING |
| AI Action: Rewrite Chapter | WRITING |

**User Prompts** (the actual instruction message sent with each request):

| Prompt                              | Role    |
| ----------------------------------- | ------- |
| New Chapter Summary                 | EDITING |
| Update Chapter Summary              | EDITING |
| Write Chapter                       | WRITING |
| Continue Chapter                    | WRITING |
| New Story Summary                   | EDITING |
| Update Story Summary                | EDITING |
| Suggest Continuation / Autocomplete | WRITING |
| Chat User Context                   | CHAT    |
| AI Action: Update Summary User      | EDITING |
| AI Action: Rewrite Summary User     | EDITING |
| AI Action: Extend Chapter User      | WRITING |
| AI Action: Rewrite Chapter User     | WRITING |

Each textarea shows the built-in default as its placeholder text. Type into any textarea to override only that prompt for this provider. Clear the field to revert to the default. Role badges (violet for WRITING, fuchsia for EDITING, blue for CHAT) beside each label remind you which model role will use that prompt.

#### Deleting a Provider

A **Delete** (<img src="assets/trash-2.svg" alt="Trash icon" width="16" height="16" style="vertical-align:text-bottom;" />) danger button at the bottom of the form removes the provider from the list. If the provider was assigned to any role, that role becomes unassigned until you add a new provider.

### Saving Settings

Click **Save & Close** at the bottom of the Settings dialog to write your machine configuration to disk and close the dialog. Any unsaved changes are held in memory until you save. An error message (red text with an alert icon) appears at the bottom if saving fails.

---

Next up: Explore [The Writing Interface](03_writing_interface.md).
