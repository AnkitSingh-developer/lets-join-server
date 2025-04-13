const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const Buffer = require('buffer').Buffer;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Adjust for security in production
    methods: ['GET', 'POST'],
  },
});

// Directory to store recordings
const recordingsDir = path.join(__dirname, 'recordings');
if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir, { recursive: true });
}

// Serve static files for accessing recordings
app.use(express.json());
app.use('/recordings', express.static(recordingsDir));

// Route to list recordings for a room
app.get('/recordings/:roomId', (req, res) => {
  const roomDir = path.join(recordingsDir, req.params.roomId);
  if (!fs.existsSync(roomDir)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  const files = fs.readdirSync(roomDir).map(file => ({
    fileName: file,
    url: `/recordings/${req.params.roomId}/${file}`,
  }));
  res.json({ files });
});

io.on('connection', (socket) => {
  console.log('New client connected for recording:', socket.id);

  socket.on('upload-recording', async ({ roomId, userId, fileData, fileName, isRemote }) => {
    console.log('Received upload-recording event:', { roomId, userId, fileName, isRemote });

    try {
      // Validate inputs
      if (!roomId || !userId || !fileName) {
        throw new Error('Missing required fields: roomId, userId, or fileName');
      }

      const roomDir = path.join(recordingsDir, roomId);
      if (!fs.existsSync(roomDir)) {
        fs.mkdirSync(roomDir, { recursive: true });
      }

      let filePath = path.join(roomDir, fileName);

      if (isRemote) {
        console.log(`Ignoring remote recording metadata: ${fileName}`);
        socket.emit('recording-saved', { fileName, userId });
        return;
      }

      if (typeof fileData === 'string') {
        try {
          const buffer = Buffer.from(fileData, 'base64');
          if (buffer.length < 100) {
            throw new Error('File data too small, likely corrupted');
          }
          console.log('Buffer length:', buffer.length);
          fs.writeFileSync(filePath, buffer);
          console.log(`Recording saved to ${filePath}`);

          // Convert AAC to high-quality MP3
          const mp3FileName = fileName.replace('.aac', '.mp3');
          const mp3FilePath = path.join(roomDir, mp3FileName);
          exec(
            `ffmpeg -i "${filePath}" -acodec mp3 -ar 48000 -ab 192k -ac 2 "${mp3FilePath}"`,
            (error, stdout, stderr) => {
              if (error) {
                console.error('FFmpeg conversion error:', error.message, stderr);
                socket.emit('save-error', { error: `MP3 conversion failed: ${error.message}`, fileName, userId });
                return;
              }
              console.log(`Converted to MP3: ${mp3FilePath}`);
              socket.emit('recording-saved', { fileName, userId, mp3FileName });
            }
          );
        } catch (decodeErr) {
          throw new Error(`Base64 decoding failed: ${decodeErr.message}`);
        }
      } else {
        throw new Error('Unsupported file data format or missing data');
      }
    } catch (err) {
      console.error('Recording save failed:', err.message);
      socket.emit('save-error', { error: err.message, fileName, userId });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });

  socket.on('error', (error) => {
    console.error('Socket error:', error);
  });
});

server.on('error', (err) => {
  console.error('Server error:', err);
});

server.listen(3000, () => {
  console.log('Recording server running on port 3000');
  console.log(`Recordings accessible at http://localhost:3000/recordings/`);
});

process.on('SIGTERM', () => {
  server.close(() => {
    console.log('Server shut down');
  });
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});