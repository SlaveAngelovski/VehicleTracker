import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import analyseVideo from './videoHandling.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const framesDir = path.join(__dirname, 'frames');

const app = express();
const upload = multer({ dest: 'uploads/' });

function cleanUploadsFolder(req) {
 try {
    const files = fs.readdirSync('uploads/');
    files.forEach(file => {
      const filePath = path.join('uploads', file);
      // Only delete if it's not the current file
      if (filePath !== req.file.path) {
        fs.unlink(filePath, (err) => {
          if (err) console.error('Error deleting old video:', err);
        });
      }
    });

    // clear frames directories
    if (fs.existsSync(framesDir)) {
      fs.rmSync(framesDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error('Error cleaning uploads folder:', err);
  }
}

app.use(express.static('public'));
app.use(express.static('uploads'));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/upload', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.json({ error: 'No video file uploaded' });
  }

  // Clean up old videos before processing new one
  cleanUploadsFolder(req);

  const videoPath = req.file.path;
  let analysisResult = null;
  
  try {
    analysisResult = await analyseVideo(videoPath);
  } catch (err) {
    return res.json({ error: err.message });
  }
  
  // Return both results and annotated video
  res.json({ 
    video: req.file.filename,
    annotatedVideo: analysisResult.annotatedVideo, // New annotated video
    results: analysisResult.results 
  });
});

app.listen(3000, () => console.log('Web server running on http://localhost:3000'));