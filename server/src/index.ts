/**
 * src/index.ts — Punto de entrada del servidor ConVía Face Verification
 *
 * El procesamiento facial ocurre completamente en el dispositivo.
 * Este proceso queda reservado para autenticación y health-check futuros.
 */

import express from 'express';

const app = express();
const PORT = parseInt(process.env['PORT'] ?? '4000', 10);
// ─── Health-check ────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'convia-auth-backend', ts: new Date().toISOString() });
});

// ─── Inicio ───────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ConVía auth backend running on http://0.0.0.0:${PORT}`);
});
