/**
 * GUB WebGL Player – Three.js renderer + deformation engine.
 *
 * Coordinate convention
 * ---------------------
 * GUB uses: X = depth (camera looks along -X), Y = left-right, Z = up-down.
 * Three.js uses Y-up. We map:
 *   gub X → three.js Z   (depth axis, camera along -Z in three)
 *   gub Y → three.js X   (left-right)
 *   gub Z → three.js Y   (vertical)
 * Helper: g2t([gx, gy, gz]) → [gy, gz, gx]
 */

// ─── Coordinate conversion ────────────────────────────────────────────────────
function g2t([gx, gy, gz]) { return [gy, gz, gx]; }

// ─── Vec3 math in GUB space ───────────────────────────────────────────────────
const V3 = {
  add:  (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]],
  sub:  (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]],
  scale:(a, s) => [a[0]*s, a[1]*s, a[2]*s],
  mul:  (a, b) => [a[0]*b[0], a[1]*b[1], a[2]*b[2]],
  div:  (a, b) => [
    Math.abs(b[0]) > 1e-10 ? a[0]/b[0] : 1,
    Math.abs(b[1]) > 1e-10 ? a[1]/b[1] : 1,
    Math.abs(b[2]) > 1e-10 ? a[2]/b[2] : 1,
  ],
  rotx: (p, angleDeg, piv) => {
    const a = angleDeg * Math.PI / 180, sa = Math.sin(a), ca = Math.cos(a);
    const dy = p[1]-piv[1], dz = p[2]-piv[2];
    return [p[0], dy*ca - dz*sa + piv[1], dy*sa + dz*ca + piv[2]];
  },
  roty: (p, angleDeg, piv) => {
    const a = angleDeg * Math.PI / 180, sa = Math.sin(a), ca = Math.cos(a);
    const dz = p[2]-piv[2], dx = p[0]-piv[0];
    return [dz*sa + dx*ca + piv[0], p[1], dz*ca - dx*sa + piv[2]];
  },
  rotz: (p, angleDeg, piv) => {
    const a = angleDeg * Math.PI / 180, sa = Math.sin(a), ca = Math.cos(a);
    const dx = p[0]-piv[0], dy = p[1]-piv[1];
    return [dx*ca - dy*sa + piv[0], dx*sa + dy*ca + piv[1], p[2]];
  },
  invrotx: (p, t, piv) => (Math.atan2(t[2]-piv[2], t[1]-piv[1]) - Math.atan2(p[2]-piv[2], p[1]-piv[1])) * 180/Math.PI,
  invroty: (p, t, piv) => (Math.atan2(t[0]-piv[0], t[2]-piv[2]) - Math.atan2(p[0]-piv[0], p[2]-piv[2])) * 180/Math.PI,
  invrotz: (p, t, piv) => (Math.atan2(t[1]-piv[1], t[0]-piv[0]) - Math.atan2(p[1]-piv[1], p[0]-piv[0])) * 180/Math.PI,
};

// ─── Deformation engine ───────────────────────────────────────────────────────
function applyDeformations(origVerts, deformations, paramMap) {
  // Work on a mutable copy in GUB space
  const verts = origVerts.map(v => v ? [v[0], v[1], v[2]] : null);

  for (const def of deformations) {
    if (!def.state) continue;
    const paramVal = paramMap.get(def.paramName);
    if (paramVal === undefined) continue;
    const act = paramVal * def.ascale + def.aoffset;
    if (act === 0 && def.influence.length === 0) continue;

    const pro = def.proto  >= 0 ? verts[def.proto]  : null;
    const tar = def.target >= 0 ? verts[def.target] : null;
    const piv = def.pivot  >= 0 ? verts[def.pivot]  : null;

    switch (def.transform) {
      case 'translate': {
        if (!pro) break;
        const dir = tar ? V3.sub(tar, pro) : def.direction;
        for (const {v, w} of def.influence) {
          if (!verts[v]) continue;
          const aw = act * w;
          verts[v][0] += aw * dir[0];
          verts[v][1] += aw * dir[1];
          verts[v][2] += aw * dir[2];
        }
        break;
      }
      case 'pull': {
        const tgt = tar ?? (pro ? V3.add(pro, def.direction) : null);
        if (!tgt) break;
        for (const {v, w} of def.influence) {
          if (!verts[v]) continue;
          const aw = act * w;
          verts[v][0] = aw*tgt[0] + (1-aw)*verts[v][0];
          verts[v][1] = aw*tgt[1] + (1-aw)*verts[v][1];
          verts[v][2] = aw*tgt[2] + (1-aw)*verts[v][2];
        }
        break;
      }
      case 'scale': {
        if (!pro || !piv) break;
        let K;
        if (def.mode === 0) {
          const t = tar ?? V3.add(pro, def.direction);
          K = V3.div(V3.sub(t, piv), V3.sub(pro, piv));
        } else { K = def.direction; }
        for (const {v, w} of def.influence) {
          if (!verts[v]) continue;
          const aw = act * w, vv = verts[v];
          const sc = V3.add(piv, V3.mul(K, V3.sub(vv, piv)));
          verts[v][0] = aw*(sc[0]-vv[0]) + vv[0];
          verts[v][1] = aw*(sc[1]-vv[1]) + vv[1];
          verts[v][2] = aw*(sc[2]-vv[2]) + vv[2];
        }
        break;
      }
      case 'rot_x': {
        if (!pro || !piv) break;
        const t   = tar ?? V3.add(pro, def.direction);
        const A   = def.mode === 0 ? V3.invrotx(pro, t, piv) : 1;
        for (const {v, w} of def.influence) {
          if (!verts[v]) continue;
          const r = V3.rotx(verts[v], act * w * A, piv);
          verts[v][0]=r[0]; verts[v][1]=r[1]; verts[v][2]=r[2];
        }
        break;
      }
      case 'rot_y': {
        if (!piv) break;
        let A;
        if (def.mode === 0) {
          if (!pro) break;
          const t = tar ?? V3.add(pro, def.direction);
          A = V3.invroty(pro, t, piv);
        } else { A = 1; }
        for (const {v, w} of def.influence) {
          if (!verts[v]) continue;
          const r = V3.roty(verts[v], act * w * A, piv);
          verts[v][0]=r[0]; verts[v][1]=r[1]; verts[v][2]=r[2];
        }
        break;
      }
      case 'rot_z': {
        if (!pro || !piv) break;
        const t = tar ?? V3.add(pro, def.direction);
        const A = def.mode === 0 ? V3.invrotz(pro, t, piv) : 1;
        for (const {v, w} of def.influence) {
          if (!verts[v]) continue;
          const r = V3.rotz(verts[v], act * w * A, piv);
          verts[v][0]=r[0]; verts[v][1]=r[1]; verts[v][2]=r[2];
        }
        break;
      }
    }
  }
  return verts;
}

// ─── Procedural eye geometry ──────────────────────────────────────────────────
function buildEyeVerts(nLat, nLon, radiiDeg) {
  // Returns sparse array (1-indexed): vertex 1 = pole, then nLat rings of nLon vertices.
  // All in local unit-sphere space (GUB axes: X=front, Y=lat, Z=up).
  const verts = [null, [0, 0, 1]]; // index 0 unused; 1 = pole along GUB-X... actually +Z local
  for (let lat = 0; lat < nLat; lat++) {
    const theta = (radiiDeg[lat] ?? (lat + 1) * 15) * Math.PI / 180;
    const sinT = Math.sin(theta), cosT = Math.cos(theta);
    for (let lon = 0; lon < nLon; lon++) {
      const phi = (lon * 2 * Math.PI / nLon);
      verts.push([sinT * Math.cos(phi), sinT * Math.sin(phi), cosT]);
    }
  }
  return verts;
}

// ─── Material builder ─────────────────────────────────────────────────────────
function makeMaterial(mat, style) {
  const [dr,dg,db] = mat.diffuseColor ?? [0.8,0.6,0.4];
  const [sr,sg,sb] = mat.specularColor ?? [1,1,1];
  const d = mat.diffuse ?? 1, s = (mat.specular ?? 0.5) * 0.25;
  if (style === 'wireframe') {
    return new THREE.MeshBasicMaterial({ color: new THREE.Color(dr,dg,db), wireframe: true, side: THREE.DoubleSide });
  }
  return new THREE.MeshPhongMaterial({
    color:     new THREE.Color(dr*d, dg*d, db*d),
    specular:  new THREE.Color(sr*s, sg*s, sb*s),
    shininess: (mat.specularConc ?? 1) * 6,
    side:      THREE.DoubleSide,
    transparent: (mat.transmission ?? 0) > 0,
    opacity: Math.max(0, 1 - (mat.transmission ?? 0)),
  });
}

// ─── Zero the mirror-plane (X) component of normals for centre-line vertices ──
// Vertices at Three.js X ≈ 0 (GUB Y ≈ 0) sit on the symmetry plane. Their normals
// are computed from only one half of the mesh, so they point slightly sideways and
// cause a visible shading crease. Zeroing that component and renormalising fixes it.
function fixCenterNormals(geo, threshold = 5) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  if (!nor) return;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getX(i)) < threshold) {
      const ny = nor.getY(i), nz = nor.getZ(i);
      const len = Math.sqrt(ny*ny + nz*nz);
      nor.setXYZ(i, 0, len > 1e-10 ? ny/len : ny, len > 1e-10 ? nz/len : nz);
    }
  }
  nor.needsUpdate = true;
}

// ─── Build an indexed BufferGeometry from (possibly sparse) vert array + polygon groups ──
function buildMultiGroupGeometry(origVerts, groups) {
  // 1. Compact vertex array – map origIdx → compactIdx
  const vertexMap = new Map();
  let compact = 0;
  for (let i = 0; i < origVerts.length; i++) {
    if (origVerts[i]) vertexMap.set(i, compact++);
  }

  // Fill position buffer: three.x = GUB Y, three.y = GUB Z, three.z = GUB X
  const posBuf = new Float32Array(compact * 3);
  let ci = 0;
  for (let i = 0; i < origVerts.length; i++) {
    if (origVerts[i]) {
      const [gx, gy, gz] = origVerts[i];
      posBuf[ci*3    ] = gy;
      posBuf[ci*3 + 1] = gz;
      posBuf[ci*3 + 2] = gx;
      ci++;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posBuf, 3));
  geo.userData.vertexMap = vertexMap;

  // 2. Build index + groups
  const allIdx  = [];
  const geoGroups = [];

  for (const grp of groups) {
    const start = allIdx.length;
    for (const poly of (grp.polygons || [])) {
      const mapped = poly.map(vi => { const ci = vertexMap.get(vi); return ci ?? 0; });
      if (mapped.length === 3) {
        allIdx.push(...mapped);
      } else if (mapped.length === 4) {
        allIdx.push(mapped[0], mapped[1], mapped[2]);
        allIdx.push(mapped[0], mapped[2], mapped[3]);
      } else if (mapped.length > 4) {
        for (let i = 1; i < mapped.length - 1; i++)
          allIdx.push(mapped[0], mapped[i], mapped[i+1]);
      }
    }
    const count = allIdx.length - start;
    if (count > 0) geoGroups.push({ start, count });
  }

  const idxBuf = allIdx.length > 65535 ? new Uint32Array(allIdx) : new Uint16Array(allIdx);
  geo.setIndex(new THREE.BufferAttribute(idxBuf, 1));
  for (let g = 0; g < geoGroups.length; g++) {
    geo.addGroup(geoGroups[g].start, geoGroups[g].count, g);
  }
  geo.computeVertexNormals();
  fixCenterNormals(geo);
  return geo;
}

// Update a geometry's position buffer from deformed vertices (GUB space)
function writeVertsToGeo(geo, deformed, mirror) {
  const pos = geo.attributes.position;
  const vm  = geo.userData.vertexMap;
  for (const [origIdx, ci] of vm) {
    const v = deformed[origIdx];
    if (!v) continue;
    const [gx, gy, gz] = v;
    pos.setXYZ(ci, mirror ? -gy : gy, gz, gx);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  fixCenterNormals(geo);
}

// ─── GubRenderer ─────────────────────────────────────────────────────────────
class GubRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this._initThree();

    /** @type {Array<{defNode, paramMap, origVerts, deformations, geometry, mesh, isMirror}>} */
    this.defSurfaces = [];
    /** @type {Array<{eyeNode, paramMap, group, mesh}>} */
    this.eyeObjects  = [];
    /** @type {Map<string, {value, min, max, entries:[]}>} */
    this.allParams   = new Map();

    this.datAnim     = null;
    this.datMap      = null;
    this.playing     = false;
    this.playStart   = 0;
    this.playFrame   = 0;

    this._jog        = null;  // active jog: { data, startTime, lastFrame }
    this.gubeGroup   = null;  // Three.js Group for the 'gube' container surface

    this.onFrameUpdate  = null; // (frameIdx, total) => void
    this.onParamsUpdated = null; // () => void

    this._loop();
  }

  // ── Three.js init ──────────────────────────────────────────────────────────
  _initThree() {
    const w = this.canvas.clientWidth  || 800;
    const h = this.canvas.clientHeight || 600;

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0.44, 0.82, 1.0);

    // Camera: GUB "from" = (988, -51, -139) → three.js (gy, gz, gx) = (-51, -139, 988)
    this.camera = new THREE.PerspectiveCamera(28, w / h, 1, 8000);
    this.camera.position.set(-51, -139, 988);
    this.camera.lookAt(0, 0, 0);

    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    new ResizeObserver(() => {
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      if (!w || !h) return;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h, false);
    }).observe(this.canvas.parentElement ?? this.canvas);
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    if (this.playing) this._tickDat();
    if (this._jog)    this._tickJog();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // ── Scene loading ──────────────────────────────────────────────────────────
  loadScene(gubData) {
    // Clear previous scene (keep lights added freshly below)
    for (const obj of [...this.scene.children]) this.scene.remove(obj);
    this.defSurfaces = [];
    this.eyeObjects  = [];
    this.allParams.clear();
    this.gubeGroup   = null;
    this._jog        = null;

    this._applyViewSettings(gubData);
    this._addLights(gubData);

    if (gubData.scene) this._walkNode(gubData.scene, this.scene);

    this.datMap = gubData.map || [];
  }

  _applyViewSettings(gubData) {
    const findView = n => {
      if (!n) return null;
      if (n.type === 'view') return n;
      for (const c of n.children ?? []) { const v = findView(c); if (v) return v; }
      return null;
    };
    const view = findView(gubData.scene);
    if (view?.bgColor) {
      const [r,g,b] = view.bgColor;
      this.scene.background = new THREE.Color(r,g,b);
    }
  }

  _addLights(gubData) {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const collectLights = n => {
      if (!n) return;
      if (n.type === 'light' && n.state && n.lightType !== 'ambient') {
        const [r,g,b] = n.color ?? [1,1,1];
        const dl = new THREE.DirectionalLight(new THREE.Color(r,g,b), 0.9);
        const [dx,dy,dz] = n.direction ?? [0,0,-1];
        // Direction in GUB space; convert to three.js and negate (light "from")
        dl.position.set(-dy*500, -dz*500, -dx*500);
        this.scene.add(dl);
      }
      for (const c of n.children ?? []) collectLights(c);
    };
    collectLights(gubData.scene);
  }

  // ── Scene tree walk ────────────────────────────────────────────────────────
  _walkNode(node, parentObj) {
    switch (node.type) {
      case 'gthing':
      case 'view':
        for (const c of node.children ?? []) this._walkNode(c, parentObj);
        break;
      case 'surface':
        this._buildSurface(node, parentObj);
        break;
      case 'def_surface':
        this._buildDefSurface(node, parentObj, false);
        break;
      case 'eye_surface':
        this._buildEyeSurface(node, parentObj, false);
        break;
      // lights are added separately via _addLights; ignore here
    }
  }

  // ── Container surface ──────────────────────────────────────────────────────
  _buildSurface(node, parentObj) {
    if (node.visibility === 0) return;

    const group = new THREE.Group();
    this._applyTransform(group, node);
    parentObj.add(group);
    if (node.name === 'gube') this.gubeGroup = group;

    const isMirrorSide = (node.name === 'rightface' || node.name === 'righteye');

    for (const child of node.children ?? []) {
      switch (child.type) {
        case 'surface':      this._buildSurface(child, group); break;
        case 'def_surface':  this._buildDefSurface(child, group, isMirrorSide); break;
        case 'eye_surface':  this._buildEyeSurface(child, group, isMirrorSide); break;
      }
    }
  }

  _applyTransform(obj, node) {
    if (node.translation) {
      const [gx,gy,gz] = node.translation;
      obj.position.set(gy, gz, gx);
    }
    if (node.rotation) {
      // GUB rotations: rx around GUB-X, ry around GUB-Y, rz around GUB-Z
      // After mapping: GUB-X→three-Z, GUB-Y→three-X, GUB-Z→three-Y
      const [rx,ry,rz] = node.rotation.map(d => d * Math.PI / 180);
      // three rotation: .x = around three-X = around GUB-Y = ry
      //                 .y = around three-Y = around GUB-Z = rz
      //                 .z = around three-Z = around GUB-X = rx
      obj.rotation.set(ry, rz, rx);
    }
    if (node.scaling) {
      const [gx,gy,gz] = node.scaling;
      obj.scale.set(gy, gz, gx);
    }
  }

  // ── def_surface ────────────────────────────────────────────────────────────
  _buildDefSurface(node, parentObj, mirrored) {
    const hasVerts = node.vertices && node.vertices.some(v => v);
    if (!hasVerts) {
      if (mirrored) this._buildMirroredDefSurface(node, parentObj);
      return;
    }

    // Resolve numeric parameter names in deformations
    for (const def of node.deformations ?? []) {
      if (!isNaN(Number(def.paramName))) {
        const idx = parseInt(def.paramName);
        const p = node.parameters?.find(pp => pp.index === idx);
        if (p) def.paramName = p.name;
      }
    }

    // Build paramMap
    const paramMap = new Map();
    for (const p of node.parameters ?? []) {
      if (p.name !== 'p') paramMap.set(p.name, p.value);
    }

    // Collect sub-surface polygon groups (flesh, tongue, teeth, hair, …)
    const groups = [];
    this._collectSurfaceGroups(node.children ?? [], groups);

    // If no sub-surfaces have polygons, use the def_surface's own polygons
    if (groups.length === 0 && node.polygons?.length > 0) {
      groups.push({ polygons: node.polygons, material: node.material, renderingStyle: node.renderingStyle });
    }
    if (groups.length === 0) return;

    const geo       = buildMultiGroupGeometry(node.vertices, groups);
    const materials = groups.map(g => makeMaterial(g.material ?? node.material, g.renderingStyle ?? node.renderingStyle));
    const mesh      = new THREE.Mesh(geo, materials);
    this._applyTransform(mesh, node);
    parentObj.add(mesh);

    // Initial deformation pass
    const deformed = applyDeformations(node.vertices, node.deformations ?? [], paramMap);
    writeVertsToGeo(geo, deformed, false);

    const entry = { defNode: node, paramMap, origVerts: node.vertices,
                    deformations: node.deformations ?? [], geometry: geo, mesh, isMirror: false };
    this.defSurfaces.push(entry);

    // Register params globally
    for (const p of node.parameters ?? []) {
      if (p.name === 'p') continue;
      const lo = Math.min(p.min, p.max), hi = Math.max(p.min, p.max);
      if (!this.allParams.has(p.name)) {
        this.allParams.set(p.name, { value: p.value, min: lo, max: hi, entries: [] });
      }
      this.allParams.get(p.name).entries.push(entry);
    }
  }

  _buildMirroredDefSurface(node, parentObj) {
    // Find first non-mirrored def_surface with the same name
    const src = this.defSurfaces.find(e => !e.isMirror && e.defNode.name === node.name);
    if (!src) return;

    const clonedGeo = src.geometry.clone();
    // The parent rightface group already has scale(-1,1,1) applied by _applyTransform
    // (from the GUB file's "scaling 1 -1 1"). We must NOT negate positions here —
    // doing so would cancel the parent scale. Instead, reverse winding so that
    // normals point outward after the scale inversion.
    const idxArr = clonedGeo.index.array;
    for (let i = 0; i < idxArr.length; i += 3) {
      const tmp = idxArr[i + 1]; idxArr[i + 1] = idxArr[i + 2]; idxArr[i + 2] = tmp;
    }
    clonedGeo.index.needsUpdate = true;
    clonedGeo.computeVertexNormals();

    const mats = Array.isArray(src.mesh.material)
      ? src.mesh.material.map(m => m.clone())
      : src.mesh.material.clone();

    const mesh = new THREE.Mesh(clonedGeo, mats);
    parentObj.add(mesh);

    const mirrorEntry = { defNode: node, paramMap: src.paramMap,
                          origVerts: src.origVerts, deformations: src.deformations,
                          geometry: clonedGeo, mesh, isMirror: true };
    this.defSurfaces.push(mirrorEntry);
    // Register entries on allParams
    for (const p of src.defNode.parameters ?? []) {
      if (p.name === 'p') continue;
      if (this.allParams.has(p.name)) {
        this.allParams.get(p.name).entries.push(mirrorEntry);
      }
    }
  }

  _collectSurfaceGroups(children, out) {
    for (const child of children) {
      if (child.type === 'surface') {
        if (child.polygons?.length > 0) {
          out.push({ name: child.name, polygons: child.polygons,
                     material: child.material, renderingStyle: child.renderingStyle });
        }
        // Recurse into nested container surfaces
        this._collectSurfaceGroups(child.children ?? [], out);
      }
    }
  }

  // ── eye_surface ────────────────────────────────────────────────────────────
  _buildEyeSurface(node, parentObj, mirrored) {
    // Collect child sub-surface polygon groups (pupil, iris, fringe, eyewhite)
    const groups = [];
    for (const child of node.children ?? []) {
      if (child.type === 'surface' && child.polygons?.length > 0) {
        groups.push({ polygons: child.polygons, material: child.material,
                      renderingStyle: child.renderingStyle ?? 'smooth' });
      }
    }

    if (groups.length === 0) {
      // Empty eye_surface (righteye) – clone and mirror lefteye
      if (mirrored) this._buildMirroredEye(node, parentObj);
      return;
    }

    // Generate procedural eye vertices
    const nLat  = node.nrLatitudes  ?? 5;
    const nLon  = node.nrLongitudes ?? 20;
    const radii = [];
    for (let i = 0; i < 5; i++) {
      const p = node.parameters?.find(pp => pp.index === i);
      radii.push(p ? p.value : (i+1)*15);
    }
    const eyeVerts = buildEyeVerts(nLat, nLon, radii);

    const geo  = buildMultiGroupGeometry(eyeVerts, groups);
    const mats = groups.map(g => makeMaterial(g.material ?? node.material, g.renderingStyle));

    const eyeGroup = new THREE.Group();
    this._applyTransform(eyeGroup, node);
    parentObj.add(eyeGroup);

    const mesh = new THREE.Mesh(geo, mats);
    eyeGroup.add(mesh);

    // Gaze rotation sub-group (for x/y/z_rotation parameters)
    const gazeGroup = new THREE.Group();
    eyeGroup.add(gazeGroup);

    const paramMap = new Map();
    for (const p of node.parameters ?? []) {
      if (p.name !== 'p') paramMap.set(p.name, p.value);
    }

    const eyeEntry = { eyeNode: node, paramMap, eyeGroup, mesh };
    this.eyeObjects.push(eyeEntry);

    // Register gaze params
    for (const pname of ['x_rotation', 'y_rotation', 'z_rotation']) {
      const p = node.parameters?.find(pp => pp.name === pname);
      if (!p) continue;
      const key = `eye_${node.name}_${pname}`;
      if (!this.allParams.has(key)) {
        this.allParams.set(key, { value: p.value, min: Math.min(p.min,p.max), max: Math.max(p.min,p.max), entries: [] });
      }
      this.allParams.get(key).entries.push({ isEye: true, eyeEntry, paramName: pname });
    }
  }

  _buildMirroredEye(node, parentObj) {
    const src = this.eyeObjects[0];
    if (!src) return;

    const clonedGeo = src.mesh.geometry.clone();
    // Eye sphere is symmetric; no position negation or winding reversal needed.
    // The righteye container is already translated to the mirror position.

    const mats = Array.isArray(src.mesh.material)
      ? src.mesh.material.map(m => m.clone())
      : src.mesh.material.clone();

    const group = new THREE.Group();
    // Apply the SOURCE eye_surface's transform (rotation + scaling), not the empty node's.
    this._applyTransform(group, src.eyeNode);
    parentObj.add(group);

    const mesh = new THREE.Mesh(clonedGeo, mats);
    group.add(mesh);

    // Create an eye entry so gaze param changes (x/y/z_rotation) affect this eye too.
    const mirrorParamMap = new Map(src.paramMap);
    const mirrorEntry = { eyeNode: src.eyeNode, paramMap: mirrorParamMap, eyeGroup: group, mesh };
    this.eyeObjects.push(mirrorEntry);

    for (const pname of ['x_rotation', 'y_rotation', 'z_rotation']) {
      const key = `eye_${src.eyeNode.name}_${pname}`;
      if (this.allParams.has(key)) {
        this.allParams.get(key).entries.push({ isEye: true, eyeEntry: mirrorEntry, paramName: pname });
      }
    }
  }

  // ── Parameter updates ──────────────────────────────────────────────────────
  setParameter(name, value) {
    const info = this.allParams.get(name);
    if (!info) return;
    info.value = value;

    const processed = new Set();
    for (const entry of info.entries) {
      if (entry.isEye) {
        entry.eyeEntry.paramMap.set(entry.paramName, value);
        this._applyEyeGaze(entry.eyeEntry);
        continue;
      }
      // Update paramMap and recompute if not already done this call
      entry.paramMap.set(name, value);
      const geoKey = entry.geometry;
      if (processed.has(geoKey)) continue;
      processed.add(geoKey);
      this._recomputeDefSurface(entry);
    }
  }

  _recomputeDefSurface(entry) {
    const deformed = applyDeformations(entry.origVerts, entry.deformations, entry.paramMap);
    writeVertsToGeo(entry.geometry, deformed, false);

    // Update mirrors that share the same paramMap.
    // No position negation (mirror=false) — the parent rightface group's scale(-1,1,1)
    // provides the mirror; the index winding is already reversed in the clone.
    for (const e of this.defSurfaces) {
      if (e.isMirror && e.paramMap === entry.paramMap && e.defNode.name === entry.defNode.name) {
        writeVertsToGeo(e.geometry, deformed, false);
      }
    }
  }

  _applyEyeGaze(entry) {
    const rx = (entry.paramMap.get('x_rotation') ?? 0) * Math.PI / 180;
    const ry = (entry.paramMap.get('y_rotation') ?? 0) * Math.PI / 180;
    const rz = (entry.paramMap.get('z_rotation') ?? 0) * Math.PI / 180;
    entry.mesh.rotation.set(rx, ry, rz);
  }

  // ── DAT playback ───────────────────────────────────────────────────────────
  loadDat(datData) {
    this.datAnim   = datData;
    this.playing   = false;
    this.playFrame = 0;
    return datData.frames.length;
  }

  play() {
    if (!this.datAnim) return;
    this.playing   = true;
    this.playStart = performance.now() - (this.playFrame * 1000 / this.datAnim.framerate);
  }

  pause() { this.playing = false; }

  seekFrame(f) {
    if (!this.datAnim) return;
    this.playFrame = Math.max(0, Math.min(f, this.datAnim.frames.length - 1));
    this._applyFrame(this.playFrame);
  }

  _tickDat() {
    if (!this.datAnim) return;
    const elapsed = performance.now() - this.playStart;
    const frame   = Math.floor(elapsed * this.datAnim.framerate / 1000);
    if (frame >= this.datAnim.frames.length) { this.playing = false; return; }
    if (frame !== this.playFrame) {
      this.playFrame = frame;
      this._applyFrame(frame);
    }
  }

  _applyFrame(idx) {
    if (!this.datAnim || !this.datMap) return;
    const frame = this.datAnim.frames[idx];
    if (!frame) return;
    const { paramNames } = this.datAnim;

    for (const mapping of this.datMap) {
      const pos = paramNames.indexOf(mapping.datName);
      if (pos < 0) continue;
      const value = frame.vals[pos] * mapping.scale;
      // Apply to all def_surfaces whose name matches nodeName
      for (const entry of this.defSurfaces) {
        if (!entry.isMirror && entry.defNode.name === mapping.nodeName) {
          entry.paramMap.set(mapping.paramName, value);
        }
      }
      // Sync allParams value
      if (this.allParams.has(mapping.paramName)) {
        this.allParams.get(mapping.paramName).value = value;
      }
    }

    // Recompute all deformed surfaces
    const processed = new Set();
    for (const entry of this.defSurfaces) {
      if (entry.isMirror) continue;
      if (processed.has(entry.geometry)) continue;
      processed.add(entry.geometry);
      this._recomputeDefSurface(entry);
    }

    if (this.onFrameUpdate) this.onFrameUpdate(idx, this.datAnim.frames.length);
    if (this.onParamsUpdated) this.onParamsUpdated();
  }

  // ── JOG gesture playback ──────────────────────────────────────────────────
  // Non-blocking: plays on top of any current state; ticked every rAF in _loop.
  // Calling playJog while one is running cancels and replaces it immediately.
  playJog(jogData) {
    this._jog = { data: jogData, startTime: performance.now(), lastFrame: -1 };
  }

  stopJog() { this._jog = null; }

  _tickJog() {
    const jog = this._jog;
    const frame = Math.floor((performance.now() - jog.startTime) * jog.data.framerate / 1000);
    if (frame === jog.lastFrame) return;
    if (frame >= jog.data.frames.length) { this._jog = null; return; }
    jog.lastFrame = frame;

    const vals = jog.data.frames[frame];
    for (let i = 0; i < jog.data.channels.length; i++) {
      const ch  = jog.data.channels[i];
      const val = (vals[i] ?? 0) * ch.mult + ch.offset;
      this._applyJogParam(ch.object, ch.paramName, val);
    }
    if (this.onParamsUpdated) this.onParamsUpdated();
  }

  _applyJogParam(object, paramName, val) {
    if (object === 'face') {
      this.setParameter(paramName, val);
    } else if (object === 'eye') {
      // JOG eye values are normalised 0–1 over the parameter's full range.
      // e.g. y_rotation range is [-50, 50] degrees, so 0.52 → 2° (neutral).
      const key  = `eye_eye_${paramName}`;
      const info = this.allParams.get(key);
      const paramVal = info ? val * (info.max - info.min) + info.min : val;
      this.setParameter(key, paramVal);
    } else if (object === 'gube' && this.gubeGroup) {
      // GUB rotation params (0–1 range, 0.5 = neutral).
      // Map to ±90° around the corresponding Three.js axis.
      const a = (val - 0.5) * Math.PI;
      if      (paramName === 'y_rotation') this.gubeGroup.rotation.x = a;
      else if (paramName === 'z_rotation') this.gubeGroup.rotation.y = a;
      else if (paramName === 'x_rotation') this.gubeGroup.rotation.z = a;
    }
  }
}
