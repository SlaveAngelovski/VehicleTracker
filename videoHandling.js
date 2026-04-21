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
import { cleanupFrames, createVideoFromFrames, cropVehicleFromFrame, processAnalysisResults, saveFrame, timeStringToSeconds } from './videoUtils.js';
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
    .inputOptions(['-threads', '24'])
    .withNoAudio()
    .size('1000x?')
    .format('mjpeg')
    .outputOptions([
      '-vf', 'showinfo',
      '-q:v', '2',
      '-f', 'image2pipe',
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
    // .on('process', (commandLine) => {
    //   console.log('Started ffmpeg with command:', commandLine);
    // })
    // .on('error', (err) => {
    //   console.error('An ffmpeg error occurred: ' + err.message);
    //   stream.emit('error', err);
    // })
    .pipe(stream, { end: true });

  const parsedStream = stream.pipe(new JpegFrameParser());
  parsedStream.frameTimestamps = frameTimestamps;
  
  return parsedStream;
}

async function trackAndEstimateSpeeds(videoPath) {

}

async function estimateSpeed(currentTrack, originalDetections, currentFrameNumber, currentTimestamp, lastPos, results) {
  const cx = currentTrack.x + currentTrack.w/2;
  const cy = currentTrack.y + currentTrack.h/2;
  const id = currentTrack.id;
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

  return {
    speed: validSpeed,
    id: id,
    results: {
      timestamp: new Date(Date.now() + (currentTimestamp * 1000)).toISOString(),
      frame: currentFrameNumber,
      actualTime: currentTimestamp,
      speed_kmh: validSpeed,
      bbox: originalDetections.map(d => d.bbox),
    },
    lastPos: {
      px: cx, 
      py: cy, 
      timestamp: currentTimestamp,
      frame: currentFrameNumber
    }
  }
}
        

// Main analysis function
export default async function analyseVideo(videoPath) {
  let currentFrameNumber = 0;
  const model = await cocoSsd.load({ base: 'mobilenet_v2' });
  const lastPos = new Map();
  const results = [];
  const annotatedPath = path.join(outputDir, 'frames');
  const croppedPath = path.join(__dirname, 'public', 'cropped');

  // Tracker.reset();

  Tracker.setParams({
    unMatchedFramesTolerance: 10,
    iouLimit: 0.05,
    fastDelete: false,
    distanceLimit: 10000,
    matchingAlgorithm: 'munkres',
    enableKeepInMemory: true,
  });

  // Create annotated frame saver
  const frameStream = getFrameStreamWithTimestamps(videoPath);

  return new Promise((resolve, reject) => {
    frameStream.on('data', async (chunk) => {
      try {
        // const img = tf.node.decodeImage(chunk, 3);
        const img = tf.node.decodeJpeg(chunk);
        const preds = await model.detect(img, 20, 0.3);
        const timeStamp = frameStream?.frameTimestamps[currentFrameNumber] ?? 0;
        const annotatedFramesName = `annotated_${currentFrameNumber}`;

        img.dispose();

        const vehicles = preds.filter(p =>
          ['car','truck','bus','motorcycle','bike'].includes(p.class)
        );

        let detectionScaledOfThisFrame = vehicles?.map((p) => ({
          x: Math.round(p.bbox[0]),
          y: Math.round(p.bbox[1]),
          w: Math.round(p.bbox[2]),
          h: Math.round(p.bbox[3]),
          confidence: p.score * 100,
          name: p.class,
          bbox: p.bbox,
          frameNumber: currentFrameNumber,
          timestamp: timeStamp,
        }));

        if (detectionScaledOfThisFrame.length > 0) {
          if (ignoredAreas?.length > 0) {
            detectionScaledOfThisFrame = detectionScaledOfThisFrame.filter(detection => 
              !isInsideSomeAreas(ignoredAreas, detection)
            );
          }
        }

        const tracked = Tracker.getJSONOfTrackedItems();

        const trackedWithSpeeds = tracked.map(async (currentTrack) => {
          const trackedAndCounted = await estimateSpeed(
            currentTrack,
            detectionScaledOfThisFrame,
            currentFrameNumber,
            timeStamp,
            lastPos,
            results
          );

          currentTrack.speed = trackedAndCounted.speed;
          lastPos.set(trackedAndCounted.id, trackedAndCounted.lastPos);
          results.push({...trackedAndCounted.results, id: trackedAndCounted.id});
        });
  
        Tracker.updateTrackedItemsWithNewFrame(detectionScaledOfThisFrame, currentFrameNumber);

        const annotatedBuffer = await drawAnnotatedFrame(
          chunk,
          detectionScaledOfThisFrame,
          trackedWithSpeeds,
          ignoredAreas || [],
          currentFrameNumber,
          timeStamp,
        );

        await saveFrame(
          annotatedBuffer,
          `${annotatedFramesName}.jpg`,
          annotatedPath
        );

        // if (detectionScaledOfThisFrame.length > 0) {
        //     detectionScaledOfThisFrame.forEach(async (detection, index) => {
        //       const bbox = detection.bbox;
        //       const croppedDetection = await cropVehicleFromFrame(chunk, bbox);
        //       const croppedFrameName = `cropped_${currentFrameNumber}_${index}`;

        //       await saveFrame(croppedDetection, `${croppedFrameName}.jpg`, croppedPath);
        //   });
        // }

        currentFrameNumber++;
        
        if (currentFrameNumber % 1 === 0) {
          console.log(`Processed ${currentFrameNumber} frame...`);
        }

      } catch (err) {
        console.error('Frame processing error:', err);
      }
    });

    frameStream.on('end', async () => {
      const filteredBySpeed = await processAnalysisResults(results, croppedPath)
      const video = await createVideoFromFrames(annotatedPath, 'annotated_%03d.jpg', `annotated_${Date.now()}.mp4`, outputDir);

      cleanupFrames(path.join(outputDir, 'frames'));
      
      try {
        const resolvedFiltered = await Promise.all(filteredBySpeed);
        
        resolve({
          success: true,
          vehicleCount: resolvedFiltered.length,
          frameCount: currentFrameNumber,
          results: resolvedFiltered,
          annotatedVideo: video ?? null,
          outputPath: outputDir
        });
      } catch (videoErr) {
        console.error('Video creation failed, but analysis complete:', videoErr);
        cleanupFrames(outputDir);
        
        resolve({
          success: false,
          vehicleCount: resolvedFiltered.length,
          frameCount: currentFrameNumber,
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