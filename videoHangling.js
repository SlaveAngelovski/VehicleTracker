const fs = require('fs');
const { PassThrough } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const JpegFrameParser = require('./jpeg-frame-parser');
const path = require('path');

// const tf = require('@tensorflow/tfjs-node');
const tf = require('@tensorflow/tfjs-node-gpu');
const cocoSsd = require('@tensorflow-models/coco-ssd');
const { Tracker } = require('node-moving-things-tracker');

// Load calibration
const { pixelsPerMeter, ignoredAreas } =
  JSON.parse(fs.readFileSync('calibration.json'));

// Create output directory for annotated videos
const outputDir = path.join(__dirname, 'public', 'annotated');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}
