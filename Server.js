import express from 'express';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import Gun from 'gun';
import 'gun/sea.js';
import 'gun/axe.js';
import 'gun/lib/radisk.js';
import https from 'https';

class Server {
  constructor(bot) {
    this.bot = bot;
    this.serverInstance = null;
    this.setupServer();
  }

  setupServer() {
    if (this.serverInstance) {
      console.log('Server is already running');
      return;
    }

    const app = express();
    const isDebug = process.env.NODE_ENV === 'development';
    const port = process.env.PORT || (isDebug ? 8080 : 443);

    // Setup static file serving and Gun middleware
    app.use(express.static('public'));
    app.use(Gun.serve);

    // Setup avatar endpoints
    this.setupAvatarEndpoints(app);

    // Create server (HTTP for debug, HTTPS for production)
    if (isDebug) {
      this.serverInstance = app.listen(port, () => {
        console.log(`HTTP Server running on port ${port} (debug mode)`);
      });
    } else {
      // SSL certificate configuration
      const sslOptions = {
        key: fs.readFileSync(process.env.SSL_KEY_PATH || 'certs/private.key'),
        cert: fs.readFileSync(process.env.SSL_CERT_PATH || 'certs/certificate.crt'),
      };

      this.serverInstance = https.createServer(sslOptions, app)
        .listen(port, () => {
          console.log(`HTTPS Server running on port ${port}`);
        });
    }

    this.serverInstance.on('error', (error) => {
      console.error(`Failed to start ${isDebug ? 'HTTP' : 'HTTPS'} server:`, error.message);
      this.serverInstance = null;
    });

    // Initialize Gun with server
    this.gun = Gun({
      localStorage: false,
      axe: false,
      web: this.serverInstance,
      file: 'holosphere.db',
      radisk: true,
      multicast: false,
      peers: process.env.GUN_PEERS ? process.env.GUN_PEERS.split(',') : ['https://59.src.eco/gun']
    });

    console.log(`Gun server initialized with ${isDebug ? 'HTTP' : 'HTTPS'}`);
  }

  setupAvatarEndpoints(app) {
    this.avatarsDir = path.join(process.cwd(), 'public', 'avatars');
    if (!fs.existsSync(this.avatarsDir)) {
      fs.mkdirSync(this.avatarsDir, { recursive: true });
    }

    this.defaultAvatarPath = path.join(process.cwd(), 'public', 'default-avatar.png');
    if (!fs.existsSync(this.defaultAvatarPath)) {
      const defaultTemplate = path.join(process.cwd(), 'templates', 'default-avatar.png');
      if (fs.existsSync(defaultTemplate)) {
        fs.copyFileSync(defaultTemplate, this.defaultAvatarPath);
      }
    }

    app.get('/getavatar', async (req, res) => {
      const userId = req.query.user_id;

      if (!userId) {
        return res.sendFile(this.defaultAvatarPath);
      }

      const localAvatarPath = path.join(this.avatarsDir, `${userId}.jpg`);

      if (fs.existsSync(localAvatarPath)) {
        return res.sendFile(localAvatarPath);
      }

      try {
        const fileUrl = await this.getUserPicture(userId);
        if (fileUrl) {
          await this.downloadAndSaveAvatar(fileUrl, userId);
          res.sendFile(localAvatarPath);
        } else {
          res.sendFile(this.defaultAvatarPath);
        }
      } catch (error) {
        console.error('Error retrieving the profile photo for user', userId);
        res.sendFile(this.defaultAvatarPath);
      }
    });
  }

  async downloadAndSaveAvatar(fileUrl, userId) {
    const response = await axios({
      url: fileUrl,
      method: 'GET',
      responseType: 'stream'
    });
    
    const filePath = path.join(this.avatarsDir, `${userId}.jpg`);
    const writer = fs.createWriteStream(filePath);
    
    return new Promise((resolve, reject) => {
      response.data.pipe(writer);
      writer.on('finish', () => resolve(filePath));
      writer.on('error', reject);
    });
  }

  async getUserPicture(userID) {
    try {
      const photos = await this.bot.telegram.getUserProfilePhotos(userID);

      if (photos.total_count > 0) {
        const photo = photos.photos[0].pop();  // Get the highest resolution photo
        const fileId = photo.file_id;
        const fileUrl = await this.bot.telegram.getFileLink(fileId);

        return fileUrl.href || '';
      }
    } catch (error) {
      console.error('Error retrieving the profile photo:', error);
      return ''; 
    }
  }
}

export default Server; 