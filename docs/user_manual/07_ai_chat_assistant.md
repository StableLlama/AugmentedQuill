# The AI Chat Assistant

The AI Chat Assistant is your dedicated co-writer, sounding board, and editor. It sits in the right sidebar alongside your writing interface, ready to help whenever you get stuck. Toggle it open with the **AI** button at the far right of the header, or close it with **Hide**.

`[SCREENSHOT: The AI Chat Assistant panel open in the right sidebar next to the text editor]`

The Chat Assistant is powered by the <img src="assets/message-square.svg" alt="Message square icon" width="20" height="20" style="vertical-align:text-bottom;" /> <img src="assets/swatches/blue.svg" alt="Blue swatch" width="16" height="16" style="vertical-align:text-bottom;" /> **CHAT model**
<img src="assets/message-square.svg" alt="Message square icon" width="20" height="20" style="vertical-align:text-bottom;" /> <img src="assets/swatches/blue.svg" alt="Blue swatch" width="16" height="16" style="vertical-align:text-bottom;" />, which you can spot by the blue halo around the panel. You can swap the CHAT provider at any time using the model selector in the header without opening Settings.

---

## Chat Panel Header

The header bar at the top of the chat panel shows the current session name and a row of icon buttons:

`[SCREENSHOT: Chat panel header showing the session title and all icon buttons]`

| Button             | Icon                                                                                                         | Description                                                                                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Session title**  | Sparkles + text                                                                                              | Displays the name of the active session ("Incognito Chat" for ephemeral sessions, or the conversation name for saved sessions).                                                                                                                        |
| **Delete session** | <img src="assets/trash-2.svg" alt="Trash icon" width="16" height="16" style="vertical-align:text-bottom;" /> | Permanently deletes the active chat session after confirmation.                                                                                                                                                                                        |
| **New Chat**       | <img src="assets/plus.svg" alt="Plus icon" width="16" height="16" style="vertical-align:text-bottom;" />     | Creates a new persistent chat session. Previous sessions are preserved in history.                                                                                                                                                                     |
| **Incognito Chat** | Ghost icon                                                                                                   | Creates or shows an ephemeral chat session that is not saved to disk and does not appear in the history list. Use this for sensitive brainstorming you don't want logged. The icon turns purple when an incognito session is currently active.         |
| **Chat History**   | Clock/History icon                                                                                           | Shows or hides the **Chat History Panel** (see below). The icon is highlighted when the panel is open.                                                                                                                                                 |
| **Web Search**     | Globe icon                                                                                                   | Enables or disables the live web search tool for the current session. When active (blue), the AI can perform web searches before responding — useful for fact-checking, research, or getting up-to-date information. The icon turns blue when enabled. |
| **Chat Settings**  | Settings2 icon                                                                                               | Shows or hides the **System Prompt Panel** (see below). The icon is highlighted when the panel is open.                                                                                                                                                |

---

## Chat History Panel

Clicking the History button reveals a slide-in panel below the header (up to 240 px tall, scrollable):

`[SCREENSHOT: Chat History panel showing a list of previous sessions with dates and the Clear All button]`

| Element                                                                                                                               | Description                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **"Recent Chats"** label                                                                                                              | Section heading.                                                                                                                                  |
| **Clear All** button (red text)                                                                                                       | Deletes every saved session at once after confirmation.                                                                                           |
| **Close** (✕)                                                                                                                         | Hides the history panel without deleting anything.                                                                                                |
| **Session rows**                                                                                                                      | Each row shows the session name, the date it was last updated, and a ghost icon if it was an incognito session. Click a row to load that session. |
| **Delete** (<img src="assets/trash-2.svg" alt="Trash icon" width="16" height="16" style="vertical-align:text-bottom;" />) on each row | Deletes that individual session after confirmation.                                                                                               |

---

## System Prompt Panel

Clicking the Chat Settings button reveals a panel below the header where you can customize the AI's persona for the current session:

| Element                        | Description                                                                                                                                                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **"System Instruction"** label | —                                                                                                                                                                                                                |
| **System prompt textarea**     | Editable text that is prepended to every message in this session as a system instruction. Use it to give the AI a specific role (e.g. "You are a harsh but fair literary editor specializing in noir fiction."). |
| **Cancel**                     | Closes the panel without saving changes.                                                                                                                                                                         |
| **Update Persona**             | Saves the new system instruction and closes the panel. The new persona takes effect on the next message.                                                                                                         |

---

## Message Composer

At the bottom of the chat panel is a two-part composer area:

| Element                                                                                                                                                           | Description                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Message textarea**                                                                                                                                              | Auto-growing text input. Press **Enter** to send, **Shift+Enter** to insert a newline without sending.                                              |
| **Send** button (round, Send icon)                                                                                                                                | Submits the message. Disabled while the AI is generating a response.                                                                                |
| **Stop generation** (red ✕, dashed border)                                                                                                                        | Appears while the AI is generating. Click it to immediately abort the streaming response. The partial response remains visible in the message list. |
| **Regenerate last response** (<img src="assets/edit-2.svg" alt="Refresh icon" width="16" height="16" style="vertical-align:text-bottom;" /> dashed border button) | Re-runs the last AI request from scratch and replaces the previous response. Useful when the output was unsatisfactory.                             |

---

## Message List

Each message in the conversation shows:

- An **avatar badge** indicating the role: a person icon for your messages, a bot icon for AI responses, or a settings icon for system messages.
- The **message content**, rendered as formatted markdown for AI responses.
- On hover, **Edit** (<img src="assets/edit-2.svg" alt="Edit icon" width="16" height="16" style="vertical-align:text-bottom;" />) and **Delete** (<img src="assets/trash-2.svg" alt="Trash icon" width="16" height="16" style="vertical-align:text-bottom;" />) buttons appear in the corner of the bubble.

### Editing a Message

Click the Edit icon on any message to enter inline edit mode. A textarea replaces the message text, pre-filled with the current content. Make your changes, then:

- Click the **Save** (floppy disk) icon to commit the edit. The message updates and the AI side of the conversation may re-run if you edited a user message.
- Click the **Cancel** (✕) icon to discard changes and revert.

### AI Thinking and Tool Calls

When the AI uses advanced reasoning or takes an action behind the scenes, a collapsible **tool section** appears inside the response bubble. Click the chevron to expand or collapse it. These sections can include:

| Section              | Description                                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Thinking Process** | The model's internal reasoning steps before it produced the answer (shown only by reasoning-capable models).                                       |
| **Tool Calls**       | A JSON summary of every function the AI called (e.g. "create_sourcebook_entry", "update_story_summary"). Useful for debugging unexpected behavior. |
| **Stack Trace**      | Error information if a tool call failed.                                                                                                           |

### Web Search Results

When **Web Search** is enabled and the AI performs a search, the response includes a formatted Web Search Results card showing:

- The Globe icon and the search query.
- A list of result cards, each with a clickable **title link**, the source URL, and a text snippet.

If the AI visits a specific page, a **Visit Page result** card appears with the URL, the extracted page text (scrollable), and the size of the fetched content.

### AI Actions and Project Changes

The <img src="assets/message-square.svg" alt="Message Square icon" width="16" height="16" style="vertical-align:text-bottom;" /> <img src="assets/swatches/blue.svg" alt="Blue swatch" width="16" height="16" style="vertical-align:text-bottom;" /> Chat model can take actions directly inside your project (create characters, update summaries, manage chapters, generate images). When the AI creates a new project or switches context, a **Switch to New Project** button may appear inside the response, letting you load the changed project with one click.

---

## Tool Call Limit Dialog

To prevent runaway AI automation, AugmentedQuill monitors how many consecutive tool calls the AI makes. If the count reaches the limit, a dialog pauses execution:

`[SCREENSHOT: Tool Call Limit dialog showing the call count and the three action buttons]`

| Button                     | Description                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| **Continue (+10 calls)**   | Allows 10 more tool calls and resumes automatically.                                              |
| **Continue without limit** | Removes the cap entirely for this request (use with care for complex automation tasks).           |
| **Stop and review**        | Halts the tool-call chain immediately so you can inspect what happened and decide how to proceed. |

---

## How to Use the Chat

You can talk to the AI just like you would a human collaborator. Because it has access to your [Story Metadata](04_chapters_and_books.md#story-metadata-panel), [Chapters](04_chapters_and_books.md), and [Sourcebook](05_sourcebook.md), it understands the context of your questions.

### Brainstorming

Stuck on a plot point? Ask the AI for ideas.
_Example:_ "I need a reason for my protagonist to leave their hometown. What are some inciting incidents that fit a fantasy setting?"

### Overcoming Writer's Block

Not sure how to start a scene?
_Example:_ "Write an opening paragraph for Chapter 3, where Sarah discovers the hidden letter. Make the tone suspenseful."

### Fact-Checking Your Own World

Forget a detail you established earlier?
_Example:_ "What color are the uniforms of the Royal Guard?" (The AI will check your Sourcebook and previous chapters.)

### Editing and Feedback

Want a second opinion?
_Example:_ "Read the last three paragraphs I wrote. Is the dialogue natural? How can I make the tension higher?"

---

## AI Actions

The AI isn't just a chatbot — it can take actions within your project. You can ask it to:

- "Create a new character profile for a grumpy bartender named Moe."
- "Summarize Chapter 1 and update the Story Summary."
- "Generate an image of the Crystal Castle based on my Sourcebook description."
- "Create a new chapter called 'The Betrayal' after Chapter 3."
- "Add a conflict to Chapter 2: Elena knows about the letter but hasn't told anyone."

---

Next up: Customize the look and feel in [Appearance and Display](08_appearance_and_display.md).
