/**
 * GUB file parser
 * Parses the .gub facial animation model format.
 */

class GubParser {
  parse(text) {
    this.text = text;
    this.pos  = 0;
    this.line = 1;
    return this._parseFile();
  }

  // ── Tokeniser ─────────────────────────────────────────────────────────────

  _skipWS() {
    while (this.pos < this.text.length) {
      const ch = this.text[this.pos];
      if (ch === '/' && this.text[this.pos + 1] === '/') {
        while (this.pos < this.text.length && this.text[this.pos] !== '\n') this.pos++;
      } else if (ch === '\n') { this.line++; this.pos++;
      } else if (ch === '\r' || ch === '\t' || ch === ' ') { this.pos++;
      } else break;
    }
  }

  _next() {
    this._skipWS();
    if (this.pos >= this.text.length) return null;
    const ch = this.text[this.pos];
    if (ch === '{' || ch === '}') return this.text[this.pos++];
    const start = this.pos;
    while (this.pos < this.text.length && !/[\s{}]/.test(this.text[this.pos])) this.pos++;
    return this.text.slice(start, this.pos);
  }

  _peek() {
    const sp = this.pos, sl = this.line;
    const tok = this._next();
    this.pos = sp; this.line = sl;
    return tok;
  }

  _expect(tok) {
    const got = this._next();
    if (got !== tok) throw new Error(`GUB: expected '${tok}', got '${got}' at line ${this.line}`);
  }

  // ── Line-based block reader (for vertices / polygons) ────────────────────

  // Read one "data line" (not crossing line boundaries).
  // Returns array of token strings, or null if we hit '}' (end of block).
  _readDataLine() {
    // Skip spaces/tabs only (not newlines or comments yet, we do that in loop)
    while (this.pos < this.text.length &&
           (this.text[this.pos] === ' ' || this.text[this.pos] === '\t' || this.text[this.pos] === '\r')) {
      this.pos++;
    }
    if (this.pos >= this.text.length) return null;
    const ch = this.text[this.pos];
    if (ch === '}') return null;           // end of block
    if (ch === '\n') { this.line++; this.pos++; return []; } // blank line → skip

    const tokens = [];
    while (this.pos < this.text.length && this.text[this.pos] !== '\n') {
      const c = this.text[this.pos];
      if (c === '\r') { this.pos++; continue; }
      if (c === '}') { /* stop before closing brace */ break; }
      if (c === '/' && this.text[this.pos + 1] === '/') {
        while (this.pos < this.text.length && this.text[this.pos] !== '\n') this.pos++;
        break;
      }
      if (c === ' ' || c === '\t') { this.pos++; continue; }
      const start = this.pos;
      while (this.pos < this.text.length &&
             this.text[this.pos] !== ' ' && this.text[this.pos] !== '\t' &&
             this.text[this.pos] !== '\n' && this.text[this.pos] !== '\r' &&
             this.text[this.pos] !== '}' && this.text[this.pos] !== '{') {
        this.pos++;
      }
      tokens.push(this.text.slice(start, this.pos));
    }
    if (this.pos < this.text.length && this.text[this.pos] === '\n') { this.line++; this.pos++; }
    return tokens;
  }

  // Read `{ ... }` block calling callback(lineTokens) for each non-empty line.
  _readLineBlock(callback) {
    this._expect('{');
    // skip rest of opening line
    while (this.pos < this.text.length && this.text[this.pos] !== '\n' && this.text[this.pos] !== '}') this.pos++;
    if (this.pos < this.text.length && this.text[this.pos] === '\n') { this.line++; this.pos++; }
    while (true) {
      const toks = this._readDataLine();
      if (toks === null) break;
      if (toks.length > 0) callback(toks);
    }
    if (this.pos < this.text.length && this.text[this.pos] === '}') this.pos++;
    // consume remainder of closing line (e.g. "// vertices")
    while (this.pos < this.text.length && this.text[this.pos] !== '\n') this.pos++;
  }

  // ── Top-level file parsing ────────────────────────────────────────────────

  _parseFile() {
    const result = { map: [], scene: null };
    while (this.pos < this.text.length) {
      const tok = this._next();
      if (!tok) break;
      if (tok === 'map')    { result.map = this._parseMap(); }
      else if (tok === 'gthing') {
        const name = this._next();
        this._expect('{');
        result.scene = this._parseGthing(name);
      }
    }
    return result;
  }

  _parseMap() {
    this._expect('{');
    const map = [];
    while (true) {
      const tok = this._next();
      if (tok === '}' || !tok) break;
      map.push({ datName: tok, nodeName: this._next(), paramName: this._next(), scale: parseFloat(this._next()) });
    }
    return map;
  }

  _parseGthing(name) {
    const node = { name, type: 'gthing', children: [] };
    while (true) {
      const tok = this._peek();
      if (tok === '}' || !tok) { this._next(); break; }
      const child = this._parseNode();
      if (child) node.children.push(child);
    }
    return node;
  }

  // ── Node dispatcher ───────────────────────────────────────────────────────

  _parseNode() {
    const typeTok = this._next();
    if (!typeTok || typeTok === '}') return null;
    const nameTok = this._next();
    if (!nameTok) return null;
    // Consume opening brace
    const brace = this._next();
    if (brace !== '{') { /* malformed – put it back is hard, just continue */ return null; }
    switch (typeTok) {
      case 'view':         return this._parseView(nameTok);
      case 'light':        return this._parseLight(nameTok);
      case 'surface':      return this._parseSurface(nameTok);
      case 'def_surface':  return this._parseDefSurface(nameTok);
      case 'eye_surface':  return this._parseEyeSurface(nameTok);
      default:             this._skipBlock(); return null;
    }
  }

  _skipBlock() {
    let depth = 1;
    while (this.pos < this.text.length && depth > 0) {
      const tok = this._next();
      if (tok === '{') depth++;
      else if (tok === '}') depth--;
    }
  }

  // ── View ──────────────────────────────────────────────────────────────────

  _parseView(name) {
    const v = { name, type: 'view', from: [0,0,0], to: [0,0,0], upVector: [0,0,1],
                zoom: 100, perspective: 500, bgColor: [0.5,0.8,1], children: [] };
    while (true) {
      const tok = this._peek();
      if (tok === '}' || !tok) { this._next(); break; }
      if (this._isNodeType(tok)) { const c = this._parseNode(); if (c) v.children.push(c); continue; }
      this._next();
      switch (tok) {
        case 'to':               v.to        = this._readVec3(); break;
        case 'from':             v.from      = this._readVec3(); break;
        case 'view_up_vector':   v.upVector  = this._readVec3(); break;
        case 'zoom':             v.zoom      = parseFloat(this._next()); break;
        case 'perspective':      v.perspective = parseFloat(this._next()); break;
        case 'background_color': v.bgColor   = this._readVec3(); break;
        case 'pan':              this._next(); this._next(); break;  // 2 values
        case 'viewport':         for (let i=0;i<6;i++) this._next(); break; // 6 values
        case 'frontplane': case 'backplane': case 'state': this._next(); break;
        default:                 this._skipValueTok(tok); break;
      }
    }
    return v;
  }

  // ── Light ─────────────────────────────────────────────────────────────────

  _parseLight(name) {
    const l = { name, type: 'light', lightType: 'directional',
                direction: [0,0,-1], color: [1,1,1], state: 1 };
    while (true) {
      const tok = this._peek();
      if (tok === '}' || !tok) { this._next(); break; }
      this._next();
      switch (tok) {
        case 'type':      l.lightType = this._next(); break;
        case 'direction': l.direction = this._readVec3(); break;
        case 'color':     l.color     = this._readVec3(); break;
        case 'state':     l.state     = parseFloat(this._next()); break;
        default:          this._skipValueTok(tok); break;
      }
    }
    return l;
  }

  // ── Shared surface parsing helpers ────────────────────────────────────────

  _defaultMaterial() {
    return { ambient: 0, diffuse: 1, specular: 0.5, transmission: 0, specularConc: 1,
             diffuseColor: [0.8,0.6,0.4], specularColor: [1,1,1] };
  }

  _parseSurfaceAttrib(surf, tok) {
    switch (tok) {
      case 'translation':      surf.translation = this._readVec3(); return true;
      case 'rotation':         surf.rotation    = this._readVec3(); return true;
      case 'scaling':          surf.scaling     = this._readVec3(); return true;
      case 'pivot':            surf.pivot       = this._readVec3(); return true;
      case 'ambient':          surf.material.ambient      = parseFloat(this._next()); return true;
      case 'diffuse':          surf.material.diffuse      = parseFloat(this._next()); return true;
      case 'specular':         surf.material.specular     = parseFloat(this._next()); return true;
      case 'transmission':     surf.material.transmission = parseFloat(this._next()); return true;
      case 'specular_conc':    surf.material.specularConc = parseFloat(this._next()); return true;
      case 'diffuse_color':    surf.material.diffuseColor  = this._readVec3(); return true;
      case 'specular_color':   surf.material.specularColor = this._readVec3(); return true;
      case 'rendering_style':  surf.renderingStyle = this._next(); return true;
      case 'polygon_direction':surf.polygonDirection = this._next(); return true;
      case 'visibility':       surf.visibility = parseFloat(this._next()); return true;
      case 'marker_color':     this._readVec3(); return true;  // 3 values, skip
      // scalar no-ops
      case 'numbers': case 'markers': case 'mirror':
      case 'texture_mode': case 'number_scale': case 'marker_scale':
        this._next(); return true;
      default: return false;
    }
  }

  _isNodeType(tok) {
    return tok === 'surface' || tok === 'def_surface' || tok === 'eye_surface' ||
           tok === 'light' || tok === 'view' || tok === 'gthing';
  }

  // ── surface ───────────────────────────────────────────────────────────────

  _parseSurface(name) {
    const surf = { name, type: 'surface', children: [], polygons: [],
                   translation: [0,0,0], rotation: [0,0,0], scaling: [1,1,1], pivot: [0,0,0],
                   material: this._defaultMaterial(), renderingStyle: 'smooth',
                   polygonDirection: 'counter_clockwise', visibility: 1 };
    while (true) {
      const tok = this._peek();
      if (tok === '}' || !tok) { this._next(); break; }
      if (this._isNodeType(tok)) { const c = this._parseNode(); if (c) surf.children.push(c); continue; }
      this._next();
      if (tok === 'polygons')   { surf.polygons = this._parsePolygons();  continue; }
      if (tok === 'parameters') { this._skipValueTok(tok);               continue; } // ignore params on container surfaces
      if (!this._parseSurfaceAttrib(surf, tok)) this._skipValueTok(tok);
    }
    return surf;
  }

  // ── def_surface ───────────────────────────────────────────────────────────

  _parseDefSurface(name) {
    const surf = { name, type: 'def_surface', children: [], polygons: [],
                   vertices: [], controlPoints: [], parameters: [], deformations: [],
                   translation: [0,0,0], rotation: [0,0,0], scaling: [1,1,1], pivot: [0,0,0],
                   material: this._defaultMaterial(), renderingStyle: 'smooth',
                   polygonDirection: 'counter_clockwise', visibility: 1 };
    while (true) {
      const tok = this._peek();
      if (tok === '}' || !tok) { this._next(); break; }
      if (this._isNodeType(tok)) { const c = this._parseNode(); if (c) surf.children.push(c); continue; }
      this._next();
      if (!this._parseSurfaceAttrib(surf, tok)) {
        switch (tok) {
          case 'parameters':     surf.parameters  = this._parseParameters();   break;
          case 'vertices':       surf.vertices    = this._parseVertices();      break;
          case 'control_points': surf.controlPoints = this._parseControlPoints(); break;
          case 'deformation':    surf.deformations.push(this._parseDeformation()); break;
          case 'polygons':       surf.polygons    = this._parsePolygons();      break;
          default:               this._skipValueTok(tok); break;
        }
      }
    }
    return surf;
  }

  // ── eye_surface ───────────────────────────────────────────────────────────

  _parseEyeSurface(name) {
    const surf = { name, type: 'eye_surface', children: [], parameters: [],
                   nrLatitudes: 5, nrLongitudes: 20, meshType: 'tri',
                   translation: [0,0,0], rotation: [0,0,0], scaling: [1,1,1], pivot: [0,0,0],
                   material: this._defaultMaterial(), renderingStyle: 'smooth',
                   polygonDirection: 'counter_clockwise', visibility: 1 };
    while (true) {
      const tok = this._peek();
      if (tok === '}' || !tok) { this._next(); break; }
      if (this._isNodeType(tok)) { const c = this._parseNode(); if (c) surf.children.push(c); continue; }
      this._next();
      if (!this._parseSurfaceAttrib(surf, tok)) {
        switch (tok) {
          case 'parameters':    surf.parameters   = this._parseParameters(); break;
          case 'nr_latitudes':  surf.nrLatitudes  = parseInt(this._next()); break;
          case 'nr_longitudes': surf.nrLongitudes = parseInt(this._next()); break;
          case 'mesh_type':     surf.meshType     = this._next(); break;
          default:              this._skipValueTok(tok); break;
        }
      }
    }
    return surf;
  }

  // ── parameters / vertices / polygons blocks ───────────────────────────────

  _parseParameters() {
    this._expect('{');
    const params = [];
    while (true) {
      const tok = this._next();
      if (tok === '}' || !tok) break;
      const index = parseInt(tok);
      const name  = this._next();
      const value = parseFloat(this._next());
      const min   = parseFloat(this._next());
      const max   = parseFloat(this._next());
      params.push({ index, name, value, min, max });
    }
    return params;
  }

  _parseVertices() {
    const verts = [];
    this._readLineBlock(tokens => {
      if (tokens.length >= 4) {
        verts[parseInt(tokens[0])] = [parseFloat(tokens[1]), parseFloat(tokens[2]), parseFloat(tokens[3])];
      }
    });
    return verts;
  }

  _parseControlPoints() {
    this._expect('{');
    const cps = [];
    while (true) {
      const tok = this._next();
      if (tok === '}' || !tok) break;
      cps.push(parseInt(tok));
    }
    return cps;
  }

  _parsePolygons() {
    const polys = [];
    this._readLineBlock(tokens => {
      const indices = tokens.map(t => parseInt(t)).filter(n => !isNaN(n));
      if (indices.length >= 3) polys.push(indices);
    });
    return polys;
  }

  // ── deformation ───────────────────────────────────────────────────────────

  _parseDeformation() {
    const defName = this._next();
    this._expect('{');
    const def = { name: defName, paramName: '', state: 1, transform: 'translate',
                  proto: -1, target: -1, pivot: -1, direction: [1,0,0],
                  mode: 0, ascale: 1.0, aoffset: 0.0, influence: [] };
    while (true) {
      const tok = this._next();
      if (tok === '}' || !tok) break;
      switch (tok) {
        case 'parameter': {
          const v = this._next();
          def.paramName = v; // may be numeric or name; resolved later
          break;
        }
        case 'state': {
          const v = this._next();
          def.state = (v === '1' || v === 'on') ? 1 : 0; break;
        }
        case 'transform': {
          const v = this._next();
          if      (v.startsWith('tran'))  def.transform = 'translate';
          else if (v.startsWith('pull'))  def.transform = 'pull';
          else if (v.startsWith('scal'))  def.transform = 'scale';
          else if (v.startsWith('x_rot')) def.transform = 'rot_x';
          else if (v.startsWith('y_rot')) def.transform = 'rot_y';
          else if (v.startsWith('z_rot')) def.transform = 'rot_z';
          break;
        }
        case 'proto':     def.proto   = parseInt(this._next()); break;
        case 'target':    def.target  = parseInt(this._next()); break;
        case 'pivot':     def.pivot   = parseInt(this._next()); break;
        case 'mode':      def.mode    = parseInt(this._next()); break;
        case 'scale':     def.ascale  = parseFloat(this._next()); break;
        case 'offset':    def.aoffset = parseFloat(this._next()); break;
        case 'direction': def.direction = this._readVec3(); break;
        case 'influence': this._parseInfluenceBlock(def.influence); break;
        default: this._skipValueTok(tok); break;
      }
    }
    return def;
  }

  _parseInfluenceBlock(inf) {
    this._expect('{');
    while (true) {
      const tok = this._next();
      if (tok === '}' || !tok) break;
      inf.push({ v: parseInt(tok), w: parseFloat(this._next()) });
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _readVec3() {
    return [parseFloat(this._next()), parseFloat(this._next()), parseFloat(this._next())];
  }

  // Skip the value(s) associated with an already-consumed keyword token.
  _skipValueTok(tok) {
    const next = this._peek();
    if (next === '{') { this._next(); this._skipBlock(); }
    // else: it was a scalar, already consumed keyword; next token is the value, skip it
    else if (next !== '}' && next !== null && !this._isNodeType(next)) {
      this._next();
    }
  }
}
