import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';

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

export function saveFrame(frameBuffer, frameCount, outputDir) {
  const framesDir = path.join(outputDir, 'frames');
  
  // Create frames directory if it doesn't exist
  if (!fs.existsSync(framesDir)) {
    fs.mkdirSync(framesDir, { recursive: true });
  }
  
  const name = path.join(framesDir, `frame_${frameCount.toString().padStart(6, '0')}.jpg`);
  fs.writeFileSync(name, frameBuffer);
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

// Updated frame saver with fallback
export function createAnnotatedFrameSaver(outputDir) {
  const framesDir = path.join(outputDir, 'frames');
  const outputPath = path.join(outputDir, 'annotated.mp4');
  
  // Create frames directory
  if (!fs.existsSync(framesDir)) {
    fs.mkdirSync(framesDir, { recursive: true });
  }

  let frameCount = 0;

  return {
    saveFrame: (frameBuffer) => {
      const framePath = path.join(framesDir, `frame_${frameCount.toString().padStart(6, '0')}.jpg`);
      fs.writeFileSync(framePath, frameBuffer);
      frameCount++;
    },
    
    createVideo: async () => {
      if (frameCount === 0) return null;
      
      try {
        return await createVideoFromFrames(outputDir, 'annotated.mp4');
      } catch (err) {
        console.log('Primary video creation failed, trying fallback...');
        try {
          return await createVideoFromFramesFallback(outputDir, 'annotated_fallback.mp4');
        } catch (fallbackErr) {
          console.error('Both video creation methods failed');
          throw fallbackErr;
        }
      }
    },
  };
}

// Function to process analysis results
export function processAnalysisResults(results) {
  const groupedBy = results.reduce((groups, item) => {
    const groupKey = item['id'];
    if (!groups[groupKey]) {
      groups[groupKey] = [];
    }
    groups[groupKey].push(item);
    return groups;
  }, []);

  return Object.keys(groupedBy).map((id) => {
    const group = groupedBy[id];
    const maxSpeedEntry = group.reduce((max, entry) => 
      entry.speed_kmh > max.speed_kmh ? entry : max
    );

    return {
      id: parseInt(id),
      speed: maxSpeedEntry.speed_kmh,
      time: maxSpeedEntry.timestamp
    };
  });
}