// Per-platform DOM selectors for message attribution and input injection.
//
// Lookup key is matched against window.location.hostname. The first key
// whose pattern matches wins. If no platform matches, the content script
// falls back to using raw selected text with sender = 'unknown'.
//
// Fields:
//   messageContainers    – CSS selector(s) for each message bubble
//   myMessageSelector    – selector identifying YOUR messages (or null)
//   textSelector         – where the message text lives within a bubble
//   inputSelector        – the chat input box to inject into
//   usePositionDetection – fall back to right-aligned = "you" heuristic

const PLATFORM_CONFIGS = {
  'web.whatsapp.com': {
    name: 'WhatsApp',
    messageContainers: ['.message-in', '.message-out'],
    myMessageSelector: '.message-out',
    textSelector: '.selectable-text span, .copyable-text span',
    inputSelector: 'div[contenteditable="true"][data-tab="10"], footer div[contenteditable="true"]',
    usePositionDetection: false,
  },

  'www.instagram.com': {
    name: 'Instagram',
    messageContainers: ['div[role="row"]', 'div[data-testid="message-container-row"]'],
    myMessageSelector: null,
    textSelector: 'div[dir="auto"]',
    inputSelector: 'div[contenteditable="true"][aria-label*="essage" i], textarea[placeholder*="essage" i]',
    usePositionDetection: true,
  },

  'chat.google.com': {
    name: 'Google Chat',
    messageContainers: ['[data-message-id]', 'div[role="listitem"]'],
    myMessageSelector: null,
    textSelector: '[dir="ltr"] span, [dir="auto"] span, [jsname]',
    inputSelector: 'div[contenteditable="true"][aria-label*="essage" i], div[contenteditable="true"][role="textbox"]',
    usePositionDetection: true,
  },

  'mail.google.com': {
    name: 'Google Chat (in Gmail)',
    messageContainers: ['[data-message-id]', 'div[role="listitem"]'],
    myMessageSelector: null,
    textSelector: '[dir="ltr"] span, [dir="auto"] span',
    inputSelector: 'div[contenteditable="true"][role="textbox"]',
    usePositionDetection: true,
  },

  'www.messenger.com': {
    name: 'Messenger',
    messageContainers: ['div[role="row"]'],
    myMessageSelector: null,
    textSelector: 'div[dir="auto"]',
    inputSelector: 'div[contenteditable="true"][aria-label*="essage" i]',
    usePositionDetection: true,
  },

  'www.facebook.com': {
    name: 'Facebook',
    messageContainers: ['div[role="row"]'],
    myMessageSelector: null,
    textSelector: 'div[dir="auto"]',
    inputSelector: 'div[contenteditable="true"][aria-label*="essage" i]',
    usePositionDetection: true,
  },

  'tinder.com': {
    name: 'Tinder',
    messageContainers: ['.msg', '[class*="msg "]', '[class*="messageList"] > div'],
    myMessageSelector: '.msg--sent, [class*="--sent"]',
    textSelector: '.msg__text, [class*="messageText"], [class*="bubble"]',
    inputSelector: 'textarea[placeholder*="essage" i], textarea',
    usePositionDetection: true,
  },

  'web.snapchat.com': {
    name: 'Snapchat',
    messageContainers: ['[data-testid="chat-message"]', '[class*="ChatMessage"]', '[class*="message"]'],
    myMessageSelector: null,
    textSelector: 'p, [class*="text"]',
    inputSelector: 'div[contenteditable="true"], input[type="text"]',
    usePositionDetection: true,
  },

  // ── Discord ────────────────────────────────────────────────────────────
  'discord.com': {
    name: 'Discord',
    messageContainers: ['li[id^="chat-messages"]', '[class*="message"][id^="chat-messages"]'],
    myMessageSelector: null, // Discord doesn't visually distinguish your own messages
    textSelector: '[id^="message-content"], [class*="messageContent"]',
    inputSelector: 'div[role="textbox"][contenteditable="true"]',
    usePositionDetection: false, // all messages are left-aligned on Discord
  },

  // ── X / Twitter DMs — disabled for now (excluded in manifest) ─────────
  // 'x.com': { ... },
  // 'twitter.com': { ... },

  // ── LinkedIn Messaging ─────────────────────────────────────────────────
  'www.linkedin.com': {
    name: 'LinkedIn',
    messageContainers: ['.msg-s-message-list__event', 'li.msg-s-event-listitem'],
    myMessageSelector: '.msg-s-event-listitem--other-self, .msg-s-event-listitem:not(.msg-s-event-listitem--other)',
    textSelector: '.msg-s-event-listitem__body, p',
    inputSelector: 'div[contenteditable="true"].msg-form__contenteditable, div.msg-form__contenteditable[contenteditable="true"]',
    usePositionDetection: false,
  },

  // ── Telegram Web ───────────────────────────────────────────────────────
  'web.telegram.org': {
    name: 'Telegram',
    messageContainers: ['.message', '.Message'],
    myMessageSelector: '.message.is-out, .Message.own',
    textSelector: '.text-content, .message-content, .text',
    inputSelector: 'div[contenteditable="true"][role="textbox"], .input-message-input[contenteditable="true"]',
    usePositionDetection: true,
  },

  // ── Slack — disabled for now (excluded in manifest) ──────────────────
  // 'app.slack.com': { ... },
};

// Match hostname against config keys, with subdomain fallback.
function getPlatformConfig() {
  const host = window.location.hostname;
  if (PLATFORM_CONFIGS[host]) return PLATFORM_CONFIGS[host];

  // Subdomain fallback — match anything ending with a known root
  for (const key of Object.keys(PLATFORM_CONFIGS)) {
    if (host.endsWith('.' + key) || host === key) {
      return PLATFORM_CONFIGS[key];
    }
  }
  return null;
}
