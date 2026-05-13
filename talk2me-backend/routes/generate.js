const express = require('express');
const router = express.Router();

// ── Pick a Groq API key at random ─────────────────────────────────────────
function pickGroqKey() {
  const keys = [process.env.GROQ_API_KEY_1, process.env.GROQ_API_KEY_2].filter(Boolean);
  if (keys.length === 0) {
    throw new Error('No GROQ_API_KEY_1 or GROQ_API_KEY_2 set in .env');
  }
  return keys[Math.floor(Math.random() * keys.length)];
}

// ── System prompt ──────────────────────────────────────────────────────────
function buildSystemPrompt() {
  return `You are Talk2Me, an AI assistant that generates natural chat message replies.

Given a conversation history between two people, generate the next reply from the user's perspective.

Rules:
- Match the tone, style, and language of the user's previous messages exactly
- Keep it conversational and concise — like a real chat message, not an essay
- If the conversation is in Hindi, Hinglish, or any other language, reply in that same language
- If casual, be casual. If formal, be formal. Mirror the energy.
- Output ONLY the reply text — no explanations, no quotes, no prefixes like "Reply:" or "You:"
- Never generate audio, files, images, or any non-text content`;
}

// ── User prompt builder ───────────────────────────────────────────────────
function buildUserPrompt(messages, additionalPrompt) {
  const lines = messages.map((m) => {
    const label = m.sender === 'you' ? 'You' : m.sender === 'unknown' ? 'Context' : 'Them';
    return `${label}: ${m.text}`;
  });

  let prompt = `Conversation:\n${lines.join('\n')}\n\nGenerate the next reply from "You":`;

  if (additionalPrompt) {
    prompt += `\n\nAdditional instructions: ${additionalPrompt}`;
  }

  return prompt;
}

// ── Groq adapter ──────────────────────────────────────────────────────────
async function callGroq(systemPrompt, userPrompt) {
  const apiKey = pickGroqKey();
  const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 500,
      temperature: 0.85,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Groq error ${res.status}`);
  }

  const data = await res.json();
  return data.choices[0].message.content.trim();
}

// ── Route ─────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { messages, additionalPrompt } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required and must not be empty' });
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(messages, additionalPrompt);

  try {
    const reply = await callGroq(systemPrompt, userPrompt);
    res.json({ reply });
  } catch (err) {
    console.error('[talk2me] generate error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
