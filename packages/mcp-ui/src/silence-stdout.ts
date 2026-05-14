// Stdio MCP reserves stdout for JSON-RPC frames. Any stray console.log
// from a dependency corrupts the transport, so redirect it to stderr.
// process.stdout.write is intentionally NOT patched — the MCP transport
// uses it directly to emit protocol frames.
console.log = console.error;
console.info = console.error;
