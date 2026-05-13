console.log('[Talk2Me] 🟢 Background service worker started');

// List all commands actually registered with Chrome — helps catch the case
// where the manifest says one thing but Chrome didn't bind the shortcut.
chrome.commands.getAll((cmds) => {
  console.log('[Talk2Me] Registered commands:', cmds);
});

// ── Forward keyboard shortcut from Chrome to the active tab ───────────────
chrome.commands.onCommand.addListener((command, tab) => {
  console.log('[Talk2Me] ⌨️  Command fired:', command, '| tab:', tab?.id, tab?.url);
  if (command !== 'trigger-talk2me') return;
  if (!tab?.id) {
    console.warn('[Talk2Me] No active tab id — cannot forward shortcut');
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_SHORTCUT' }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn('[Talk2Me] sendMessage failed:', chrome.runtime.lastError.message);
    } else {
      console.log('[Talk2Me] Content script ack:', response);
    }
  });
});

// ── Generate reply: proxy content script → backend ────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GENERATE_REPLY') {
    handleGenerate(message.payload).then(sendResponse);
    return true; // keep channel open for async response
  }
});

async function handleGenerate({ messages, additionalPrompt, backendUrl }) {
  try {
    const url = `${backendUrl.replace(/\/$/, '')}/api/generate`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, additionalPrompt }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: body.error || `Server error ${res.status}` };
    }

    const data = await res.json();
    return { text: data.reply };

  } catch (err) {
    return { error: `Cannot reach backend: ${err.message}` };
  }
}
