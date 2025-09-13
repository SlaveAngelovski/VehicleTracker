const fs = require('fs');
const { PassThrough } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const JpegFrameParser = require('./jpeg-frame-parser');
const path = require('path');

// const tf = require('@tensorflow/tfjs-node');
const tf = require('@tensorflow/tfjs-node-gpu');
const cocoSsd = require('@tensorflow-models/coco-ssd');
const { Tracker } = require('node-moving-things-tracker');
