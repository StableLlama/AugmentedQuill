# Projects and Settings

To access your projects and configure the application, click the <img src="assets/settings.svg" alt="Settings icon" width="20" height="20" style="vertical-align:text-bottom;" /> **Settings** icon (or the logo/title area) in the top navigation bar. This opens the Settings Dialog, which has four main tabs: **Projects**, **Machine Settings**, **General**, and **About**.

## The About Tab

The About tab provides version and runtime information about AugmentedQuill and the environment it is running in:

- **Version** (from `src/frontend/package.json`)
- **Git revision** (short commit hash)
- **Built** timestamp
- **Python version** (build environment)
- **Node version** (build environment)
- **Browser user agent** (runtime client browser)
- **License** and **copyright** notice
- **GitHub project** link

This tab is useful for troubleshooting, bug reports, and confirming exactly which code and dependencies are in use.

## The Projects Tab

The Projects tab lists every project stored on this machine and lets you create, rename, delete, import, and export them.

![The Settings Dialog showing the Projects tab with a list of projects](screenshots/02_settings_projects.png)

### Toolbar

Three buttons sit above the project list:

| Button          | Icon                                                                                                              | Action                                                                                                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Refresh**     | <img src="assets/refresh-cw.svg" alt="Refresh icon" width="16" height="16" style="vertical-align:text-bottom;" /> | Rescans the projects folder from disk — useful if you have added or removed project folders manually.                                                                                         |
| **Import**      | ↑ Upload                                                                                                          | Opens a file picker that accepts `.zip` files. AugmentedQuill will unpack the archive and add the project to your list. This is the matching action to the Export button on each project row. |
| **New Project** | <img src="assets/plus.svg" alt="Plus icon" width="16" height="16" style="vertical-align:text-bottom;" />          | Opens the **Create Project** dialog (see below).                                                                                                                                              |

### Project Cards

Each project in the list shows:

- **Project name** — click the <img src="assets/edit-2.svg" alt="Edit icon" width="16" height="16" style="vertical-align:text-bottom;" /> pencil icon next to the name to edit it inline. A text field appears; press **Enter** or click the **Save** icon to confirm. The name change takes effect on disk immediately. While editing you can also change the **Project Language** using the adjacent dropdown.
- **Active badge** — the currently loaded project has an "Active" label in place of the Open button.
- **Project type selector** — a `<select>` dropdown that lets you convert the current type (Short Story → Novel → Series or any combination). Rules apply (see [Chapters and Books](04_chapters_and_books.md#story-types-and-when-to-upgrade) for the full conversion rules). When a conversion is blocked because of too much content, the blocked option shows "Too many items" and is disabled.
- **Export (EPUB)** (<img src="assets/book.svg" alt="Book icon" width="16" height="16" style="vertical-align:text-bottom;" /> Book icon) — compiles and downloads the project's contents as a formatted `.epub` e-book.
- **Export (ZIP)** (<img src="assets/download.svg" alt="Download icon" width="16" height="16" style="vertical-align:text-bottom;" /> Download icon) — downloads a `.zip` archive of the project that you can share, move to another computer, or use as a backup.
- **Open** button (secondary, non-active projects only) — loads that project and closes the Settings dialog.
- **Delete** (<img src="assets/trash-2.svg" alt="Trash icon" width="16" height="16" style="vertical-align:text-bottom;" />) — permanently removes the project after a confirmation prompt. This cannot be undone.

### Create Project Dialog

Clicking **New Project** opens a small dialog:

![The Create Project dialog showing the name field and three project type radio buttons](screenshots/02_create_project_dialog.png)

| Field                         | Description                                                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Project Name** text field   | Type the title of your new story. The **Create Project** button stays disabled until you enter at least one character.                   |
| **Project Language** dropdown | Choose the language used for LLM instructions; available options come from the bundled `instructions.json` file (e.g. English, Spanish). |
| **Short Story** radio button  | Best for poems, flash fiction, or a single-scene story — gives you exactly one chapter to work in.                                       |
| **Novel** radio button        | Standard multi-chapter structure. Use this for any full-length story.                                                                    |
| **Series** radio button       | Chapters are organized inside books. Choose this for a trilogy, serial fiction, or any work that spans multiple volumes.                 |
| **Cancel**                    | Closes the dialog without creating anything.                                                                                             |
| **Create Project**            | Creates the project and loads it immediately.                                                                                            |

---

## Project Checkpoints

Project Checkpoints allow you to save the entire state of your project at a specific point in time and return to it later. This is useful before making major changes to your story structure or when experimenting with different plot directions.

### Managing Checkpoints

The Checkpoints menu is located in the top navigation bar, represented by a <img src="assets/save.svg" alt="Save icon" width="16" height="16" style="vertical-align:text-bottom;" /> **Checkpoints** button.

- **Store Current State**: Creates a new snapshot of your project. This includes all chapters, books, sourcebook entries, and settings.
- **Load Checkpoint**: Replaces the current project state with a previously saved version.
  - _Note: Loading a checkpoint will overwrite your current unsaved changes. The application will prompt you with a warning if you have unsaved work._
- **Delete Checkpoint**: Permanently removes a stored snapshot from your machine.

### What is saved?

Checkpoints capture:

- Story metadata (title, summary, style tags).
- All manuscript content (chapters and books).
- The entire Sourcebook.
- Project-specific settings.

_Note: Chat histories and generated images are currently not included in project checkpoints to keep snapshot sizes manageable._

---

## The Machine Settings Tab

The Machine Settings tab is where you configure the AI models (providers) that power AugmentedQuill. You can add multiple providers and assign each one to specific roles.

![The Machine Settings tab showing the provider list on the left and the configuration form on the right](screenshots/02_machine_settings_1.png)

### The Three AI Model Roles

AugmentedQuill uses three distinct model roles, each optimized for a specific part of the writing process. You can assign a different provider to each role based on its strengths. The application uses color hints everywhere in the UI to help you see which role is active.

1. **WRITING Model** — <img src="assets/book-open.svg" alt="Book Open icon" width="16" height="16" style="vertical-align:text-bottom;" /> <img src="assets/swatches/violet.svg" alt="Violet swatch" width="16" height="16" style="vertical-align:text-bottom;" /> **Violet**
   - Called when generating new prose: **Extend Chapter**, **Rewrite Chapter**, **Suggest Next Paragraph**, and any story text delegated from chat.
   - Optimized for creativity, narrative flow, and honoring your style tags.
   - Starts each request cold; it only knows what the current prompt contains.
   - This is the only model that should create fresh story prose.

2. **EDITING Model** — <img src="assets/pen.svg" alt="Pen icon" width="16" height="16" style="vertical-align:text-bottom;" /> <img src="assets/swatches/fuchsia.svg" alt="Fuchsia swatch" width="16" height="16" style="vertical-align:text-bottom;" /> **Fuchsia**
   - Called for structured text tasks: writing or updating chapter summaries, story summaries, and the **AI Write / AI Update / AI Rewrite** summary buttons in the Metadata Editor.
   - Optimized for accuracy, conciseness, and following specific instructions without adding new plot points.
   - Starts each request cold; it must rely on the current prompt and any tool results it fetches.
   - It may refine existing prose, but if additional story content is needed it should delegate that work to WRITING.

3. **CHAT Model** — <img src="assets/message-square.svg" alt="Message Square icon" width="16" height="16" style="vertical-align:text-bottom;" /> <img src="assets/swatches/blue.svg" alt="Blue swatch" width="16" height="16" style="vertical-align:text-bottom;" /> **Blue**
   - Powers the AI Chat Assistant panel.
   - Supports tool calls (creating Sourcebook entries, managing chapters, generating images, etc.) and optionally web search.
   - Optimized for conversation, reasoning, and multi-step actions.
   - Uses only the current chat session history plus tool results from this session; starting a new chat does not carry over older chat sessions.
   - Acts as the workflow brain: it keeps metadata and sourcebook information aligned, decides what step comes next, and delegates prose work to WRITING or EDITING.

By separating these tasks you can use a highly creative model for writing, a precise model for editing, and a fast conversational model for chatting — mix and match according to your budget and needs.

### Recommended Story Workflow

AugmentedQuill treats the following sequence as the default workflow, not as a rigid law:

1. Write story notes, ideas, and constraints in markdown.
2. Set the title and style tags.
3. Draft a preliminary story summary.
4. Build the Sourcebook.
5. Outline chapters and write chapter notes before prose.
6. Track conflicts and expected resolutions, then refine chapter summaries.
7. Write the actual prose in the appropriate structure: the single chapter for a short story, chapter by chapter for a novel, or book by book for a series.

The CHAT model may revisit earlier steps whenever a later discovery reveals a missing setup detail.

### Provider List

The left column of the Machine Settings tab shows all configured providers as clickable cards. Each card displays:

- The provider **name**.
- Small **role badges** (Writing / Editing / Chat) showing which roles this provider is currently assigned to.
- A **connection status dot**: green = connected, red = failed, grey = not yet tested.
- A **model status dot**: shows whether the configured model ID was confirmed available.
- **Vision** (<img src="assets/eye.svg" alt="Eye icon" width="16" height="16" style="vertical-align:text-bottom;" />) and/or **Function Calling** (<img src="assets/wand.svg" alt="Wand icon" width="16" height="16" style="vertical-align:text-bottom;" />) capability icons when those features are enabled.
- Duplication icon (<img src="assets/copy-plus.svg" alt="Copy Plus icon" width="16" height="16" style="vertical-align:text-bottom;" />): appears on hover over the provider card.

Click the **+** button above the list to add a new provider from scratch. Click the **Duplicate** icon (<img src="assets/copy-plus.svg" alt="Copy Plus icon" width="16" height="16" style="vertical-align:text-bottom;" />) on an existing provider's card to create an exact copy of its configuration (including prompt overrides). This is useful for testing different temperatures or prompts on the same model. Click any card to select it for editing.

### Provider Configuration Form

Selecting a provider opens its configuration in the right two-thirds of the panel.

![Machine Settings provider form showing role toggles, connection fields, model selector, and parameter sliders](screenshots/02_machine_settings_2.png)

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

The parameters section controls the sampling behaviour of the model. You can set them manually, or use the **Preset** and **Parameter Tweak** selectors described below to start from a known-good configuration.

| Parameter                 | Range / Type          | Effect                                                                                                                                                      |
| ------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Temperature**           | 0.0 – 2.0 (step 0.1)  | Controls randomness. Higher values produce more varied, creative output; lower values produce more focused, deterministic text.                             |
| **Top P**                 | 0.0 – 1.0 (step 0.05) | Nucleus sampling threshold. Only tokens within the top-P cumulative probability mass are sampled. 1.0 disables this filter.                                 |
| **Min P**                 | 0.0 – 1.0 (step 0.01) | Minimum token probability relative to the top token. Tokens below this threshold are excluded. Typical values: 0.01–0.1; 0 disables.                        |
| **Top K**                 | Integer or blank      | Restricts sampling to the K most likely tokens. Leave blank to disable.                                                                                     |
| **Max Tokens**            | Integer or blank      | Maximum number of tokens the model will generate in a single response. Leave blank to use the model default.                                                |
| **Context Window**        | Integer or blank      | Maximum combined prompt + response token count. Overrides the model default if set.                                                                         |
| **Seed**                  | Integer or blank      | Fixed random seed for reproducible output. Leave blank for random.                                                                                          |
| **Presence Penalty**      | −2.0 – 2.0            | Penalizes tokens that have already appeared, encouraging topic variety.                                                                                     |
| **Frequency Penalty**     | −2.0 – 2.0            | Reduces repetition by penalizing tokens proportionally to how often they have been used.                                                                    |
| **Suggestion Loop Guard** | On / Off              | Enables automatic detection of repetitive or low-quality "Suggest next paragraph" output and triggers regeneration attempts before showing results.         |
| **Loop N-gram**           | 3-gram / 4-gram       | Selects the phrase length used for loop detection during suggestions. 3-gram is stricter; 4-gram is more permissive.                                        |
| **Min Repeats**           | Integer (2–8)         | Number of repeated n-grams required before a loop is considered detected. Lower values catch loops earlier; higher values reduce false positives.           |
| **Max Regenerations**     | Integer (0–3)         | How many retries are allowed for suggestion generation when loops or low-quality endings are detected.                                                      |
| **Stop Sequences**        | One sequence per line | Strings that cause the model to stop generating when encountered.                                                                                           |
| **Extra Body (JSON)**     | JSON object or blank  | Additional fields merged verbatim into the API request body. Use for provider-specific options not exposed above (e.g. `{"reasoning": {"enabled": true}}`). |

#### Suggestion Quality Tuning (Recommended)

The four **Suggestion Loop Guard** options apply specifically to **Suggest Next Paragraph**. They are stored per provider, so you can keep stricter settings on one WRITING provider and looser settings on another.

Recommended starting point:

- **Suggestion Loop Guard**: On
- **Loop N-gram**: 3-gram
- **Min Repeats**: 3
- **Max Regenerations**: 1

If suggestions still degrade at the end of the paragraph:

- Increase **Max Regenerations** to 2.
- If creative phrasing gets rejected too often, switch **Loop N-gram** to 4-gram.
- If loops still slip through, lower **Min Repeats** from 3 to 2.

#### Presets and Parameter Tweaks

Presets and tweaks let you quickly populate parameters from a tested configuration rather than tuning each value by hand. They work in two layers:

**Preset (absolute)** — selectable from the **Preset** drop-down:

When you type or select a model ID, the **Preset** selector automatically groups options: models that match your model ID appear first under _Suggested for this model_, followed by all other presets under _All presets_. Selecting a preset writes all of its values into the parameter fields below. A short description appears beneath the selector.

> **You can always override any value after applying a preset.** The parameters are not locked — edit any field and your value takes effect immediately. The preset name stays shown as a reminder of the starting point.

**Parameter Tweak (delta)** — selectable from the **Parameter Tweak** drop-down:

A tweak applies only its defined fields on top of whatever parameters are currently set, leaving all other values unchanged. This lets you stack a general adjustment (e.g. _Creative Writing_, _Tweak: Factual Focus_) on top of a model-specific preset. The name of the last-applied tweak is shown beneath the selector.

Like presets, tweaks just write values into the parameter fields — you remain free to manually adjust any individual parameter afterwards.

**Typical workflow:**

1. Enter or select a **Model ID** → a matching preset is suggested in the Preset selector.
2. Pick that preset (or choose a different one from _All presets_).
3. Optionally apply a **Parameter Tweak** to steer the style further.
4. Manually fine-tune any individual value if needed.
5. Click **Save & Close**.

#### Expert: Prompt Overrides

Below the parameter sliders is an expandable **Prompt Overrides** section. This is an advanced feature for users who want to customize exactly what the AI receives as its instructions.

![The Expert Prompt Overrides section expanded, showing several labeled textareas with role badges](screenshots/02_machine_settings_3.png)

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

Each textarea shows the built-in default as its placeholder text. Type into any textarea to override only that prompt for this provider.

To keep the override list manageable, you can choose which prompt you want to override from a dropdown menu and then click **Add**. Once added, the override appears in the list as an editable textarea.

If you clear a prompt override (leaving it empty) and click **Save & Close**, that override is removed entirely and the system defaults are used again.

Role badges (violet for WRITING, fuchsia for EDITING, blue for CHAT) beside each label remind you which model role will use that prompt.

#### Deleting a Provider

A **Delete** (<img src="assets/trash-2.svg" alt="Trash icon" width="16" height="16" style="vertical-align:text-bottom;" />) danger button at the bottom of the form removes the provider from the list. If the provider was assigned to any role, that role becomes unassigned until you add a new provider.

### Saving Settings

Click **Save & Close** at the bottom of the Settings dialog to write your machine configuration to disk and close the dialog. Any unsaved changes are held in memory until you save. An error message (red text with an alert icon) appears at the bottom if saving fails.

---

## Multiple Languages (GUI vs Project)

AugmentedQuill supports distinct languages for its interface (GUI) and your story content.

**Changing the Application Language:**

1. Open the **Settings** dialog by clicking the gear icon in the top right.
2. Select the **General** tab.
3. Set your preferred **GUI Language** to modify the interface text. By default, AugmentedQuill uses your browser's standard language.

**Changing the Story Language:**
The story language dictates the spellchecking and grammar tools used by your chosen browser when typing. You can write a story in French while using an English interface, for example.

1. When creating a **New Project**, select the language in the project dialog.
2. OR, open the **Project Settings** (by clicking your story title in the corner or typing in the Project tab) and change the language dropdown.
3. Chat fields, Editors, and Images will automatically adapt their spellchecker to the project's saved language.

---

Next up: Explore [The Writing Interface](03_writing_interface.md).
