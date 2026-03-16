/**
 * JOG animation file parser.
 *
 * Format (Tcl-like):
 *   return {
 *     name      <string>
 *     framerate <int>          (typically 25)
 *     hotspot   <float>        (time of key moment, in seconds)
 *     header    { {idx {object property_type param_name} {mult offset}} ... }
 *     data      { <frame> ... }
 *   }
 *
 * Each frame is either a bare number (single channel) or a braced list of numbers.
 * Parameter values are already in model units (0-1 range for most params).
 */

class JogParser {
  // Split a Tcl list respecting brace nesting; ignores bare words between braces
  _split(str) {
    const items = [];
    let depth = 0, cur = '';
    str = str.trim();
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      if (c === '{') {
        if (depth > 0) cur += c;
        depth++;
      } else if (c === '}') {
        depth--;
        if (depth > 0) cur += c;
        else { items.push(cur); cur = ''; }
      } else if (depth === 0 && /\s/.test(c)) {
        const t = cur.trim();
        if (t) { items.push(t); cur = ''; }
      } else {
        cur += c;
      }
    }
    const t = cur.trim();
    if (t) items.push(t);
    return items;
  }

  parse(text) {
    // Strip leading/trailing whitespace and the "return { ... }" wrapper
    text = text.trim();
    const m = text.match(/^return\s*\{([\s\S]*)\}\s*$/);
    if (!m) throw new Error('Not a valid .jog file (missing "return { ... }")');

    // Parse as flat key-value dict
    const tokens = this._split(m[1]);
    const dict = {};
    for (let i = 0; i + 1 < tokens.length; i += 2) dict[tokens[i]] = tokens[i + 1];

    const name      = dict.name      ?? 'unnamed';
    const framerate = parseInt(dict.framerate) || 25;
    const hotspot   = parseFloat(dict.hotspot) || 0;

    // Parse header: list of channel specs
    const channels = this._split(dict.header ?? '').map(item => {
      const parts = this._split(item);
      const desc  = this._split(parts[1] ?? '');
      const scale = this._split(parts[2] ?? '');
      return {
        object:    desc[0] ?? 'face',   // face | eye | gube
        propType:  desc[1] ?? 'parameter',
        paramName: desc[2] ?? '',
        mult:   parseFloat(scale[0]) || 1,
        offset: parseFloat(scale[1]) || 0,
      };
    });

    // Parse data: each element is a frame (single value or space-separated list)
    const frames = this._split(dict.data ?? '').map(item => {
      const vals = item.trim().split(/\s+/).map(Number);
      return vals;
    });

    return { name, framerate, hotspot, channels, frames };
  }
}
