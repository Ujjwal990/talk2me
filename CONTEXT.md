# Talk2Me — Development Context

> This document captures the project's full development history, architectural decisions, and gotchas we hit along the way. Use it to onboard a new collaborator (human or AI) without having to re-explain everything from scratch.

---

## What it is

A Chrome extension that predicts the next chat message in any web-based chat using AI. User selects chat text → presses **Ctrl+Shift+A** → a floating prompt box appears → AI generates a reply → user clicks "Use It" and the reply is injected into the chat input box. Designed to work on WhatsApp Web, Instagram, Google Chat, Discord, Telegram, etc.

**Repo:** https://github.com/Ujjwal990/talk2me

---

## Architecture

```
[Chat Platform] ←→ [Talk2Me Extension] ←→ [talk2me-backend] ←→ [Groq API]
                    (Chrome MV3)         (Node.js + Express)
```

Two-part system:

1. **`talk2me/`** — Chrome extension (Manifest V3)
   - Content script captures the user's text selection from the chat platform's DOM
   - Background service worker handles the keyboard shortcut and proxies generation requests to the backend
   - Floating UI box drawn over the page for the prompt/result interaction

2. **`talk2me-backend/`** — Node.js Express server
   - Single endpoint: `POST /api/generate`
   - Holds the Groq API keys server-side (never exposed to the extension)
   - Rotates between two Groq API keys randomly for load balancing
   - Currently uses model `llama-3.3-70b-versatile` via Groq's OpenAI-compatible endpoint

---

## Key Design Decisions

### Why selection-based (not DOM scraping)
The original idea was to read the full chat history via DOM selectors. We rejected that because: every platform's class names are different and change often (WhatsApp uses hashed classes like `x1c4vz4f`), maintenance burden is huge. Instead, the user selects exactly what context they want, and we use the **selection range + DOM intersection** to attribute messages to "you" vs "them" using per-platform configs.

### Why a backend
We considered letting the extension call the AI API directly with the user's own API key (BYOK). Decided against it for now — backend approach means:
- API keys never leave the server
- Easy to switch models later without users having to reconfigure
- Can add rate limiting / analytics later
- User just installs the extension and it works

### Why Groq (not OpenAI / Claude / Gemini)
Started with the user's keys, which turned out to be `gsk_` prefix = Groq (not xAI's Grok, despite the name similarity). Groq runs Llama models at very fast inference speeds via LPUs. The backend's `generate.js` is structured so other providers (OpenAI, Claude, Gemini) can be plugged in with minimal changes — see commented-out adapter patterns in git history.

### Why a paste event for injection (not value setter)
WhatsApp Web uses **Lexical** (Meta's rich-text editor framework). Lexical maintains its own internal state model and ignores naive DOM manipulation (`textContent = '...'` or `document.execCommand('insertText')`). The only reliable injection path is to dispatch a synthetic `ClipboardEvent('paste')` with a `DataTransfer` payload — Lexical's paste handler accepts this. `execCommand` is kept as a fallback for plain `contenteditable` elements.

---

## Implementation Gotchas (these took real time to figure out)

### 1. `Ctrl+Shift+A` is reserved by Chrome
Chrome's built-in shortcut for "Search Tabs" is `Ctrl+Shift+A`. Chrome intercepts the keydown event **before** content scripts can see it. A `document.addEventListener('keydown', ...)` approach simply won't fire — the event never reaches the page.

**Fix:** Register the shortcut via `chrome.commands` API in the manifest. This tells Chrome "this extension owns this combo, don't run your own action." The flow becomes:
```
User press → chrome.commands.onCommand fires in background.js
           → background.js sends TRIGGER_SHORTCUT message to active tab
           → content.js receives the message → opens prompt box
```

On Mac, the manifest needs `MacCtrl+Shift+A` (not `Ctrl+Shift+A`) to bind the physical Control key — otherwise it binds to Command.

**Caveat:** After updating the manifest, Chrome sometimes silently fails to bind the new shortcut. User has to manually verify at `chrome://extensions/shortcuts` and re-set if needed.

### 2. The focus-capture bug
The extension tracks the chat input box via a `focusin` listener so it knows where to inject the generated reply. The bug: when the prompt box opened, the user clicked its textarea → `focusin` fired with the prompt box's own textarea as target → `lastFocusedInput` got overwritten → clicking "Use It" tried to inject into the prompt box (which then got destroyed) → nothing reached the actual chat input.

**Fix:** Skip `focusin` events for any element inside `#talk2me-box`:
```js
if (el.closest('#talk2me-box')) return;
```

### 3. Google Chat lives in an iframe
On `mail.google.com/chat/`, the Chat UI is rendered inside an iframe. With the default content script setup (only injecting into the top frame), `window.getSelection()` returned empty even when the user had selected text — because the selection lived in the iframe, not the top window.

**Fix:** Added `all_frames: true` to the content script in the manifest. Now the script runs in every frame, and each frame independently checks if it has the selection. The frame with the selection handles the shortcut; others stay silent.

To avoid duplicate "Select text first" toasts across frames, only the frame with `document.hasFocus()` shows the toast.

### 4. Dev-time annoyance: extension reload requires page refresh
When you reload the extension at `chrome://extensions`, content scripts already injected into open tabs become "orphaned" — they reference a dead background service worker. The user has to refresh the open tabs for the new version to inject.

**This is a Chrome dev-mode quirk, not a production issue.** Real users never reload extensions — they just install once, and Chrome handles updates automatically on new page loads.

### 5. CSS variables don't bleed in or out
Floating UI is scoped under `#talk2me-box` selector with high specificity. `z-index: 2147483647` ensures it stays above any platform's overlays.

---

## Platform Configs

Located in `talk2me/platform-configs.js`. Each entry specifies:
- `messageContainers` — CSS selectors for each message bubble
- `myMessageSelector` — selector that identifies YOUR messages (or null if not visually distinguishable)
- `textSelector` — where the actual text lives within a bubble
- `inputSelector` — the chat input box to inject into
- `usePositionDetection` — fall back to right-aligned = "you" heuristic

**Currently working (tested):**
- WhatsApp Web — class-based (`.message-out`)
- Discord — left-aligned, no my/their distinction
- Telegram Web — class-based (`.is-out`)

**Configured but unverified:**
- Instagram DMs, Google Chat, Messenger, Facebook, Tinder, Snapchat, LinkedIn

**Disabled via `exclude_matches` in manifest (re-enable when needed):**
- Slack (`app.slack.com`)
- X/Twitter (`x.com`, `twitter.com`)

The configs for these are kept commented out in `platform-configs.js`.

### Subdomain fallback
`getPlatformConfig()` checks exact hostname first, then walks subdomains. So `business.whatsapp.com` automatically picks up `web.whatsapp.com`'s config.

### Generic fallback
If no platform config matches at all, the content script uses raw selected text with `sender: 'unknown'`. The AI can usually figure out tone/who-is-who from context.

---

## File Map

```
talk2me/
├── README.md                     # User-facing setup instructions
├── CONTEXT.md                    # This file — dev history & decisions
├── .gitignore                    # Excludes .env, node_modules, etc.
│
├── talk2me/                      # Chrome extension
│   ├── manifest.json             # MV3 manifest, commands, all_frames, exclude_matches
│   ├── content.js                # Selection capture, UI, injection logic
│   ├── content.css               # Floating box styles (minimalist monochrome)
│   ├── background.js             # Service worker — keyboard shortcut + backend proxy
│   ├── platform-configs.js       # Per-platform DOM selectors
│   ├── popup.html / popup.js     # Toolbar icon popup
│   ├── settings.html / settings.js  # Backend URL configuration
│   └── icons/                    # 16/48/128px PNG icons
│
└── talk2me-backend/              # Node.js backend (not deployed yet — runs locally)
    ├── server.js                 # Express server, CORS, routes mount
    ├── routes/generate.js        # Groq API call with key rotation
    ├── package.json
    ├── .env                      # Live API keys (gitignored)
    └── .env.example              # Template for .env
```

---

## Current State (as of latest commit)

✅ **Working:**
- Keyboard shortcut `Ctrl+Shift+A` (after manual verification at `chrome://extensions/shortcuts`)
- Selection capture with platform-aware message attribution
- Floating draggable prompt box (minimalist monochrome design)
- Voice dictation via Web Speech API (appends at cursor)
- Generation via Groq API (with two-key random rotation)
- "Use It" injection on WhatsApp, Discord, Telegram (tested)
- Retry button to regenerate without re-typing instructions
- Toast notifications for errors / missing selection
- Settings page for backend URL configuration
- Logo wired up as toolbar icon

⏳ **Not done / Future:**
- Backend deployment (currently runs on `localhost:3000`)
- Verifying selectors on Instagram, Google Chat, Messenger, Facebook, Tinder, Snapchat, LinkedIn
- Adding Slack and X/Twitter support back in
- Publishing to Chrome Web Store
- Rate limiting on the backend
- Multi-model support exposed via settings (architecture supports it; UI is hidden)
- Auto-update notifications for users when a new extension version is published

---

## Tech Stack Quick Reference

| Component | Tech |
|---|---|
| Extension | Vanilla JS, Chrome Manifest V3, Web Speech API |
| Backend | Node.js 18+, Express, native `fetch` |
| AI Provider | Groq (Llama 3.3 70B via OpenAI-compatible API) |
| Text injection (Lexical) | Synthetic `ClipboardEvent('paste')` with `DataTransfer` |
| Text injection (fallback) | `document.execCommand('insertText')` |
| Voice input | `webkitSpeechRecognition` |
| Color palette | Zinc-900/800/700, neutral grays, no gradients |

---

## Working with this codebase

### To add a new chat platform
1. Inspect the platform in DevTools to find selectors for: message bubble, sender attribution, text content, input box
2. Add an entry to `PLATFORM_CONFIGS` in `talk2me/platform-configs.js`
3. Test with `Ctrl+Shift+A` on the platform; check the `💉 Injecting reply →` log to verify the input element is correct
4. If injection doesn't work, the platform likely uses a custom editor (Lexical, Quill, etc.) — paste event approach should already cover it

### To swap AI providers
The `talk2me-backend/routes/generate.js` was originally written with adapters for OpenAI/Claude/Gemini in addition to Groq. Currently only Groq is wired in. To add others back, restore the adapter functions and add a model selector.

### To debug a broken shortcut
1. Verify shortcut binding at `chrome://extensions/shortcuts`
2. Open service worker console (chrome://extensions → "service worker" link on Talk2Me card)
3. Press shortcut — should see `⌨️ Command fired: trigger-talk2me`
4. If yes, problem is in content script. Open page console and check for `🟢 Content script loaded on <hostname>` and `📨 Message received`
5. If no, the shortcut isn't bound — most common cause: pressing Cmd instead of physical Ctrl on Mac
