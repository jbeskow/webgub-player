/**
 * DAT binary animation file parser.
 *
 * Binary format (big-endian):
 *   Header (width * 2 bytes):
 *     short  -width      (first word is the NEGATIVE of the frame width)
 *     short  dummy
 *     char   parnames[width-2][2]   (2-char parameter name codes)
 *
 *   Frames (one per [width * 2] bytes, starting at offset header_size):
 *     short  frame_number
 *     char   label[2]       (not byte-swapped)
 *     short  parvals[width-2]
 *
 * Default framerate: 100 fps (so time in ms = frame * 10).
 */

class DatParser {
  parse(arrayBuffer, framerate = 100) {
    const buf = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);

    // First 2 bytes = -(width) in big-endian
    const widthNeg = view.getInt16(0, false); // big-endian
    const width = -widthNeg;
    if (width <= 0 || width > 512) {
      throw new Error(`DAT: bad width: ${widthNeg}`);
    }

    // Read parameter names from header (each 2 chars, starting at byte 4)
    const paramNames = [];
    for (let i = 0; i < width - 2; i++) {
      const a = String.fromCharCode(buf[4 + i * 2]);
      const b = String.fromCharCode(buf[4 + i * 2 + 1]);
      paramNames.push(a + b);
    }

    // Frames start after header
    const headerSize = width * 2;
    const frameSize  = width * 2;
    const totalSize  = buf.byteLength;
    const nFrames    = Math.floor((totalSize - headerSize) / frameSize);

    const frames = [];
    for (let f = 0; f < nFrames; f++) {
      const offset = headerSize + f * frameSize;
      // frame_number (big-endian short)
      const frameNum = view.getInt16(offset, false);
      // label (2 chars, raw – not swapped)
      const label = String.fromCharCode(buf[offset + 2]) + String.fromCharCode(buf[offset + 3]);
      // parameter values (big-endian shorts)
      const vals = [];
      for (let p = 0; p < width - 2; p++) {
        vals.push(view.getInt16(offset + 4 + p * 2, false));
      }
      frames.push({ frameNum, label, vals });
    }

    return { width, paramNames, frames, framerate };
  }
}
