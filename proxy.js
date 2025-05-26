import http from 'http';
import fs from 'fs';
import httpProxy from 'http-proxy';

// Configuration - Use environment variables or defaults
const PROXY_PORT = process.env.PROXY_PORT || 443;
const AVATAR_SERVER_URL = process.env.AVATAR_SERVER_URL || 'http://localhost:3000'; // Your main app (Server.js)
const GUN_SERVER_URL = process.env.GUN_SERVER_URL || 'http://localhost:8765'; // Your GunServer.js

// Create a proxy server instance
const proxy = httpProxy.createProxyServer({});
const sslOptions = {
    key: fs.readFileSync(process.env.SSL_KEY_PATH || 'certs/private.key'),
    cert: fs.readFileSync(process.env.SSL_CERT_PATH || 'certs/certificate.crt'),
  };
// Create a new HTTP server that will act as the reverse proxy
const server = http.createServer(sslOptions, (req, res) => {
  // Log the incoming request URL
  console.log(`Proxying request: ${req.method} ${req.url}`);

  if (req.url.startsWith('/gun')) {
    // If the request path starts with /gun, proxy to GunServer
    console.log(`Routing to GUN_SERVER: ${GUN_SERVER_URL}${req.url}`);
    proxy.web(req, res, { target: GUN_SERVER_URL, changeOrigin: true }, (err) => {
      console.error('Error proxying to GunServer:', err.message);
      res.writeHead(502); // Bad Gateway
      res.end('Error connecting to the Gun server.');
    });
  } else {
    // Otherwise, proxy to the main Application Server
    console.log(`Routing to AVATAR__SERVER: ${AVATAR_SERVER_URL}${req.url}`);
    proxy.web(req, res, { target: AVATAR_SERVER_URL, changeOrigin: true }, (err) => {
      console.error('Error proxying to AvatarServer:', err.message);
      res.writeHead(502); // Bad Gateway
      res.end('Error connecting to the application server.');
    });
  }
});

// Listen for the 'upgrade' event to proxy WebSockets (important for Gun)
server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/gun')) {
    console.log(`Proxying WebSocket upgrade for GUN_SERVER: ${GUN_SERVER_URL}${req.url}`);
    proxy.ws(req, socket, head, { target: GUN_SERVER_URL, ws: true, changeOrigin: true }, (err) => {
       console.error('Error proxying WebSocket to GunServer:', err.message);
       // socket.destroy(); // It's important to handle errors, or the socket might hang
    });
  } else {
     console.log(`Proxying WebSocket upgrade for AVATAR_SERVER: ${AVATAR_SERVER_URL}${req.url}`);
    // If your main app also uses WebSockets and they don't conflict with /gun path
    proxy.ws(req, socket, head, { target: AVATAR_SERVER_URL, ws: true, changeOrigin: true }, (err) => {
      console.error('Error proxying WebSocket to AvatarServer:', err.message);
      // socket.destroy();
    });
    // If your main app doesn't use WebSockets, or you want to be more specific:
    // socket.destroy();
  }
});

// Handle proxy errors globally (optional, but good for catching issues)
proxy.on('error', (err, req, res) => {
  console.error('Proxy error:', err);
  if (res && !res.headersSent) {
    res.writeHead(500, {
      'Content-Type': 'text/plain'
    });
    res.end('Something went wrong with the proxy.');
  } else if (!res) {
    // This can happen for WebSocket errors where there's no 'res'
    console.error('Proxy error occurred without a response object (likely WebSocket).');
  }
});


server.listen(PROXY_PORT, () => {
  console.log(`Reverse Proxy server listening on port ${PROXY_PORT}`);
  console.log(`-> Forwarding to AVATAR Server: ${AVATAR_SERVER_URL}`);
  console.log(`-> Forwarding /gun requests to Gun Server: ${GUN_SERVER_URL}`);
});