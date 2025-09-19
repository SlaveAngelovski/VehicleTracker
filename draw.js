import { createCanvas, loadImage } from 'canvas';
import fs from 'fs';
import path from 'path';

/**
 * Draw bounding boxes and excluded areas on a frame using Canvas
 * @param {Buffer} frameBuffer - The original frame buffer
 * @param {Array} detections - Array of detection objects
 * @param {Array} tracked - Array of tracked objects  
 * @param {Array} ignoredAreas - Array of ignored area rectangles
 * @param {number} frameNumber - Current frame number
 * @param {number} timestamp - Frame timestamp
 * @returns {Promise<Buffer>} - Annotated image buffer
 */
export async function drawAnnotatedFrame(frameBuffer, detections, tracked, ignoredAreas, frameNumber, timestamp) {
  try {
    // Load the frame as an image
    const img = await loadImage(frameBuffer);
    
    // Create canvas with same dimensions as image
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    
    // Draw the original frame
    ctx.drawImage(img, 0, 0);
    
    // Draw excluded areas
    drawExcludedAreas(ctx, ignoredAreas);
    
    // Draw detection bounding boxes
    drawDetectionBoxes(ctx, detections);
    
    // Draw tracked object boxes
    drawTrackedBoxes(ctx, tracked);
    
    // Draw speed overlays
    drawSpeedOverlay(ctx, tracked);
    
    // Draw frame information overlay
    drawFrameInfo(ctx, frameNumber, timestamp, detections.length, tracked.length);
    
    // Return the canvas as buffer
    return canvas.toBuffer('image/jpeg', { quality: 0.9 });
    
  } catch (error) {
    console.error('Error drawing annotated frame:', error);
    throw error;
  }
}

/**
 * Draw excluded/ignored areas as semi-transparent red rectangles
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Array} ignoredAreas - Array of ignored area objects
 */
export function drawExcludedAreas(ctx, ignoredAreas) {
  if (!ignoredAreas || ignoredAreas.length === 0) return;
  
  ctx.fillStyle = 'rgba(255, 0, 0, 0.3)'; // Semi-transparent red
  ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)'; // More opaque red border
  ctx.lineWidth = 2;
  
  ignoredAreas.forEach((area, index) => {
    // Fill the excluded area
    ctx.fillRect(area.x, area.y, area.w, area.h);
    // Draw border
    ctx.strokeRect(area.x, area.y, area.w, area.h);
    
    // Add label
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.font = '14px Arial';
    ctx.fillText(`IGNORED ${index + 1}`, area.x + 5, area.y + 20);
    ctx.fillStyle = 'rgba(255, 0, 0, 0.3)'; // Reset fill style
  });
}

/**
 * Draw detection bounding boxes in yellow
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Array} detections - Array of detection objects
 */
export function drawDetectionBoxes(ctx, detections) {
  if (!detections || detections.length === 0) return;
  
  ctx.strokeStyle = '#FFFF00'; // Yellow
  ctx.lineWidth = 3;
  ctx.font = '16px Arial';
  
  detections.forEach((detection) => {
    // Draw bounding box
    ctx.strokeRect(detection.x, detection.y, detection.w, detection.h);
    
    // Prepare label
    const label = `${detection.name} ${detection.confidence.toFixed(0)}%`;
    const textMetrics = ctx.measureText(label);
    const labelWidth = textMetrics.width + 10;
    const labelHeight = 25;
    
    // Draw label background
    ctx.fillStyle = 'rgba(255, 255, 0, 0.8)'; // Yellow background
    ctx.fillRect(detection.x, detection.y - labelHeight, labelWidth, labelHeight);
    
    // Draw label text
    ctx.fillStyle = 'black';
    ctx.fillText(label, detection.x + 5, detection.y - 14);
  });
}

/**
 * Draw tracked object bounding boxes in green with IDs
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Array} tracked - Array of tracked objects
 */
export function drawTrackedBoxes(ctx, tracked) {
  if (!tracked || tracked.length === 0) return;
  
  ctx.strokeStyle = '#00FF00'; // Green
  ctx.lineWidth = 4;
  ctx.font = 'bold 18px Arial';
  
  tracked.forEach((track) => {
    // Draw thicker bounding box for tracked objects
    ctx.strokeRect(track.x, track.y, track.w, track.h);
    
    // Draw center point
    const cx = track.x + track.w / 2;
    const cy = track.y + track.h / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, 2 * Math.PI);
    ctx.fillStyle = '#00FF00';
    ctx.fill();
    
    // Prepare tracking ID label
    const trackLabel = `ID: ${track.id}`;
    const textMetrics = ctx.measureText(trackLabel);
    const labelWidth = textMetrics.width + 10;
    const labelHeight = 30;
    
    // Draw ID label background
    ctx.fillStyle = 'rgba(0, 255, 0, 0.9)'; // Green background
    ctx.fillRect(track.x, track.y + track.h, labelWidth, labelHeight);
    
    // Draw ID text
    ctx.fillStyle = 'black';
    ctx.fillText(trackLabel, track.x + 5, track.y + track.h + 20);
  });
}

/**
 * Draw frame information overlay
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} frameNumber - Current frame number
 * @param {number} timestamp - Frame timestamp
 * @param {number} detectionsCount - Number of detections
 * @param {number} trackedCount - Number of tracked objects
 */
export function drawFrameInfo(ctx, frameNumber, timestamp, detectionsCount, trackedCount) {
  // Draw info overlay background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'; // Semi-transparent black
  ctx.fillRect(10, 10, 300, 80);
  
  // Draw info text
  ctx.fillStyle = 'white';
  ctx.font = '14px Arial';
  ctx.fillText(`Frame: ${frameNumber}`, 20, 30);

   // Ensure timestamp is a number and format it properly
  const timeValue = typeof timestamp === 'number' ? timestamp : 0;
  ctx.fillText(`Time: ${timeValue.toFixed(2)}s`, 20, 50);

  ctx.fillText(`Detections: ${detectionsCount}`, 20, 70);
  ctx.fillText(`Tracked: ${trackedCount}`, 150, 70);
}

/**
 * Save annotated frame to file
 * @param {Buffer} frameBuffer - Original frame buffer
 * @param {Array} detections - Detection objects
 * @param {Array} tracked - Tracked objects
 * @param {Array} ignoredAreas - Ignored areas
 * @param {number} frameNumber - Frame number
 * @param {number} timestamp - Timestamp
 * @param {string} outputDir - Output directory path
 * @returns {Promise<Object|null>} - Screenshot info object or null
 */
export async function saveAnnotatedFrame(frameBuffer, detections, tracked, ignoredAreas, frameNumber, timestamp, outputDir) {
  try {
    // Create unique filename
    const filename = `frame_${frameNumber}_${Date.now()}.jpg`;
    const filepath = path.join(outputDir, filename);
    
    // Draw annotations on frame
    const annotatedBuffer = await drawAnnotatedFrame(
      frameBuffer, 
      detections, 
      tracked, 
      ignoredAreas, 
      frameNumber, 
      timestamp
    );
    
    // Save to file
    fs.writeFileSync(filepath, annotatedBuffer);
    
    return {
      filename,
      detections: detections.length,
      tracked: tracked.length,
      timestamp
    };
    
  } catch (error) {
    console.error('Error saving annotated frame:', error);
    return null;
  }
}

/**
 * Draw speed information on tracked objects
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Array} tracked - Tracked objects with speed data
 */
export function drawSpeedOverlay(ctx, tracked) {
  if (!tracked || tracked.length === 0) return;
  
  ctx.font = 'bold 16px Arial';
  
  tracked.forEach((track) => {
    if (track.speed && track.speed > 0) {
      const speedLabel = `${track.speed} km/h`;
      const textMetrics = ctx.measureText(speedLabel);
      const labelWidth = textMetrics.width + 10;
      const labelHeight = 25;
      
      // Position speed label above the vehicle
      const labelX = track.x + (track.w - labelWidth) / 2;
      const labelY = track.y - 10;
      
      // Draw speed label background
      ctx.fillStyle = 'rgba(255, 165, 0, 0.9)'; // Orange background
      ctx.fillRect(labelX, labelY - labelHeight, labelWidth, labelHeight);
      
      // Draw speed text
      ctx.fillStyle = 'black';
      ctx.fillText(speedLabel, labelX + 5, labelY - 8);
    }
  });
}