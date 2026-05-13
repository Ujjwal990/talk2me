require('dotenv').config();
const express = require('express');
const cors = require('cors');
const generateRoute = require('./routes/generate');

const app = express();
const PORT = process.env.PORT || 3000;

// Allow requests from Chrome extensions (origin: chrome-extension://...)
app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(express.json({ limit: '1mb' }));

app.use('/api/generate', generateRoute);

app.get('/health', (_req, res) => res.json({ status: 'ok', version: '1.0.0' }));

app.get('/', (_req, res) => {
  res.send(`
    <html>
      <head>
        <title>Talk2Me Backend</title>
        <style>
          body { font-family: -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; padding: 40px; }
          h1 { background: linear-gradient(90deg, #a78bfa, #38bdf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
          code { background: #1e293b; padding: 3px 8px; border-radius: 6px; color: #a78bfa; }
          .ok { color: #34d399; }
        </style>
      </head>
      <body>
        <h1>Talk2Me Backend</h1>
        <p class="ok">✓ Server is running</p>
        <p>POST <code>/api/generate</code> — generate a chat reply</p>
        <p>GET <code>/health</code> — health check</p>
      </body>
    </html>
  `);
});

// 404
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => {
  console.log(`Talk2Me backend running → http://localhost:${PORT}`);
});
