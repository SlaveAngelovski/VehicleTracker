const fs = require('fs');
const { PassThrough } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const JpegFrameParser = require('./jpeg-frame-parser');
const path = require('path');

// const tf = require('@tensorflow/tfjs-node');
const tf = require('@tensorflow/tfjs-node-gpu');
const cocoSsd = require('@tensorflow-models/coco-ssd');
const { Tracker } = require('node-moving-things-tracker');
const { isInsideSomeAreas } = require('node-moving-things-tracker/utils');

// Import the drawing functions
const { drawAnnotatedFrame } = require('./draw');

// Load calibration
const { pixelsPerMeter, ignoredAreas } =
  JSON.parse(fs.readFileSync('calibration.json'));

// Create output directory for annotated videos
const outputDir = path.join(__dirname, 'public', 'annotated');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Function to create annotated video stream
function createAnnotatedVideoStream(inputPath) {
  const outputPath = path.join(outputDir, `annotated_${Date.now()}.mp4`);
  const frameBuffer = [];
  let processingComplete = false;
  
  // Create a writable stream that collects annotated frames
  const annotatedFrameStream = new PassThrough();
  
  // Set up FFmpeg to create the output video from the stream
  const outputVideo = ffmpeg()
    .input(annotatedFrameStream)
    .inputFormat('image2pipe')
    .inputOptions([
      '-f', 'image2pipe'
    ])
    .outputOptions([
      '-vf', `scale=1000:-1,showinfo`,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-an',
    ])
    .on('start', (commandLine) => {
      console.log('Creating annotated video:', commandLine);
    })
    .on('progress', (progress) => {
      console.log('Video creation progress:', Math.round(progress.percent || 0) + '%');
    })
    .on('end', () => {
      console.log('Annotated video created:', outputPath);
    })
    .on('error', (err) => {
      console.error('Video creation error:', err);
    })
    .save(outputPath);

  return {
    stream: annotatedFrameStream,
    outputPath,
    outputVideo
  };
}
