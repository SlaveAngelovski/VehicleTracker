import fs from 'fs';
import { PassThrough } from 'stream';
import ffmpeg from 'fluent-ffmpeg';
import JpegFrameParser from './jpeg-frame-parser.js';
import path from 'path';
import tf from '@tensorflow/tfjs-node-gpu';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import { Tracker } from 'node-moving-things-tracker';
import { isInsideSomeAreas } from 'node-moving-things-tracker/utils.js';
import { drawAnnotatedFrame } from './draw.js';
import { cleanupFrames, createVideoFromFrames, processAnalysisResults, saveFrame, timeStringToSeconds } from './videoUtils.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Load calibration
const { pixelsPerMeter, ignoredAreas } = JSON.parse(fs.readFileSync('calibration.json'));

// Create output directory for annotated videos
const outputDir = path.join(__dirname, 'public', 'annotated');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Enhanced frame extraction with timestamps
function getFrameStreamWithTimestamps(videoPath) {
  const stream = new PassThrough();
  const frameTimestamps = [];

  ffmpeg(videoPath)
    .inputOptions(['-threads', '0'])
    .outputOptions([
      '-vf', 'scale=1000:-1,showinfo',
      '-q:v', '2',
      '-f', 'image2pipe',
      '-c:v', 'mjpeg',
      '-an'
    ])
    // .on('stderr', (stderrLine) => {
    //   const match = stderrLine.match(/pts_time:([0-9.]+)/);
    //   if (match) {
    //     frameTimestamps.push(parseFloat(match[1]));
    //   }
    // })
    .on('progress', (progress) => {
      // frameTimestamps.push(progress.timemark);
      const timeInSeconds = timeStringToSeconds(progress.timemark);

      frameTimestamps.push(timeInSeconds);
    })
    .on('process', (commandLine) => {
      console.log('Started ffmpeg with command:', commandLine);
    })
    .on('error', (err) => {
      console.error('An ffmpeg error occurred: ' + err.message);
      stream.emit('error', err);
    })
    .pipe(stream, { end: true });

  const parsedStream = stream.pipe(new JpegFrameParser());
  parsedStream.frameTimestamps = frameTimestamps;
  
  return parsedStream;
}

// Main analysis function
export default async function analyseVideo(videoPath) {
  const model = await cocoSsd.load({ base: 'mobilenet_v2' });
  Tracker.reset();

  Tracker.setParams({
    unMatchedFramesTolerance: 10,
    iouLimit: 0.05,
    fastDelete: false,
    distanceLimit: 10000,
    matchingAlgorithm: 'munkres',
  });

  const lastPos = new Map();
  const results = [];
  let currentFrame = 0;

  // Create annotated frame saver
  const frameStream = getFrameStreamWithTimestamps(videoPath);

  return new Promise((resolve, reject) => {
    frameStream.on('data', async chunk => {
      try {
        // const img = tf.node.decodeImage(chunk, 3);
        const img = tf.node.decodeJpeg(chunk);
        const preds = await model.detect(img, 20, 0.3);
        img.dispose();

        const vehicles = preds.filter(p =>
          ['car','truck','bus','motorcycle','bike'].includes(p.class)
        );

        let detectionScaledOfThisFrame = vehicles.map((p) => ({
          x: Math.round(p.bbox[0]),
          y: Math.round(p.bbox[1]),
          w: Math.round(p.bbox[2]),
          h: Math.round(p.bbox[3]),
          confidence: p.score * 100,
          name: p.class,
          bbox: p.bbox,
        }));

        const originalDetections = [...detectionScaledOfThisFrame];

        // Filter out detections in ignored areas
        if (ignoredAreas?.length > 0) {
          detectionScaledOfThisFrame = detectionScaledOfThisFrame.filter(detection => 
            !isInsideSomeAreas(ignoredAreas, detection)
          );
        }

        Tracker.updateTrackedItemsWithNewFrame([...detectionScaledOfThisFrame], currentFrame);
        const tracked = Tracker.getJSONOfTrackedItems();

        // Get timestamp and ensure it's a number
        const rawTimestamp = frameStream.frameTimestamps[currentFrame];
        const currentTimestamp = typeof rawTimestamp === 'number' ? rawTimestamp : (currentFrame / 30); // fallback to 30fps estimate
        // const currentTimestamp = frameStream.frameTimestamps[currentFrame];

        // Calculate speeds for tracked objects
        const trackedWithSpeeds = tracked.map(obj => {
          const cx = obj.x + obj.w/2;
          const cy = obj.y + obj.h/2;
          const id = obj.id;
          let speedKmh = 0;

          if (lastPos.has(id)) {
            const { px, py, timestamp: lastTimestamp } = lastPos.get(id);
            const dt = currentTimestamp - lastTimestamp;
            
            const distPx = Math.hypot(cx - px, cy - py);
            const meters = distPx / pixelsPerMeter;
            const mps = meters / dt;
            speedKmh = mps * 3.6; // convert to km/h
          }

          const validSpeed = Number.isFinite(speedKmh) ? Math.round(speedKmh) : 0;

          results.push({
            id,
            timestamp: new Date(Date.now() + (currentTimestamp * 1000)).toISOString(),
            frame: currentFrame,
            actualTime: currentTimestamp,
            speed_kmh: validSpeed,
            bbox: originalDetections.map(d => d.bbox),
          });

          lastPos.set(id, { 
            px: cx, 
            py: cy, 
            timestamp: currentTimestamp,
            frame: currentFrame
          });

          obj.speed = validSpeed;

          // return { ...obj, speed: validSpeed };
          return obj;
        });

        // Create and save annotated frame
        const annotatedBuffer = await drawAnnotatedFrame(
          chunk,
          originalDetections,
          trackedWithSpeeds,
          ignoredAreas || [],
          currentFrame,
          currentTimestamp
        );

        await saveFrame(annotatedBuffer, currentFrame, outputDir);
        currentFrame++;
        
        if (currentFrame % 30 === 0) {
          console.log(`Processed ${currentFrame} frames...`);
        }

      } catch (err) {
        console.error('Frame processing error:', err);
      }
    });

    frameStream.on('end', async () => {
      const filteredBySpeed = await processAnalysisResults(results, outputDir);

      console.log(`Analysis complete. Processing ${currentFrame} annotated frames...`);
      console.log(`Found ${filteredBySpeed.length} unique vehicles with speeds.`);
      
      try {
        const videoPath = await createVideoFromFrames(outputDir);
        const resolvedFiltered = await Promise.all(filteredBySpeed);
        
        resolve({
          success: true,
          vehicleCount: resolvedFiltered.length,
          frameCount: currentFrame,
          results: resolvedFiltered,
          annotatedVideo: videoPath ? path.basename(videoPath) : null,
          outputPath: outputDir
        });
      } catch (videoErr) {
        console.error('Video creation failed, but analysis complete:', videoErr);
        cleanupFrames(outputDir);
        
        resolve({
          success: false,
          vehicleCount: resolvedFiltered.length,
          frameCount: currentFrame,
          results: resolvedFiltered,
          annotatedVideo: null,
          error: videoErr.message
        });
      }
    });

    frameStream.on('error', err => {
      cleanupFrames(outputDir);
      reject({
        success: false,
        error: err.message,
        results: []
      });
    });
  });
}