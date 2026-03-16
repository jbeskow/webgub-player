// ─── UI wiring ────────────────────────────────────────────────────────────────

const canvas    = document.getElementById('glcanvas');
const overlay   = document.getElementById('drop-overlay');
const statusEl  = document.getElementById('status');
const paramsDiv = document.getElementById('params-container');
const transport = document.getElementById('transport');
const timeline  = document.getElementById('timeline');
const timeLabel = document.getElementById('time-label');
const playBtn   = document.getElementById('play-btn');
const openGub       = document.getElementById('open-gub-btn');
const openDat       = document.getElementById('open-dat-btn');
const openWav       = document.getElementById('open-wav-btn');
const fileGub       = document.getElementById('file-gub');
const fileDat       = document.getElementById('file-dat');
const fileWav       = document.getElementById('file-wav');
const resetBtn      = document.getElementById('reset-btn');
const modelSelect   = document.getElementById('model-select');
const gestureBtns   = [...document.querySelectorAll('.gesture-btn')];

const renderer  = new GubRenderer(canvas);
const parser    = new GubParser();
const datParser = new DatParser();
const jogParser = new JogParser();

let defaultValues = {};
let sliderEls     = {};
let valEls        = {};
let totalFrames   = 0;
let isPlaying     = false;

// ── Audio (WAV) ────────────────────────────────────────────────────────────

let audioCtx    = null;
let audioBuffer = null;
let audioSource = null;
let audioOffset = 0;   // seconds into audio at last play/pause

function ensureAudioCtx() {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function audioPlay(offsetSec) {
  if (!audioBuffer) return;
  ensureAudioCtx();
  audioStop();
  audioSource = audioCtx.createBufferSource();
  audioSource.buffer = audioBuffer;
  audioSource.connect(audioCtx.destination);
  audioOffset = Math.max(0, Math.min(offsetSec, audioBuffer.duration));
  audioSource.start(0, audioOffset);
  audioSource.onended = () => { audioSource = null; };
}

function audioStop() {
  if (audioSource) {
    try { audioSource.stop(); } catch (_) {}
    audioSource.disconnect();
    audioSource = null;
  }
}

function audioPause() {
  // Snapshot current position before stopping
  audioOffset = renderer.datAnim
    ? renderer.playFrame / renderer.datAnim.framerate
    : (audioCtx ? audioOffset + (audioCtx.currentTime - (audioSource ? audioCtx.currentTime - audioOffset : audioCtx.currentTime)) : 0);
  audioStop();
}

function loadWav(arrayBuffer) {
  ensureAudioCtx();
  audioCtx.decodeAudioData(arrayBuffer).then(buf => {
    audioBuffer = buf;
    showTransport();
    setStatus(`WAV loaded – ${buf.duration.toFixed(1)} s`);
  }).catch(err => {
    setStatus('WAV decode error: ' + err.message, true);
  });
}

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
  openWav.disabled = false;
  gestureBtns.forEach(b => b.disabled = false);
  buildSliders();
  setStatus('Model loaded – ' + renderer.defSurfaces.filter(e => !e.isMirror).length +
            ' def-surfaces, ' + renderer.allParams.size + ' parameters');
}

// ── Load .dat ──────────────────────────────────────────────────────────────

function loadDat(buf) {
  let datData;
  try {
    datData = datParser.parse(buf);
  } catch (e) {
    setStatus('DAT error: ' + e.message, true);
    console.error(e);
    return;
  }

  totalFrames = renderer.loadDat(datData);
  timeline.max   = Math.max(0, totalFrames - 1);
  timeline.value = 0;
  timeline.style.display = '';
  timeLabel.textContent = `0 / ${totalFrames} frames`;
  showTransport();

  renderer.onFrameUpdate = (f, total) => {
    timeline.value = f;
    timeLabel.textContent = `${f} / ${total} frames`;
    syncSlidersFromParams();
    if (f >= total - 1) stopPlayback();
  };
  renderer.onParamsUpdated = syncSlidersFromParams;

  setStatus(`DAT loaded – ${totalFrames} frames @ ${datData.framerate} fps`);
}

// ── Transport visibility ───────────────────────────────────────────────────

function showTransport() {
  transport.classList.remove('hidden');
  document.body.classList.add('transport-visible');
  // Hide timeline if no DAT loaded yet
  timeline.style.display = renderer.datAnim ? '' : 'none';
  timeLabel.style.display = renderer.datAnim ? '' : 'none';
}

// ── Playback control ───────────────────────────────────────────────────────

function startPlayback() {
  isPlaying = true;
  playBtn.textContent = '⏸ Pause';
  playBtn.classList.add('active');

  const offsetSec = renderer.datAnim
    ? renderer.playFrame / renderer.datAnim.framerate
    : audioOffset;

  if (renderer.datAnim) renderer.play();
  audioPlay(offsetSec);
}

function pausePlayback() {
  isPlaying = false;
  playBtn.textContent = '▶ Play';
  playBtn.classList.remove('active');
  // Snapshot audio position before stopping
  if (renderer.datAnim) {
    audioOffset = renderer.playFrame / renderer.datAnim.framerate;
  } else if (audioCtx && audioSource) {
    audioOffset = Math.min(audioOffset + audioCtx.currentTime, audioBuffer?.duration ?? 0);
  }
  renderer.pause();
  audioStop();
}

function stopPlayback() {
  isPlaying = false;
  playBtn.textContent = '▶ Play';
  playBtn.classList.remove('active');
  renderer.pause();
  audioStop();
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

    const row = document.createElement('div');
    row.className = 'param-row';

    const label = document.createElement('div');
    label.className = 'param-label';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'param-name';
    nameSpan.textContent = name;
    nameSpan.title = name;

    const valSpan = document.createElement('span');
    valSpan.className = 'param-val';
    valSpan.textContent = fmtVal(clampedVal);
    valEls[name] = valSpan;

    label.append(nameSpan, valSpan);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'param-slider';
    slider.min   = lo;
    slider.max   = hi > lo ? hi : lo + 1;
    slider.step  = (hi - lo) / 200 || 0.005;
    slider.value = clampedVal;
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
    if (valEls[name])    valEls[name].textContent = fmtVal(v);
  }
}

// ── Reset ──────────────────────────────────────────────────────────────────

resetBtn.addEventListener('click', () => {
  for (const [name, val] of Object.entries(defaultValues)) {
    renderer.setParameter(name, val);
    if (sliderEls[name]) sliderEls[name].value = val;
    if (valEls[name])    valEls[name].textContent = fmtVal(val);
  }
});

// ── Transport controls ─────────────────────────────────────────────────────

playBtn.addEventListener('click', () => {
  if (!renderer.datAnim && !audioBuffer) return;
  if (isPlaying) pausePlayback(); else startPlayback();
});

timeline.addEventListener('input', () => {
  if (isPlaying) stopPlayback();
  const f = parseInt(timeline.value);
  renderer.seekFrame(f);
  timeLabel.textContent = `${f} / ${totalFrames} frames`;
  if (renderer.datAnim) audioOffset = f / renderer.datAnim.framerate;
});

// ── File pickers ───────────────────────────────────────────────────────────

openGub.addEventListener('click', () => fileGub.click());
openDat.addEventListener('click', () => fileDat.click());
openWav.addEventListener('click', () => fileWav.click());

fileGub.addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  setStatus(`Loading ${f.name}…`);
  const reader = new FileReader();
  reader.onload = ev => loadGub(ev.target.result);
  reader.readAsText(f);
  fileGub.value = '';
});

fileDat.addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  if (!renderer.defSurfaces.length) { setStatus('Load a .gub model first.', true); return; }
  setStatus(`Loading ${f.name}…`);
  const reader = new FileReader();
  reader.onload = ev => loadDat(ev.target.result);
  reader.readAsArrayBuffer(f);
  fileDat.value = '';
});

fileWav.addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  setStatus(`Loading ${f.name}…`);
  const reader = new FileReader();
  reader.onload = ev => loadWav(ev.target.result);
  reader.readAsArrayBuffer(f);
  fileWav.value = '';
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
    } else if (f.name.endsWith('.wav') || f.type.startsWith('audio/')) {
      setStatus(`Loading ${f.name}…`);
      const reader = new FileReader();
      reader.onload = ev => loadWav(ev.target.result);
      reader.readAsArrayBuffer(f);
    }
  }
});

// ── Model dropdown ─────────────────────────────────────────────────────────

modelSelect.addEventListener('change', () => {
  const url = modelSelect.value;
  if (!url) return;
  setStatus(`Loading ${url}…`);
  fetch(url)
    .then(r => { if (!r.ok) throw new Error(r.statusText); return r.text(); })
    .then(text => loadGub(text))
    .catch(e => setStatus('Model load error: ' + e.message, true))
    .finally(() => { modelSelect.value = ''; });
});

// ── Gesture buttons ────────────────────────────────────────────────────────

// Cache parsed jogs so re-clicking is instant
const jogCache = {};

function playGesture(btn) {
  const url = btn.dataset.jog;
  if (!url) return;

  const run = jogData => {
    renderer.playJog(jogData);
    // Visual feedback: highlight button for the duration of the gesture
    gestureBtns.forEach(b => b.classList.remove('playing'));
    btn.classList.add('playing');
    const dur = (jogData.frames.length / jogData.framerate) * 1000;
    setTimeout(() => btn.classList.remove('playing'), dur);
  };

  if (jogCache[url]) { run(jogCache[url]); return; }

  fetch(url)
    .then(r => { if (!r.ok) throw new Error(r.statusText); return r.text(); })
    .then(text => {
      jogCache[url] = jogParser.parse(text);
      run(jogCache[url]);
    })
    .catch(e => setStatus('Gesture error: ' + e.message, true));
}

gestureBtns.forEach(btn => btn.addEventListener('click', () => playGesture(btn)));

// ── Helpers ───────────────────────────────────────────────────────────────

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? '#ef4444' : '#888';
}
