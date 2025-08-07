import express from 'express';
import fs from 'fs';
import https from 'https';
import Gun from 'gun';

class GunServer {
  constructor() {
    this.serverInstance = null;
    this.setupServer();
  }

  setupServer() {
    if (this.serverInstance) {
      console.log('GunServer is already running');
      return;
    }

    const app = express();
    const isDebug = process.env.NODE_ENV === 'development';
    const port = process.env.GUN_PORT || 8765;

    // Setup static file serving and Gun middleware
    app.use(express.static('public'));
    app.use(Gun.serve);

    if (isDebug) {
      this.serverInstance = app.listen(port, () => {
        console.log(`GunServer HTTP Server running on port ${port} (debug mode)`);
      });
    } else {
      // SSL certificate configuration
      try {
        const sslOptions = {
          key: fs.readFileSync(process.env.SSL_KEY_PATH || 'certs/private.key'),
          cert: fs.readFileSync(process.env.SSL_CERT_PATH || 'certs/certificate.crt'),
        };
        this.serverInstance = https.createServer(sslOptions, app)
          .listen(port, () => {
            console.log(`GunServer HTTPS Server running on port ${port}`);
          });
      } catch (e) {
        console.error("Error setting up HTTPS for GunServer. Defaulting to HTTP.", e.message);
        console.warn("Falling back to HTTP for GunServer. Ensure SSL certs are correctly configured for HTTPS.");
        this.serverInstance = app.listen(port, () => {
          console.log(`GunServer HTTP Server (fallback) running on port ${port}`);
        });
      }
    }

    this.serverInstance.on('error', (error) => {
      console.error(`Failed to start GunServer ${isDebug ? 'HTTP' : 'HTTPS'} server:`, error.message);
      this.serverInstance = null;
    });

    this.gun = Gun({
      axe: false,
      web: this.serverInstance,
      file: 'gun_data.db',
      multicast: false,
      localStorage: false,
      peers: process.env.GUN_PEERS ? process.env.GUN_PEERS.split(',') : []
    });

    console.log(`GunServer initialized with ${this.serverInstance instanceof https.Server ? 'HTTPS' : 'HTTP'}`);
  }

}

export default GunServer;
new GunServer(); 