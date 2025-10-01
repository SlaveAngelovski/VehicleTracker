import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { createCanvas, loadImage } from 'canvas';

export function timeStringToSeconds(timeString) {
  if (typeof timeString === 'number') return timeString;
  
  // Handle format like "00:00:00.33" or "00:00:05.67"
  const parts = timeString.split(':');
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]);
    const minutes = parseFloat(parts[1]);
    const seconds = parseFloat(parts[2]);
    return hours * 3600 + minutes * 60 + seconds;
  }
  
  // Fallback - try to parse as float
  return parseFloat(timeString) || 0;
}

export async function saveFrame(frameBuffer, frameCount, outputDir) {
  const framesDir = path.join(outputDir, 'frames');
  
  // Create frames directory if it doesn't exist
  if (!fs.existsSync(framesDir)) {
    fs.mkdirSync(framesDir, { recursive: true });
  }
  
  const name = path.join(framesDir, `frame_${frameCount.toString().padStart(6, '0')}.jpg`);
  //fs.writeFileSync(name, frameBuffer);
  await fs.promises.writeFile(name, frameBuffer);
}

export function cleanupFrames(outputDir) {
  const framesDir = path.join(outputDir, 'frames');
  if (fs.existsSync(framesDir)) {
    fs.rmSync(framesDir, { recursive: true, force: true });
  }
}

export function createVideoFromFrames(outputDir, videoFileName = 'annotated.mp4') {
  const framesDir = path.join(outputDir, 'frames');
  const outputVideoPath = path.join(outputDir, videoFileName);

  return new Promise((resolve, reject) => {
    // Check if frames directory exists and has frames
    if (!fs.existsSync(framesDir)) {
      reject(new Error('Frames directory does not exist'));
      return;
    }

    const frames = fs.readdirSync(framesDir).filter(file => file.endsWith('.jpg'));
    if (frames.length === 0) {
      reject(new Error('No frames found to create video'));
      return;
    }

    console.log(`Found ${frames.length} frames in ${framesDir}`);
    console.log('First few frames:', frames.slice(0, 5));

    // Fix: Add video filter to ensure dimensions are even
    ffmpeg()
      .input(path.join(framesDir, 'frame_%06d.jpg'))
      .inputOptions([
        '-start_number', '0'
      ])
      .outputOptions([
        '-c:v', 'libx264',
        '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',  // Pad to make dimensions even
        '-pix_fmt', 'yuv420p',
        '-crf', '23',
        '-preset', 'medium'
      ])
      .on('start', (commandLine) => {
        console.log('FFmpeg command:', commandLine);
      })
      .on('stderr', (stderrLine) => {
        console.log('FFmpeg stderr:', stderrLine);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          console.log('Video creation progress:', Math.round(progress.percent) + '%');
        }
      })
      .on('end', () => {
        console.log('Annotated video created:', outputVideoPath);
        // Clean up frame files
        try {
          fs.rmSync(framesDir, { recursive: true, force: true });
        } catch (cleanupErr) {
          console.warn('Warning: Could not clean up frames directory:', cleanupErr.message);
        }
        resolve(path.basename(outputVideoPath));
      })
      .on('error', (err, stdout, stderr) => {
        console.error('FFmpeg error:', err.message);
        console.error('FFmpeg stdout:', stdout);
        console.error('FFmpeg stderr:', stderr);
        reject(err);
      })
      .save(outputVideoPath);
  });
}

// Also update the fallback function
export function createVideoFromFramesFallback(outputDir, videoFileName = 'annotated_fallback.mp4') {
  const framesDir = path.join(outputDir, 'frames');
  const outputVideoPath = path.join(outputDir, videoFileName);

  return new Promise((resolve, reject) => {
    console.log('Trying fallback video creation method...');
    
    ffmpeg()
      .input(path.join(framesDir, 'frame_%06d.jpg'))
      .outputOptions([
        '-vcodec', 'mpeg4',
        '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',  // Add padding here too
        '-q:v', '5'
      ])
      .on('start', (commandLine) => {
        console.log('Fallback FFmpeg command:', commandLine);
      })
      .on('end', () => {
        console.log('Fallback video created:', outputVideoPath);
        fs.rmSync(framesDir, { recursive: true, force: true });
        resolve(path.basename(outputVideoPath));
      })
      .on('error', (err) => {
        console.error('Fallback also failed:', err.message);
        reject(err);
      })
      .save(outputVideoPath);
  });
}

// Function to process analysis results
export async function processAnalysisResults(results, outputDir) {
  const groupedBy = results.reduce((groups, item) => {
    const groupKey = item['id'];

    if (!groups[groupKey]) {
      groups[groupKey] = [];
    }

    groups[groupKey].push(item);

    return groups;
  }, []);

  return Object.keys(groupedBy).map(async (id) => {
    const group = groupedBy[id];

    let maxSpeedFrameNumber = 0; 
    const maxSpeedEntry = group.reduce((max, entry) => {
      // set the max speed frame number
      if (entry.speed_kmh > max.speed_kmh) {
        maxSpeedFrameNumber = entry.frame;
      }

      const maxSpeed = entry.speed_kmh > max.speed_kmh ? entry : max;
      maxSpeed.bbox = entry.bbox; // keep the bbox of the max speed entry

      return maxSpeed;
    });

    // Read the frame file as a buffer first
    const fileName = `frame_${maxSpeedFrameNumber.toString().padStart(6, '0')}.jpg`;
    const framePath = path.join(outputDir, 'frames', fileName);
    const frameBuffer = await fs.promises.readFile(framePath);

    const maxSpeedCroppedFrame = await cropVehicleFromFrame(
      frameBuffer, // Now passing the actual buffer
      maxSpeedEntry.bbox
    );
    // const croppedFramePath = path.join(outputDir, 'annotated', 'frames', croppedFrameName);
    // fs.writeFileSync(croppedFramePath, maxSpeedCroppedFrame);

    if (maxSpeedCroppedFrame) {
      await saveFrame(maxSpeedCroppedFrame, maxSpeedEntry.frame, path.join(outputDir, 'cropped'));
    }

    return {
      id: parseInt(id),
      speed: maxSpeedEntry.speed_kmh,
      time: maxSpeedEntry.timestamp,
      frame: maxSpeedCroppedFrame ? `\\annotated\\cropped\\frames\\${fileName}` : null,
    };
  });
}

export async function cropVehicleFromFrame(frameBuffer, bbox) {
  return new Promise(async (resolve, reject) => {
    if (bbox?.length < 1) {
      return resolve(null);
    }

    try {
      const img = await loadImage(frameBuffer);
      const canvas = createCanvas(bbox[0][2], bbox[0][3]);
      const ctx = canvas.getContext('2d');

      bbox.forEach((croppedEl) => {
        ctx.drawImage(img, croppedEl[0], croppedEl[1], croppedEl[2], croppedEl[3], 0, 0);
      });

      const croppedBuffer = canvas.toBuffer('image/jpeg', { quality: 0.9 });

      resolve(croppedBuffer);
    } catch (error) {
      reject(error);
    }
  });
}