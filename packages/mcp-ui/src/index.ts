#!/usr/bin/env node
// Load .env from the monorepo root (single source of truth shared with web + bot).
// Falls back silently if the file is missing.
import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, '../../../.env') });
loadDotenv(); // also pick up cwd .env if present (no-op when absent)
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import http from 'http';
import { createServer } from './server.js';

async function main() {
  const server = await createServer();
  const portArg = process.argv.indexOf('--port');
  if (portArg !== -1 && process.argv[portArg + 1]) {
    const port = parseInt(process.argv[portArg + 1], 10);
    let sseTransport: SSEServerTransport | undefined;
    const httpServer = http.createServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/sse') {
        sseTransport = new SSEServerTransport('/messages', res);
        await server.connect(sseTransport);
      } else if (req.method === 'POST' && req.url === '/messages') {
        if (sseTransport) {
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', async () => {
            await sseTransport!.handlePostMessage(req, res, body);
          });
        } else {
          res.writeHead(400);
          res.end('No SSE connection');
        }
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ name: 'holons-mcp-ui', version: '0.1.0' }));
      }
    });
    httpServer.listen(port, () => {
      console.error(`holons-mcp-ui listening on port ${port} (SSE)`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('holons-mcp-ui running on stdio');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
