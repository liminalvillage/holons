#!/usr/bin/env node
/**
 * Quick MCP client — call a tool on the running HolonsBot MCP server.
 * Usage: node mcp/client.js <tool> [json-params]
 * Example: node mcp/client.js get_lens '{"holon":"235114395","lens":"quests"}'
 */
import http from 'http';

const PORT = 3100;
const [,, tool, paramsJson] = process.argv;

if (!tool) {
  console.log('Usage: node mcp/client.js <tool> [json-params]');
  console.log('Tools: list_holons, get_lens, get_item, put_item, delete_item, get_holon_info, get_federation, search_holon, create_quest, get_global');
  process.exit(0);
}

const params = paramsJson ? JSON.parse(paramsJson) : {};

// Connect SSE first, then send tool call
const sseReq = http.get(`http://localhost:${PORT}/sse`, (res) => {
  let sessionUrl = '';
  
  res.on('data', (chunk) => {
    const lines = chunk.toString().split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const msg = JSON.parse(line.slice(6));
          // Handle initialize response
          if (msg.id === 1 && msg.result?.serverInfo) {
            // Send tools/call
            const callBody = JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              method: 'tools/call',
              params: { name: tool, arguments: params }
            });
            
            const postReq = http.request(`http://localhost:${PORT}${sessionUrl}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' }
            }, () => {});
            postReq.write(callBody);
            postReq.end();
          }
          // Handle tool result
          if (msg.id === 2 && msg.result) {
            const text = msg.result.content?.[0]?.text || JSON.stringify(msg.result);
            console.log(text);
            process.exit(0);
          }
          if (msg.id === 2 && msg.error) {
            console.error('Error:', msg.error.message);
            process.exit(1);
          }
        } catch {}
      }
      if (line.startsWith('event: endpoint')) {
        // Next data line has the endpoint URL
      }
      // Capture the messages endpoint
      if (line.startsWith('data: /messages') || line.startsWith('data: http')) {
        sessionUrl = line.slice(6).trim();
        if (sessionUrl.startsWith('http')) {
          sessionUrl = new URL(sessionUrl).pathname + new URL(sessionUrl).search;
        }
        // Send initialize
        const initBody = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'atlas-cli', version: '1.0' }
          }
        });
        
        const postReq = http.request(`http://localhost:${PORT}${sessionUrl}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }, () => {});
        postReq.write(initBody);
        postReq.end();
      }
    }
  });
});

sseReq.on('error', (e) => {
  console.error(`MCP server not running on port ${PORT}:`, e.message);
  process.exit(1);
});

// Timeout
setTimeout(() => { console.error('Timeout'); process.exit(1); }, 30000);
