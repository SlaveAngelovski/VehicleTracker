const express = require('express');
const app = express();
app.use(express.static('public'));
app.use(express.static('uploads'));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/upload', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.json({ error: 'No video file uploaded' });
  }
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
  });
});

app.listen(3000, () => console.log('Web server running on http://localhost:3000'));