# VehicleTracker

VehicleTracker is a Node.js application for automatic vehicle detection, tracking, and speed estimation from video files. It uses deep learning and computer vision to analyze traffic videos, annotate detected vehicles, and generate an annotated video and summary table of vehicle speeds.

## Features

- Upload a video and automatically detect vehicles (car, truck, bus, motorcycle, bike)
- Track vehicles across frames and estimate their speed in km/h
- Annotate frames with bounding boxes, IDs, and speed overlays
- Ignore user-defined areas (e.g., sidewalks, irrelevant zones)
- Generate an annotated video with overlays
- Display a summary table of detected vehicles and their speeds

## Technologies & Libraries

- **Node.js** (backend)
- **Express** (web server)
- **Multer** (file uploads)
- **@tensorflow-models/coco-ssd** (vehicle detection)
- **@tensorflow/tfjs-node** and **@tensorflow/tfjs-node-gpu** (TensorFlow backend)
- **node-moving-things-tracker** (object tracking)
- **canvas** (frame annotation and cropping)
- **fluent-ffmpeg** (frame extraction and video creation)
- **Frontend:** HTML, JavaScript

## How it works

1. User uploads a video via the web interface.
2. The server extracts frames, runs COCO-SSD object detection, and tracks vehicles.
3. Vehicle speeds are estimated using pixel-to-meter calibration.
4. Annotated frames are saved and compiled into a video.
5. Results and annotated video are displayed in the browser.

## Usage

1. Clone the repository.
2. Install dependencies: `npm install`
3. Start the server: `npm start`
4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Configuration

- Calibration parameters (pixels per meter, ignored areas) are set in calibration.json.

## License

Apache 2.0 (see source headers for details).

---

**Note:** This project is for research and educational purposes. For production use, further optimization and security hardening are recommended.
