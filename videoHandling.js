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

// Enhanced frame extraction with timestamps
function getFrameStreamWithTimestamps(videoPath) {
  const stream = new PassThrough();
  const frameTimestamps = [];

  ffmpeg(videoPath)
    .inputOptions([
        '-threads', '0',
    ])
    .outputOptions([
        '-vf', `scale=1000:-1,showinfo`,
        '-q:v', '2',
        '-f', 'image2pipe',
        '-c:v', 'mjpeg',
        // '-pix_fmt', 'yuvj420p',
        '-an',
    ])
    .on('stderr', (stderrLine) => {
        const match = stderrLine.match(/pts_time:([0-9.]+)/);
        if (match) {
            frameTimestamps.push(parseFloat(match[1]));
        }
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

// Main analysis function that creates annotated video
async function analyseVideo(videoPath) {
  const model = await cocoSsd.load({ base: 'mobilenet_v2' });
  Tracker.reset();

  Tracker.setParams({
    unMatchedFramesTolerance: 8,
    iouLimit: 0.05,
    fastDelete: false,
    distanceLimit: 10000,
    matchingAlgorithm: 'munkres'
  });

  const lastPos = new Map();
  const results = [];
  let currentFrame = 0;
  const speedData = new Map(); // Store speed data for overlays

  // Create annotated video stream
  const { stream: annotatedStream, outputPath } = createAnnotatedVideoStream(videoPath);
  
  const frameStream = getFrameStreamWithTimestamps(videoPath);

  return new Promise((resolve, reject) => {
    frameStream.on('data', async chunk => {
      try {
        const img = tf.node.decodeImage(chunk, 3);
        const preds = await model.detect(img);
        img.dispose();

        const vehicles = preds.filter(p =>
          ['car','truck','bus','motorcycle','bike'].includes(p.class)
        );

        let detectionScaledOfThisFrame = vehicles.map((p) => {
          return {
            x: Math.round(p.bbox[0]),
            y: Math.round(p.bbox[1]),
            w: Math.round(p.bbox[2]),
            h: Math.round(p.bbox[3]),
            confidence: p.score * 100,
            name: p.class
          };
        });

        // Keep original detections for drawing
        const originalDetections = [...detectionScaledOfThisFrame];

        // Filter out detections in ignored areas
        if (ignoredAreas?.length > 0) {
          detectionScaledOfThisFrame = detectionScaledOfThisFrame.filter(detection => 
            !isInsideSomeAreas(ignoredAreas, detection)
          );
        }

        Tracker.updateTrackedItemsWithNewFrame([...detectionScaledOfThisFrame], currentFrame);
        const tracked = Tracker.getJSONOfTrackedItems();

        // Get actual timestamp for this frame
        const currentTimestamp = frameStream.frameTimestamps[currentFrame] || (currentFrame / 15);

        // Calculate speeds for tracked objects
        const trackedWithSpeeds = tracked.map(obj => {
          const cx = obj.x + obj.w/2;
          const cy = obj.y + obj.h/2;
          const id = obj.id;
          let speedKmh = 0;

          if (lastPos.has(id)) {
            const { px, py, timestamp: lastTimestamp } = lastPos.get(id);
            const dt = currentTimestamp - lastTimestamp;
            
            // if (dt > 0.01 && dt < 1.0) { // Reasonable time range
              const distPx = Math.hypot(cx - px, cy - py);
              
              const meters = distPx / pixelsPerMeter;
              const mps = meters / dt;
              speedKmh = mps * 3.6;
              
            // }
          }

          const validSpeed = Number.isFinite(speedKmh) ? Math.round(speedKmh) : 0;

          // Store speed data
          
            results.push({
              id,
              timestamp: new Date(Date.now() + (currentTimestamp * 1000)).toISOString(),
              frame: currentFrame,
              actualTime: currentTimestamp,
              speed_kmh: validSpeed
            });
          

          lastPos.set(id, { 
            px: cx, 
            py: cy, 
            timestamp: currentTimestamp,
            frame: currentFrame
          });

          // Return tracked object with speed for drawing
          return {
            ...obj,
            speed: validSpeed
          };
        });

        // Create annotated frame with all overlays
        const annotatedBuffer = await drawAnnotatedFrame(
          chunk,
          originalDetections,
          trackedWithSpeeds,
          ignoredAreas || [],
          currentFrame,
          currentTimestamp
        );

        // Write annotated frame to video stream
        annotatedStream.write(annotatedBuffer);

        currentFrame++;
        
        // if (currentFrame % 30 === 0) {
        //   console.log(`Processed ${currentFrame} frames...`);
        // }

      } catch (err) {
        console.error('Frame processing error:', err);
        // Continue processing instead of rejecting
      }
    });

    frameStream.on('end', () => {
      // Close the annotated video stream
      annotatedStream.end();
      
      // Process results
      const groupedBy = results.reduce((groups, item) => {
        const groupKey = item['id'];
        if (!groups[groupKey]) {
          groups[groupKey] = [];
        }
        groups[groupKey].push(item);
        return groups;
      }, []);

      const filteredBySpeed = Object.keys(groupedBy).map((id) => {
        const group = groupedBy[id];
        const maxSpeedEntry = group.reduce((max, entry) => 
          entry.speed_kmh > max.speed_kmh ? entry : max
        );

        return {
          id: parseInt(id),
          speed: maxSpeedEntry.speed_kmh,
          time: maxSpeedEntry.timestamp,
          annotatedVideo: path.basename(outputPath) // Return video filename
        };
      });

      console.log(`Analysis complete. Annotated video saved: ${outputPath}`);
      console.log(`Found ${filteredBySpeed.length} unique vehicles with speeds.`);
      
      // Wait a bit for video encoding to complete
      setTimeout(() => {
        resolve({
          results: filteredBySpeed,
          annotatedVideo: path.basename(outputPath)
        });
      }, 2000);
    });

    frameStream.on('error', err => {
      annotatedStream.end();
      reject(err);
    });
  });
}

module.exports = { analyseVideo };
// filepath: c:\speedTrack\videoHandling.js