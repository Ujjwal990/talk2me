# Talk2Me

AI-powered next message predictor for any chat platform on the web. Select chat text, press a shortcut, and get an AI-generated reply you can drop straight into the chat input.

## How it works

1. Click into the chat input box (so the extension remembers where to inject)
2. Select the chat messages you want to use as context
3. Press **`Ctrl + Shift + A`**
4. A floating prompt box appears — optionally add instructions or use voice dictation
5. Click **Generate Reply** — the AI produces a reply that matches the tone, style and language of the conversation
6. Click **Use It** to inject the reply into the chat input, or **Retry** to regenerate

## Supported platforms

- WhatsApp Web
- Instagram DMs
- Google Chat (standalone + in Gmail)
- Facebook Messenger
- Facebook
- Tinder
- Snapchat
- Discord
- LinkedIn Messaging
- Telegram Web

Works on any other chat platform as a fallback (using raw selected text).

## Project structure

```
talk2me/
├── talk2me/              # Chrome extension (Manifest V3)
│   ├── manifest.json
│   ├── content.js        # Selection capture, prompt box UI, text injection
│   ├── content.css       # Floating box styles
│   ├── background.js     # Service worker — handles shortcut & API proxy
│   ├── platform-configs.js  # Per-platform DOM selectors
│   ├── popup.html / popup.js
│   ├── settings.html / settings.js
│   └── icons/
└── talk2me-backend/      # Node.js backend (Express)
    ├── server.js
    ├── routes/generate.js  # Groq API adapter with key rotation
    └── package.json
```

## Setup

### Backend

```bash
cd talk2me-backend
npm install
cp .env.example .env
# Edit .env and add your Groq API keys
node server.js
```

The backend will run on `http://localhost:3000`.

### Extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `talk2me/` folder
4. Verify the shortcut at `chrome://extensions/shortcuts` — make sure `Ctrl+Shift+A` is bound to "Generate AI chat reply for selected text"

## Tech

- **Extension:** Vanilla JavaScript, Chrome Extensions Manifest V3, Web Speech API for voice dictation
- **Backend:** Node.js, Express, Groq API (currently using Llama 3.3 70B)
- **Injection:** Synthetic `ClipboardEvent('paste')` for React-based editors like Lexical (WhatsApp), with `execCommand` fallback for plain contenteditable

## License

Personal project.
