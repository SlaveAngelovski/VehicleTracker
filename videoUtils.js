import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { createCanvas, loadImage } from 'canvas';

export function timeStringToSeconds(timeString) {

  return new Date(`1970-01-01T${timeString}Z`).getTime() / 1000;
  //if (typeof timeString === 'number') return timeString;
  
  // // Handle format like "00:00:00.33" or "00:00:05.67"
  // const parts = timeString.split(':');
  // if (parts.length === 3) {
  //   const hours = parseFloat(parts[0]);
  //   const minutes = parseFloat(parts[1]);
  //   const seconds = parseFloat(parts[2]);
  //   return hours * 3600 + minutes * 60 + seconds;
  // }
  
  // // Fallback - try to parse as float
  // return parseFloat(timeString) || 0;
}

export async function saveFrame(frameBuffer, frameName, outputDir, name) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const pathToSave = name ?? path.join(outputDir, frameName);
  await fs.promises.writeFile(pathToSave, frameBuffer);
}

export function cleanupFrames(outputDir) {
  const framesDir = path.join(outputDir, 'frames');
  if (fs.existsSync(framesDir)) {
    fs.rmSync(framesDir, { recursive: true, force: true });
  }
}

export function createVideoFromFrames(framesPath, framesName, videoPath, videoFileName) {
  const outputVideoPath = path.join(videoPath, videoFileName);

  return new Promise((resolve, reject) => {
    // Check if frames directory exists and has frames
    if (!fs.existsSync(framesPath)) {
      reject(new Error('Frames directory does not exist'));
      return;
    }

    const frames = fs.readdirSync(framesPath).filter(file => file.endsWith('.jpg'));
    if (frames.length === 0) {
      reject(new Error('No frames found to create video'));
      return;
    }

    console.log(`Found ${frames.length} frames in ${framesPath}`);
    console.log('First few frames:', frames.slice(0, 5));

    ffmpeg()
      .input(path.join(framesPath, framesName))
      .inputOptions([
        '-start_number', '0',
        '-threads', '24'
      ])
      .withNoAudio()
      .size('1000x?')
      .outputOptions([
        '-c:v', 'libx264',
        // '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',  // Pad to make dimensions even
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
          //fs.rmSync(framesDir, { recursive: true, force: true });
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
    // const framePath = path.join(outputDir, 'frames', fileName);
    // const frameBuffer = await fs.promises.readFile(framePath);

    // const maxSpeedCroppedFrame = await cropVehicleFromFrame(
    //   frameBuffer, // Now passing the actual buffer
    //   maxSpeedEntry.bbox
    // );
    // // const croppedFramePath = path.join(outputDir, 'annotated', 'frames', croppedFrameName);
    // // fs.writeFileSync(croppedFramePath, maxSpeedCroppedFrame);

    // if (maxSpeedCroppedFrame) {
    //   await saveFrame(maxSpeedCroppedFrame, maxSpeedEntry.frame, path.join(outputDir, 'cropped'));
    // }

    return {
      id: parseInt(id),
      speed: maxSpeedEntry.speed_kmh,
      time: maxSpeedEntry.timestamp,
      // frame: maxSpeedCroppedFrame ? `\\annotated\\cropped\\frames\\${fileName}` : null,
      frame: `\\annotated\\cropped\\frames\\${fileName}`,
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