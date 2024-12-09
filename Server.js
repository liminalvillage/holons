import express from 'express';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

class Server {
  constructor(bot) {
    this.bot = bot;
    this.serverInstance = null;
    this.setupAvatarServer();
  }

  setupAvatarServer() {
    // If server is already running, don't create another one
    if (this.serverInstance) {
      console.log('Avatar server is already running');
      return;
    }

    const app = express();
    const port = process.env.AVATAR_PORT || 80;

    this.avatarsDir = path.join(process.cwd(), 'public', 'avatars');
    if (!fs.existsSync(this.avatarsDir)) {
      fs.mkdirSync(this.avatarsDir, { recursive: true });
    }

    // Path to default avatar
    this.defaultAvatarPath = path.join(process.cwd(), 'public', 'default-avatar.png');
    // Create default avatar if it doesn't exist
    if (!fs.existsSync(this.defaultAvatarPath)) {
      // Copy from templates or create a basic icon
      const defaultTemplate = path.join(process.cwd(), 'templates', 'default-avatar.png');
      if (fs.existsSync(defaultTemplate)) {
        fs.copyFileSync(defaultTemplate, this.defaultAvatarPath);
      }
    }

    app.use(express.static('public'));

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
        console.error('Error retrieving the profile photo:', error);
        res.sendFile(this.defaultAvatarPath);
      }
    });

    this.serverInstance = app.listen(port, () => {
      console.log(`Avatar server is running at http://localhost:${port}`);
    }).on('error', (error) => {
      console.error('Failed to start avatar server:', error.message);
      this.serverInstance = null;  // Reset on error
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