// ─── UI wiring ────────────────────────────────────────────────────────────────
// Loaded after THREE, GubParser, DatParser, GubRenderer are all available.

const canvas    = document.getElementById('glcanvas');
const overlay   = document.getElementById('drop-overlay');
const statusEl  = document.getElementById('status');
const paramsDiv = document.getElementById('params-container');
const transport = document.getElementById('transport');
const timeline  = document.getElementById('timeline');
const timeLabel = document.getElementById('time-label');
const playBtn   = document.getElementById('play-btn');
const openGub   = document.getElementById('open-gub-btn');
const openDat   = document.getElementById('open-dat-btn');
const fileGub   = document.getElementById('file-gub');
const fileDat   = document.getElementById('file-dat');
const resetBtn  = document.getElementById('reset-btn');

const renderer  = new GubRenderer(canvas);
const parser    = new GubParser();
const datParser = new DatParser();

let defaultValues = {};
let sliderEls     = {};
let valEls        = {};
let totalFrames   = 0;
let isPlaying     = false;

// ── Load .gub ──────────────────────────────────────────────────────────────

function loadGub(text) {
  let gubData;
  try {
    gubData = parser.parse(text);
  } catch (e) {
    setStatus('Parse error: ' + e.message, true);
    console.error(e);
    return;
  }
  renderer.loadScene(gubData);
  overlay.classList.add('hidden');
  openDat.disabled = false;
  buildSliders();
  setStatus('Model loaded – ' + renderer.defSurfaces.filter(e=>!e.isMirror).length + ' def-surfaces, ' + renderer.allParams.size + ' parameters');
}

// ── Load .dat ──────────────────────────────────────────────────────────────

function loadDat(buf) {
  try {
    const datData = datParser.parse(buf);
    totalFrames = renderer.loadDat(datData);
    timeline.max   = Math.max(0, totalFrames - 1);
    timeline.value = 0;
    timeLabel.textContent = `0 / ${totalFrames} frames`;
    transport.classList.remove('hidden');

    renderer.onFrameUpdate = (f, total) => {
      timeline.value = f;
      timeLabel.textContent = `${f} / ${total} frames`;
      syncSlidersFromParams();
    };
    renderer.onParamsUpdated = syncSlidersFromParams;

    setStatus(`DAT loaded – ${totalFrames} frames @ ${datData.framerate} fps`);
  } catch (e) {
    setStatus('DAT error: ' + e.message, true);
    console.error(e);
  }
}

// ── Build parameter sliders ────────────────────────────────────────────────

function buildSliders() {
  paramsDiv.innerHTML = '';
  sliderEls     = {};
  valEls        = {};
  defaultValues = {};

  if (!renderer.allParams.size) {
    paramsDiv.innerHTML = '<div style="padding:12px;color:#555">No parameters found.</div>';
    return;
  }

  const sorted = [...renderer.allParams.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  for (const [name, info] of sorted) {
    const lo  = Math.min(info.min, info.max);
    const hi  = Math.max(info.min, info.max);
    const val = isFinite(info.value) ? info.value : 0;
    const clampedVal = hi > lo ? Math.max(lo, Math.min(hi, val)) : val;

    defaultValues[name] = clampedVal;

    const row      = document.createElement('div');
    row.className  = 'param-row';

    const label    = document.createElement('div');
    label.className = 'param-label';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'param-name';
    nameSpan.textContent = name;
    nameSpan.title = name;

    const valSpan  = document.createElement('span');
    valSpan.className = 'param-val';
    valSpan.textContent = fmtVal(clampedVal);
    valEls[name] = valSpan;

    label.append(nameSpan, valSpan);

    const slider   = document.createElement('input');
    slider.type    = 'range';
    slider.className = 'param-slider';
    slider.min     = lo;
    slider.max     = hi > lo ? hi : lo + 1;
    slider.step    = (hi - lo) / 200 || 0.005;
    slider.value   = clampedVal;
    sliderEls[name] = slider;

    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      valSpan.textContent = fmtVal(v);
      renderer.setParameter(name, v);
    });

    row.append(label, slider);
    paramsDiv.appendChild(row);
  }
}

function fmtVal(v) { return (v || 0).toFixed(3); }

function syncSlidersFromParams() {
  for (const [name, info] of renderer.allParams) {
    const v = info.value ?? 0;
    if (sliderEls[name]) sliderEls[name].value = v;
    if (valEls[name]) valEls[name].textContent = fmtVal(v);
  }
}

// ── Reset ──────────────────────────────────────────────────────────────────

resetBtn.addEventListener('click', () => {
  for (const [name, val] of Object.entries(defaultValues)) {
    renderer.setParameter(name, val);
    if (sliderEls[name]) sliderEls[name].value = val;
    if (valEls[name]) valEls[name].textContent = fmtVal(val);
  }
});

// ── Transport controls ─────────────────────────────────────────────────────

playBtn.addEventListener('click', () => {
  isPlaying = !isPlaying;
  if (isPlaying) { renderer.play(); playBtn.textContent = '⏸ Pause'; playBtn.classList.add('active'); }
  else           { renderer.pause(); playBtn.textContent = '▶ Play'; playBtn.classList.remove('active'); }
});

timeline.addEventListener('input', () => {
  renderer.pause();
  isPlaying = false;
  playBtn.textContent = '▶ Play';
  playBtn.classList.remove('active');
  const f = parseInt(timeline.value);
  renderer.seekFrame(f);
  timeLabel.textContent = `${f} / ${totalFrames} frames`;
});

// Auto-stop play button when animation ends
const origOnFrame = renderer.onFrameUpdate;
renderer.onFrameUpdate = (f, total) => {
  if (f >= total - 1) {
    isPlaying = false;
    playBtn.textContent = '▶ Play';
    playBtn.classList.remove('active');
  }
  if (origOnFrame) origOnFrame(f, total);
};

// ── File pickers ───────────────────────────────────────────────────────────

openGub.addEventListener('click', () => fileGub.click());
openDat.addEventListener('click', () => fileDat.click());

fileGub.addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  setStatus(`Loading ${f.name}…`);
  const reader = new FileReader();
  reader.onload = ev => loadGub(ev.target.result);
  reader.readAsText(f);
  fileGub.value = '';
});

fileDat.addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  if (!renderer.defSurfaces.length) { setStatus('Load a .gub model first.', true); return; }
  setStatus(`Loading ${f.name}…`);
  const reader = new FileReader();
  reader.onload = ev => loadDat(ev.target.result);
  reader.readAsArrayBuffer(f);
  fileDat.value = '';
});

// ── Drag and drop ─────────────────────────────────────────────────────────

document.addEventListener('dragover', e => {
  e.preventDefault();
  document.body.classList.add('dragover');
});
document.addEventListener('dragleave', e => {
  if (!e.relatedTarget) document.body.classList.remove('dragover');
});
document.addEventListener('drop', e => {
  e.preventDefault();
  document.body.classList.remove('dragover');
  for (const f of e.dataTransfer.files) {
    if (f.name.endsWith('.gub')) {
      setStatus(`Loading ${f.name}…`);
      const reader = new FileReader();
      reader.onload = ev => loadGub(ev.target.result);
      reader.readAsText(f);
    } else if (f.name.endsWith('.dat')) {
      if (!renderer.defSurfaces.length) { setStatus('Load a .gub model first.', true); continue; }
      setStatus(`Loading ${f.name}…`);
      const reader = new FileReader();
      reader.onload = ev => loadDat(ev.target.result);
      reader.readAsArrayBuffer(f);
    }
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? '#ef4444' : '#888';
}
