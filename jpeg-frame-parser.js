// const { Transform } = require('stream');
import { Transform } from 'stream';

// JPEG markers for Start of Image (SOI) and End of Image (EOI)
const SOI = Buffer.from([0xFF, 0xD8]);
const EOI = Buffer.from([0xFF, 0xD9]);

export default class JpegFrameParser extends Transform {
  constructor(options) {
    super(options);
    this._buffer = Buffer.alloc(0);
    this.foundSOI = false;
  }

  _transform(chunk, encoding, callback) {
    // Add new data to the internal buffer
    this._buffer = Buffer.concat([this._buffer, chunk]);

    while (true) {
      if (!this.foundSOI) {
        const soiIndex = this._buffer.indexOf(SOI);
        if (soiIndex !== -1) {
          // Found the start of a new frame, discard any data before it
          this._buffer = this._buffer.slice(soiIndex);
          this.foundSOI = true;
        } else {
          // No SOI found yet, so we can't process this chunk. Wait for more data.
          return callback();
        }
      }

      const eoiIndex = this._buffer.indexOf(EOI);
      if (eoiIndex !== -1) {
        // Found the end of the frame.
        const frame = this._buffer.slice(0, eoiIndex + 2);
        this.push(frame);

        // Remove the processed frame from the buffer
        this._buffer = this._buffer.slice(eoiIndex + 2);
        this.foundSOI = false; // Reset to look for the next frame's SOI
      } else {
        // Have a start but no end yet, wait for more data to complete the frame.
        return callback();
      }
    }
  }
}