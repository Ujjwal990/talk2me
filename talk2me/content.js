(function () {
  'use strict';

  // ─── State ────────────────────────────────────────────────────────────────
  let lastFocusedInput = null;
  let promptBoxEl = null;
  let recognition = null;
  let currentMessages = [];
  let isGenerating = false;

  // ─── Track last focused chat input ────────────────────────────────────────
  // We store a reference BEFORE the user selects text, so we know where to inject.
  // CRITICAL: ignore focus events on the prompt box itself — otherwise the
  // prompt's textarea overwrites lastFocusedInput and we inject into ourselves.
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (el.closest('#talk2me-box')) return;

    if (
      el.getAttribute('contenteditable') === 'true' ||
      el.tagName === 'TEXTAREA' ||
      (el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'submit')
    ) {
      lastFocusedInput = el;
    }
  });

  console.log('[Talk2Me] 🟢 Content script loaded on', window.location.hostname);

  // ─── Shortcut: triggered by chrome.commands → background.js → here ────────
  // We use the commands API (not a raw keydown listener) because Ctrl+Shift+A
  // is a built-in Chrome shortcut (Search Tabs) that intercepts keydown events
  // before any content script can see them.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    console.log('[Talk2Me] 📨 Message received:', msg);
    if (msg.type === 'TRIGGER_SHORTCUT') {
      handleShortcut();
      sendResponse({ ok: true });
    }
  });

  // ─── Main handler ─────────────────────────────────────────────────────────
  function handleShortcut() {
    const selection = window.getSelection();
    const hasSelection = selection && !selection.isCollapsed && selection.toString().trim();

    if (!hasSelection) {
      // With all_frames: true every frame on the page receives this message,
      // but only the frame containing the selection should react. Other
      // frames stay silent to avoid duplicate toasts across iframes.
      if (document.hasFocus()) {
        showToast('Select some chat text first, then press Ctrl+Shift+A');
      }
      return;
    }

    currentMessages = extractMessagesFromSelection(selection);

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    showPromptBox(rect);
  }

  // ─── Message extraction ───────────────────────────────────────────────────
  function extractMessagesFromSelection(selection) {
    const config = getPlatformConfig();
    const range = selection.getRangeAt(0);
    const messages = [];

    if (!config) {
      // Generic fallback: raw selected text, sender unknown
      return [{ sender: 'unknown', text: selection.toString().trim() }];
    }

    const selector = config.messageContainers.join(', ');
    const allMsgEls = document.querySelectorAll(selector);

    allMsgEls.forEach((el) => {
      if (!range.intersectsNode(el)) return;

      const textEl = el.querySelector(config.textSelector);
      const text = (textEl || el).textContent.trim();
      if (!text) return;

      let sender = 'them';

      if (!config.usePositionDetection && config.myMessageSelector) {
        sender = el.matches(config.myMessageSelector) ? 'you' : 'them';
      } else {
        sender = detectSenderByPosition(el);
      }

      messages.push({ sender, text });
    });

    // If DOM selectors found nothing, fall back to raw text
    if (messages.length === 0) {
      return [{ sender: 'unknown', text: selection.toString().trim() }];
    }

    return messages;
  }

  // Right-aligned element = "you" heuristic used on React-heavy platforms
  function detectSenderByPosition(el) {
    const rect = el.getBoundingClientRect();
    const viewportCenter = window.innerWidth / 2;
    if (rect.left + rect.width / 2 > viewportCenter) return 'you';

    // Walk up 6 levels checking for flex-end alignment
    let node = el;
    for (let i = 0; i < 6; i++) {
      if (!node) break;
      const style = window.getComputedStyle(node);
      if (
        style.justifyContent === 'flex-end' ||
        style.alignSelf === 'flex-end' ||
        style.alignItems === 'flex-end' ||
        style.marginLeft === 'auto'
      ) return 'you';
      node = node.parentElement;
    }

    return 'them';
  }

  // ─── Prompt Box ───────────────────────────────────────────────────────────
  function showPromptBox(selectionRect) {
    destroyPromptBox();

    const box = document.createElement('div');
    box.id = 'talk2me-box';

    const youCount = currentMessages.filter(m => m.sender === 'you').length;
    const themCount = currentMessages.filter(m => m.sender === 'them').length;
    const contextLabel = currentMessages.length === 1 && currentMessages[0].sender === 'unknown'
      ? 'Raw text captured (platform not detected)'
      : `${currentMessages.length} messages — ${youCount} yours, ${themCount} theirs`;

    box.innerHTML = `
      <div class="t2m-header" data-drag-handle>
        <div class="t2m-header-left">
          <span class="t2m-drag-grip" aria-hidden="true">⋮⋮</span>
          <span class="t2m-logo">Talk2Me</span>
        </div>
        <button class="t2m-close" title="Close (Esc)">✕</button>
      </div>
      <div class="t2m-context-badge">${contextLabel}</div>
      <div class="t2m-input-row">
        <textarea class="t2m-extra" placeholder="Add context or instructions (optional)..." rows="2" spellcheck="false"></textarea>
        <button class="t2m-mic" title="Dictate instructions">🎤</button>
      </div>
      <button class="t2m-generate-btn">✨ Generate Reply</button>
      <div class="t2m-loading" style="display:none">
        <div class="t2m-spinner"></div>
        <span>Thinking...</span>
      </div>
      <div class="t2m-error-msg" style="display:none"></div>
      <div class="t2m-result" style="display:none">
        <div class="t2m-result-label">Generated Reply</div>
        <div class="t2m-result-text"></div>
        <div class="t2m-result-actions">
          <button class="t2m-use-btn">Use It</button>
          <button class="t2m-retry-btn">↺ Retry</button>
        </div>
      </div>
    `;

    document.body.appendChild(box);
    promptBoxEl = box;
    positionBox(box, selectionRect);

    box.querySelector('.t2m-close').addEventListener('click', destroyPromptBox);
    box.querySelector('.t2m-generate-btn').addEventListener('click', onGenerate);
    box.querySelector('.t2m-mic').addEventListener('click', toggleDictation);
    box.querySelector('.t2m-use-btn').addEventListener('click', onUseIt);
    box.querySelector('.t2m-retry-btn').addEventListener('click', onRetry);

    enableDragging(box, box.querySelector('.t2m-header'));

    // Prevent shortcut from firing again when focused inside the box
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { destroyPromptBox(); return; }
      e.stopPropagation();
    }, true);

    setTimeout(() => box.querySelector('.t2m-extra')?.focus(), 60);
    document.addEventListener('keydown', onGlobalEscape);
  }

  // Box is position:fixed, so coordinates are viewport-relative
  function positionBox(box, rect) {
    const boxW = 380;
    const gap = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = rect.left;
    let top = rect.bottom + gap;

    if (left + boxW > vw - gap) left = vw - boxW - gap;
    if (left < gap) left = gap;

    // Flip above the selection if it would go off the bottom
    if (top + 320 > vh) top = Math.max(gap, rect.top - 320 - gap);

    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
  }

  // Click-and-drag the box by its header
  function enableDragging(box, handle) {
    let dragging = false;
    let startX = 0, startY = 0, originLeft = 0, originTop = 0;

    handle.addEventListener('mousedown', (e) => {
      // Don't drag if clicking the close button (or anything interactive in header)
      if (e.target.closest('.t2m-close')) return;
      dragging = true;
      const rect = box.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      originLeft = rect.left;
      originTop = rect.top;
      box.classList.add('t2m-dragging');
      e.preventDefault();
    });

    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);

    function onDragMove(e) {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rect = box.getBoundingClientRect();

      // Clamp to viewport so the box never disappears off-screen
      const left = Math.max(0, Math.min(vw - rect.width, originLeft + dx));
      const top  = Math.max(0, Math.min(vh - 40, originTop + dy));

      box.style.left = `${left}px`;
      box.style.top  = `${top}px`;
    }

    function onDragEnd() {
      if (!dragging) return;
      dragging = false;
      box.classList.remove('t2m-dragging');
    }
  }

  function destroyPromptBox() {
    stopDictation();
    promptBoxEl?.remove();
    promptBoxEl = null;
    isGenerating = false;
    document.removeEventListener('keydown', onGlobalEscape);
  }

  function onGlobalEscape(e) {
    if (e.key === 'Escape') destroyPromptBox();
  }

  // ─── Generate ─────────────────────────────────────────────────────────────
  async function onGenerate() {
    if (isGenerating) return;
    const extra = promptBoxEl.querySelector('.t2m-extra').value.trim();
    await generateAndShow(extra);
  }

  async function onRetry() {
    if (isGenerating) return;
    const extra = promptBoxEl.querySelector('.t2m-extra').value.trim();
    await generateAndShow(extra);
  }

  async function generateAndShow(additionalPrompt) {
    isGenerating = true;

    const loadingEl = promptBoxEl.querySelector('.t2m-loading');
    const errorEl = promptBoxEl.querySelector('.t2m-error-msg');
    const resultEl = promptBoxEl.querySelector('.t2m-result');
    const genBtn = promptBoxEl.querySelector('.t2m-generate-btn');

    loadingEl.style.display = 'flex';
    errorEl.style.display = 'none';
    resultEl.style.display = 'none';
    genBtn.disabled = true;

    try {
      const settings = await loadSettings();

      const response = await chrome.runtime.sendMessage({
        type: 'GENERATE_REPLY',
        payload: {
          messages: currentMessages,
          additionalPrompt,
          backendUrl: settings.backendUrl,
        },
      });

      if (response.error) {
        showError(response.error);
        return;
      }

      promptBoxEl.querySelector('.t2m-result-text').textContent = response.text;
      resultEl.style.display = 'block';

    } catch (err) {
      showError(err.message || 'Something went wrong');
    } finally {
      loadingEl.style.display = 'none';
      genBtn.disabled = false;
      isGenerating = false;
    }
  }

  function showError(msg) {
    if (!promptBoxEl) return;
    const loadingEl = promptBoxEl.querySelector('.t2m-loading');
    const errorEl = promptBoxEl.querySelector('.t2m-error-msg');
    loadingEl.style.display = 'none';
    errorEl.textContent = `⚠ ${msg}`;
    errorEl.style.display = 'block';
  }

  // ─── Use It ───────────────────────────────────────────────────────────────
  function onUseIt() {
    const text = promptBoxEl.querySelector('.t2m-result-text').textContent;
    if (!text) return;
    injectReply(text);
    destroyPromptBox();
  }

  function injectReply(text) {
    const input = lastFocusedInput || findChatInput();
    console.log('[Talk2Me] 💉 Injecting reply →', input);

    if (!input) {
      showToast('Could not find chat input. Click the message box first, then try again.');
      return;
    }

    input.focus();

    // Defer one tick to let focus settle (especially important since the
    // prompt box just had focus a moment ago).
    setTimeout(() => {
      if (input.getAttribute('contenteditable') === 'true') {
        injectIntoContentEditable(input, text);
      } else if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
        injectIntoNativeInput(input, text);
      }
    }, 0);
  }

  // WhatsApp Web uses Lexical (Meta's rich-text editor), Instagram/Messenger
  // use similar React-backed editors.
  function injectIntoContentEditable(input, text) {
    input.focus();

    // Put the cursor inside the element + select existing content
    const sel = window.getSelection();
    sel.selectAllChildren(input);

    // Try paste event first (works for Lexical / React editors)
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    const pasteEvent = new ClipboardEvent('paste', {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(pasteEvent);

    // Verify after a tick — if the text didn't actually land, fall back to
    // execCommand which works on plain contenteditable elements.
    setTimeout(() => {
      const sample = text.substring(0, Math.min(15, text.length));
      const landed = input.textContent.includes(sample);
      console.log('[Talk2Me] paste landed?', landed, '| content:', input.textContent);

      if (!landed) {
        console.log('[Talk2Me] Falling back to execCommand');
        input.focus();
        const sel2 = window.getSelection();
        sel2.selectAllChildren(input);
        document.execCommand('delete');
        document.execCommand('insertText', false, text);
        input.dispatchEvent(new InputEvent('input', {
          bubbles: true, data: text, inputType: 'insertText',
        }));
      }
    }, 50);
  }

  function injectIntoNativeInput(input, text) {
    const proto = input.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function findChatInput() {
    const config = getPlatformConfig();
    if (config?.inputSelector) {
      const el = document.querySelector(config.inputSelector);
      if (el) return el;
    }
    // Generic fallbacks in priority order
    return (
      document.querySelector('div[contenteditable="true"]') ||
      document.querySelector('textarea') ||
      document.querySelector('input[type="text"]')
    );
  }

  // ─── Dictation ────────────────────────────────────────────────────────────
  function toggleDictation() {
    if (recognition) {
      stopDictation();
    } else {
      startDictation();
    }
  }

  function startDictation() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      showToast('Speech recognition not supported in this browser');
      return;
    }

    const textarea = promptBoxEl?.querySelector('.t2m-extra');
    const micBtn = promptBoxEl?.querySelector('.t2m-mic');
    if (!textarea) return;

    recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let committedText = textarea.value;
    // Insert a space if there's already text and it doesn't end with one
    if (committedText && !committedText.endsWith(' ')) committedText += ' ';

    micBtn?.classList.add('t2m-mic-on');

    recognition.onresult = (e) => {
      if (!textarea) return;
      let interim = '';
      let final = '';

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          final += t;
        } else {
          interim += t;
        }
      }

      if (final) {
        committedText += final + ' ';
      }

      // Show committed + live interim
      textarea.value = committedText + interim;
      // Move cursor to end
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    };

    recognition.onend = () => {
      micBtn?.classList.remove('t2m-mic-on');
      recognition = null;
    };

    recognition.onerror = () => stopDictation();

    recognition.start();
  }

  function stopDictation() {
    if (recognition) {
      recognition.stop();
      recognition = null;
    }
    promptBoxEl?.querySelector('.t2m-mic')?.classList.remove('t2m-mic-on');
  }

  // ─── Settings ─────────────────────────────────────────────────────────────
  function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['backendUrl'], (r) => {
        resolve({
          backendUrl: r.backendUrl || 'https://talk2me-backend-production-538e.up.railway.app',
        });
      });
    });
  }

  // ─── Toast notification ───────────────────────────────────────────────────
  function showToast(msg) {
    const el = document.createElement('div');
    el.className = 't2m-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

})();
