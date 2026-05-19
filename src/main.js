import "./style.css";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

/* =====================================================================
   AUDIO TUNNEL — v3
   ---------------------------------------------------------------------
   Motor: "el túnel es la memoria de la canción" (v2 intacta).
   Nuevo: la fuente de audio ya no es solo un archivo. Tres modos:
     · TAB  -> captura el audio de una pestaña/sistema (Spotify, YouTube,
               Apple Music, Amazon... da igual: capturamos el RESULTADO).
     · MIC  -> escucha por el micrófono. Universal, también en móvil.
     · FILE -> subir un archivo. Queda como último recurso.
   No nos conectamos a las plataformas (imposible por DRM): capturamos
   el sonido que ya suena, con permiso explícito del usuario.
   ===================================================================== */

// ------------------------------------------------------
// DOM base
// ------------------------------------------------------

const audio = document.querySelector("#audio");
const controls = document.querySelector(".controls");

let audioUpload = document.querySelector("#audio-upload");
let playButton = document.querySelector("#play-button");
let fileNameLabel = document.querySelector("#file-name");
let seekSlider = document.querySelector("#seek-slider");
let volumeSlider = document.querySelector("#volume-slider");
let currentTimeLabel = document.querySelector("#current-time");
let durationLabel = document.querySelector("#duration");

const bassMeter = document.querySelector("#bass-meter");
const midsMeter = document.querySelector("#mids-meter");
const highsMeter = document.querySelector("#highs-meter");

if (controls) {
  if (!audioUpload) {
    const fileControl = document.createElement("label");
    fileControl.className = "file-control";
    fileControl.setAttribute("for", "audio-upload");
    fileControl.innerHTML = `
      <span class="file-label">Choose audio</span>
      <span id="file-name" class="file-name">No track selected</span>
    `;
    audioUpload = document.createElement("input");
    audioUpload.id = "audio-upload";
    audioUpload.className = "audio-upload";
    audioUpload.type = "file";
    audioUpload.accept = "audio/*";
    controls.prepend(audioUpload);
    controls.prepend(fileControl);
  }
  if (!playButton) {
    playButton = document.createElement("button");
    playButton.id = "play-button";
    playButton.disabled = true;
    playButton.textContent = "Play";
    controls.appendChild(playButton);
  }
  if (!seekSlider || !currentTimeLabel || !durationLabel) {
    const transport = document.createElement("div");
    transport.className = "transport";
    transport.innerHTML = `
      <span id="current-time">0:00</span>
      <input id="seek-slider" type="range" min="0" max="100" value="0" />
      <span id="duration">0:00</span>
    `;
    controls.appendChild(transport);
  }
  if (!volumeSlider) {
    const volumeControl = document.createElement("div");
    volumeControl.className = "volume-control";
    volumeControl.innerHTML = `
      <span>Vol</span>
      <input id="volume-slider" type="range" min="0" max="100" value="100" />
    `;
    controls.appendChild(volumeControl);
  }
  audioUpload = document.querySelector("#audio-upload");
  playButton = document.querySelector("#play-button");
  fileNameLabel = document.querySelector("#file-name");
  seekSlider = document.querySelector("#seek-slider");
  volumeSlider = document.querySelector("#volume-slider");
  currentTimeLabel = document.querySelector("#current-time");
  durationLabel = document.querySelector("#duration");
}

// ------------------------------------------------------
// Controles de FUENTE (inyectados desde JS, sin tocar el HTML)
// ------------------------------------------------------

const sourceStyle = document.createElement("style");
sourceStyle.textContent = `
  .source-row { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:10px; }
  .source-btn {
    flex:1; min-width:150px; padding:10px 14px; cursor:pointer;
    background:rgba(109,79,196,0.12); color:#e8e6f2;
    border:1px solid rgba(109,79,196,0.5); border-radius:8px;
    font:inherit; font-size:0.82rem; letter-spacing:0.02em;
    transition:background .15s ease, border-color .15s ease;
  }
  .source-btn:hover { background:rgba(109,79,196,0.28); border-color:rgba(109,79,196,0.9); }
  .source-btn.active { background:rgba(255,207,156,0.18); border-color:#ffcf9c; color:#fff; }
  .source-status { margin:2px 0 14px; font-size:0.74rem; opacity:0.6; }
`;
document.head.appendChild(sourceStyle);

const tabButton = document.createElement("button");
tabButton.className = "source-btn";
tabButton.textContent = "Capturar pestaña / sistema";

const micButton = document.createElement("button");
micButton.className = "source-btn";
micButton.textContent = "Micrófono";

const sourceRow = document.createElement("div");
sourceRow.className = "source-row";
sourceRow.appendChild(tabButton);
sourceRow.appendChild(micButton);

const sourceStatus = document.createElement("p");
sourceStatus.className = "source-status";
sourceStatus.textContent = "Elige una fuente de audio para empezar.";

if (controls && controls.parentElement) {
  controls.parentElement.insertBefore(sourceRow, controls);
  controls.parentElement.insertBefore(sourceStatus, controls);
}

function setStatus(text) {
  sourceStatus.textContent = text;
}

function markActive(mode) {
  tabButton.classList.toggle("active", mode === "tab");
  micButton.classList.toggle("active", mode === "mic");
}

// ------------------------------------------------------
// Subsistema de audio: contexto, ruteo y fuentes
// ------------------------------------------------------

let audioContext;
let analyser;
let frequencyData;

let mediaElementSource = null; // modo archivo (solo se puede crear UNA vez)
let liveStream = null;         // MediaStream de captura en vivo
let liveSource = null;         // nodo de la captura en vivo
let activeMode = "none";       // "none" | "file" | "tab" | "mic"

function ensureContext() {
  if (audioContext) return;
  audioContext = new AudioContext();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.82;
  frequencyData = new Uint8Array(analyser.frequencyBinCount);
}

// Desconecta el grafo actual y detiene la captura en vivo si la hubiera.
function clearRouting() {
  if (analyser) analyser.disconnect();
  if (liveSource) {
    liveSource.disconnect();
    liveSource = null;
  }
  if (mediaElementSource) mediaElementSource.disconnect();
  if (liveStream) {
    liveStream.getTracks().forEach((t) => t.stop());
    liveStream = null;
  }
}

// --- Modo TAB: capturar el audio de una pestaña o del sistema ---
async function captureTab() {
  try {
    ensureContext();
    await audioContext.resume();
    setStatus("Pidiendo permiso para capturar...");

    // video:true es OBLIGATORIO: Chrome solo ofrece "compartir audio de la
    // pestaña" cuando compartes una pestaña/pantalla con vídeo.
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
      systemAudio: "include",
    });

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      setStatus('No llegó audio. Reintenta y marca la casilla "Compartir audio de la pestaña".');
      return;
    }

    // El vídeo no nos interesa: lo detenemos para no gastar recursos.
    stream.getVideoTracks().forEach((t) => t.stop());

    clearRouting();
    if (audio && !audio.paused) audio.pause();
    liveStream = stream;
    liveSource = audioContext.createMediaStreamSource(stream);

    // CLAVE: NO conectamos a destination. El audio ya suena en el sistema;
    // reproducirlo otra vez daría doble sonido / eco.
    liveSource.connect(analyser);

    activeMode = "tab";
    markActive("tab");
    setStatus("Capturando la pestaña. Pon música donde la tengas y suena el túnel.");

    audioTracks[0].addEventListener("ended", () => {
      if (activeMode === "tab") {
        activeMode = "none";
        markActive("none");
        setStatus("Compartición detenida. Elige una fuente para continuar.");
      }
    });
  } catch (err) {
    if (err && err.name === "NotAllowedError") {
      setStatus("Permiso cancelado.");
    } else {
      setStatus("No se pudo capturar: " + (err?.message || err));
    }
  }
}

// --- Modo MIC: escuchar por el micrófono ---
async function captureMic() {
  try {
    ensureContext();
    await audioContext.resume();
    setStatus("Pidiendo permiso del micrófono...");

    // Desactivamos los procesados del navegador: están pensados para voz
    // y destrozarían la música (filtran graves, comprimen, cancelan).
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    clearRouting();
    if (audio && !audio.paused) audio.pause();
    liveStream = stream;
    liveSource = audioContext.createMediaStreamSource(stream);
    liveSource.connect(analyser); // sin destination: evita realimentación

    activeMode = "mic";
    markActive("mic");
    setStatus("Escuchando por el micrófono. Pon música cerca.");
  } catch (err) {
    if (err && err.name === "NotAllowedError") {
      setStatus("Permiso de micrófono denegado.");
    } else {
      setStatus("No se pudo usar el micrófono: " + (err?.message || err));
    }
  }
}

// --- Modo FILE: el archivo subido (único modo que SÍ va a destination) ---
function useFileSource() {
  ensureContext();
  if (!mediaElementSource) {
    // createMediaElementSource solo puede llamarse una vez por elemento.
    mediaElementSource = audioContext.createMediaElementSource(audio);
  }
  clearRouting();
  mediaElementSource.connect(analyser);
  analyser.connect(audioContext.destination); // el archivo sí debe sonar
  activeMode = "file";
  markActive("none");
}

tabButton.addEventListener("click", captureTab);
micButton.addEventListener("click", captureMic);

// ------------------------------------------------------
// Reproductor de archivo (modo FILE)
// ------------------------------------------------------

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

function updateSeekUI() {
  if (!seekSlider || !currentTimeLabel || !durationLabel) return;
  if (!audio.duration) return;
  seekSlider.value = (audio.currentTime / audio.duration) * 100;
  currentTimeLabel.textContent = formatTime(audio.currentTime);
  durationLabel.textContent = formatTime(audio.duration);
}

if (audioUpload) {
  audioUpload.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (fileNameLabel) fileNameLabel.textContent = file.name;

    const url = URL.createObjectURL(file);
    audio.src = url;
    audio.currentTime = 0;

    if (seekSlider && currentTimeLabel && durationLabel) {
      seekSlider.value = 0;
      currentTimeLabel.textContent = "0:00";
      durationLabel.textContent = "0:00";
    }
    playButton.disabled = false;
    playButton.textContent = "Play";
  });
}

if (playButton) {
  playButton.addEventListener("click", async () => {
    useFileSource();
    if (audioContext.state === "suspended") await audioContext.resume();

    if (audio.paused) {
      await audio.play();
      playButton.textContent = "Pause";
      setStatus("Reproduciendo archivo.");
    } else {
      audio.pause();
      playButton.textContent = "Play";
    }
  });
}

audio.addEventListener("loadedmetadata", updateSeekUI);
audio.addEventListener("timeupdate", updateSeekUI);
audio.addEventListener("ended", () => {
  if (playButton) playButton.textContent = "Play";
});

if (seekSlider) {
  seekSlider.addEventListener("input", () => {
    if (!audio.duration) return;
    audio.currentTime = (seekSlider.value / 100) * audio.duration;
    updateSeekUI();
  });
}

if (volumeSlider) {
  volumeSlider.addEventListener("input", () => {
    audio.volume = volumeSlider.value / 100;
  });
}

// ------------------------------------------------------
// Lectura de audio + onsets
// ------------------------------------------------------

let bassEnergy = 0;
let midsEnergy = 0;
let highsEnergy = 0;
let overallEnergy = 0;

let prevSpectrum = null;
const fluxHistory = [];
let onsetActive = 0;
let onsetCooldown = 0;

function averageRange(data, start, end) {
  let sum = 0;
  const safeEnd = Math.min(end, data.length);
  for (let i = start; i < safeEnd; i++) sum += data[i];
  return sum / Math.max(1, safeEnd - start) / 255;
}

function updateAudioValues() {
  if (onsetCooldown > 0) onsetCooldown--;
  if (onsetActive > 0) onsetActive--;

  if (!analyser || !frequencyData) {
    bassEnergy *= 0.92;
    midsEnergy *= 0.92;
    highsEnergy *= 0.92;
    overallEnergy *= 0.92;
    return;
  }

  analyser.getByteFrequencyData(frequencyData);

  const rawBass = averageRange(frequencyData, 0, 14);
  const rawMids = averageRange(frequencyData, 14, 80);
  const rawHighs = averageRange(frequencyData, 80, 220);
  const rawOverall = averageRange(frequencyData, 0, 220);

  bassEnergy += (rawBass - bassEnergy) * 0.2;
  midsEnergy += (rawMids - midsEnergy) * 0.14;
  highsEnergy += (rawHighs - highsEnergy) * 0.22;
  overallEnergy += (rawOverall - overallEnergy) * 0.13;

  if (bassMeter) bassMeter.style.width = `${bassEnergy * 100}%`;
  if (midsMeter) midsMeter.style.width = `${midsEnergy * 100}%`;
  if (highsMeter) highsMeter.style.width = `${highsEnergy * 100}%`;

  // Flujo espectral: cuánto SUBE el espectro frame a frame -> golpes.
  let flux = 0;
  if (prevSpectrum) {
    for (let i = 0; i < 120; i++) {
      const diff = frequencyData[i] - prevSpectrum[i];
      if (diff > 0) flux += diff;
    }
  }
  flux /= 120 * 255;
  prevSpectrum = frequencyData.slice();

  fluxHistory.push(flux);
  if (fluxHistory.length > 43) fluxHistory.shift();

  const mean = fluxHistory.reduce((a, b) => a + b, 0) / fluxHistory.length;
  const threshold = mean * 1.6 + 0.006;

  if (flux > threshold && flux > 0.012 && onsetCooldown === 0) {
    onsetActive = 14;
    onsetCooldown = 8;
  }
}

// ------------------------------------------------------
// Paleta — dos colores. El color codifica energía, no decora.
// ------------------------------------------------------

const COLOR_VOID = new THREE.Color("#05060a");
const COLOR_PULSE = new THREE.Color("#6d4fc4");
const COLOR_SPARK = new THREE.Color("#ffcf9c");

// ------------------------------------------------------
// Escena
// ------------------------------------------------------

const scene = new THREE.Scene();
scene.background = COLOR_VOID.clone();
scene.fog = new THREE.Fog(COLOR_VOID.clone(), 10, 78);

const camera = new THREE.PerspectiveCamera(
  74,
  window.innerWidth / window.innerHeight,
  0.1,
  140
);
camera.position.set(0, 0, 4.6);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.14,
  0.5,
  0.2
);
composer.addPass(bloomPass);

// ------------------------------------------------------
// Túnel de anillos-memoria
// ------------------------------------------------------

const tunnelGroup = new THREE.Group();
scene.add(tunnelGroup);

const RING_COUNT = 90;
const RING_SPACING = 1.0;
const TUNNEL_DEPTH = RING_COUNT * RING_SPACING;
const BIRTH_RESET = 6;

const ringGeometry = new THREE.TorusGeometry(3, 0.05, 12, 120);
const ringSegments = [];

for (let i = 0; i < RING_COUNT; i++) {
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(ringGeometry, material);
  ring.position.z = -i * RING_SPACING;
  ring.rotation.z = i * 0.14;
  ring.userData.snapshot = { energy: 0, bass: 0, onset: 0 };
  tunnelGroup.add(ring);
  ringSegments.push(ring);
}

// Captura el sonido del instante en que el anillo nace al fondo.
function captureSnapshot(ring) {
  const s = ring.userData.snapshot;
  s.energy = overallEnergy;
  s.bass = bassEnergy;
  s.onset = onsetActive > 0 ? 1 : 0;
}

// Pinta el anillo según su sonido CONGELADO, no el audio en vivo.
const _tmpColor = new THREE.Color();
function renderSnapshot(ring) {
  const s = ring.userData.snapshot;
  _tmpColor.copy(COLOR_VOID).lerp(COLOR_PULSE, Math.min(1, s.energy * 2.4));
  if (s.onset) _tmpColor.lerp(COLOR_SPARK, 0.9);
  ring.material.color.copy(_tmpColor);
  ring.material.opacity = 0.1 + s.energy * 0.62 + s.onset * 0.28;
  ring.scale.setScalar(1 + s.bass * 0.16 + s.onset * 0.14);
}

// ------------------------------------------------------
// Animación
// ------------------------------------------------------

const clock = new THREE.Clock();
let speed = 0.04;

function animate() {
  const t = clock.getElapsedTime();

  updateAudioValues();

  // El silencio frena el túnel; con inercia, arranca y para con peso.
  const silence = overallEnergy < 0.04;
  const targetSpeed = silence ? 0.004 : 0.05 + overallEnergy * 0.22;
  speed += (targetSpeed - speed) * 0.04;

  for (let i = 0; i < ringSegments.length; i++) {
    const ring = ringSegments[i];
    ring.position.z += speed;
    if (ring.position.z > BIRTH_RESET) {
      ring.position.z -= TUNNEL_DEPTH;
      captureSnapshot(ring);
    }
    renderSnapshot(ring);
  }

  bloomPass.strength = 0.1 + overallEnergy * 0.22;

  camera.position.x = Math.sin(t * 0.3) * 0.06;
  camera.position.y = Math.cos(t * 0.23) * 0.06;
  camera.lookAt(0, 0, -10);

  composer.render();
  requestAnimationFrame(animate);
}

animate();

// ------------------------------------------------------
// Resize
// ------------------------------------------------------

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});