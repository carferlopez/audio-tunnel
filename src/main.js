import "./style.css";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/* =====================================================================
   AUDIO TUNNEL — v4 · EL SER
   ---------------------------------------------------------------------
   Ya no visualizamos el sonido. Damos vida a un SER cuyo sistema
   nervioso es la música. Tres ideas:

   1. NACE.  La primera vez que suena audio, el ser se despliega desde
      un punto. Ese es su primer instante de vida.
   2. SIENTE.  No reacciona al volumen frame a frame: tiene un estado
      emocional que cambia con inercia. Se tensa, respira, se ENCOGE
      en el silencio como esperando, estalla con los golpes.
   3. SE CRÍA.  El ser tiene un ADN que se forma con su "dieta musical"
      a lo largo del tiempo y PERSISTE entre sesiones (localStorage).
      Música intensa lo hace de una manera; música serena, de otra.
      Cuanto más lo alimentas, más se vuelve él. Nadie tiene dos iguales.

   El motor de audio (fuentes tab/mic/file, energía, onsets, silencio)
   es el de la v3, intacto.
   ===================================================================== */

// ============================================================
// 1 · DOM base
// ============================================================

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
      <span class="file-label">Seleccionar audio</span>
      <span id="file-name" class="file-name">Ninguna pista seleccionada</span>
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
    playButton.textContent = "Reproducir";
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
      <span>Volumen</span>
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

// ============================================================
// 2 · Controles de fuente + estado del ser (inyectados)
// ============================================================

const uiStyle = document.createElement("style");
uiStyle.textContent = `
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
  .source-status { margin:2px 0 8px; font-size:0.74rem; opacity:0.6; }
  .being-line { margin:0 0 14px; font-size:0.78rem; opacity:0.78; }
  .being-line b { color:#cbb8ff; font-weight:600; }
  .being-reset {
    background:none; border:none; color:#8a7fae; cursor:pointer;
    font:inherit; font-size:0.72rem; text-decoration:underline;
    padding:0; margin-left:8px;
  }
  .being-reset:hover { color:#ffcf9c; }
`;
document.head.appendChild(uiStyle);

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
sourceStatus.textContent = "Elige una fuente de audio para despertar al ser.";

// Línea que describe al ser en palabras: feedback de que lo estás criando.
const beingLine = document.createElement("p");
beingLine.className = "being-line";

const resetButton = document.createElement("button");
resetButton.className = "being-reset";
resetButton.textContent = "empezar un ser nuevo";

if (controls && controls.parentElement) {
  controls.parentElement.insertBefore(sourceRow, controls);
  controls.parentElement.insertBefore(sourceStatus, controls);
  controls.parentElement.insertBefore(beingLine, controls);
}

function setStatus(text) {
  sourceStatus.textContent = text;
}
function markActive(mode) {
  tabButton.classList.toggle("active", mode === "tab");
  micButton.classList.toggle("active", mode === "mic");
}

// ============================================================
// 3 · Subsistema de audio (idéntico a v3)
// ============================================================

let audioContext;
let analyser;
let frequencyData;

let mediaElementSource = null;
let liveStream = null;
let liveSource = null;
let activeMode = "none";

function ensureContext() {
  if (audioContext) return;
  audioContext = new AudioContext();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.82;
  frequencyData = new Uint8Array(analyser.frequencyBinCount);
}

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

async function captureTab() {
  try {
    ensureContext();
    await audioContext.resume();
    setStatus("Pidiendo permiso para capturar...");
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
      systemAudio: "include",
    });
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      setStatus('No llegó audio. Reintenta y marca "Compartir audio de la pestaña".');
      return;
    }
    stream.getVideoTracks().forEach((t) => t.stop());
    clearRouting();
    if (audio && !audio.paused) audio.pause();
    liveStream = stream;
    liveSource = audioContext.createMediaStreamSource(stream);
    liveSource.connect(analyser); // sin destination: el audio ya suena en el sistema
    activeMode = "tab";
    markActive("tab");
    setStatus("Capturando la pestaña. Pon música y el ser despertará.");
    audioTracks[0].addEventListener("ended", () => {
      if (activeMode === "tab") {
        activeMode = "none";
        markActive("none");
        setStatus("Compartición detenida. Elige una fuente para continuar.");
      }
    });
  } catch (err) {
    setStatus(err && err.name === "NotAllowedError"
      ? "Permiso cancelado."
      : "No se pudo capturar: " + (err?.message || err));
  }
}

async function captureMic() {
  try {
    ensureContext();
    await audioContext.resume();
    setStatus("Pidiendo permiso del micrófono...");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    clearRouting();
    if (audio && !audio.paused) audio.pause();
    liveStream = stream;
    liveSource = audioContext.createMediaStreamSource(stream);
    liveSource.connect(analyser);
    activeMode = "mic";
    markActive("mic");
    setStatus("Escuchando por el micrófono. Pon música cerca.");
  } catch (err) {
    setStatus(err && err.name === "NotAllowedError"
      ? "Permiso de micrófono denegado."
      : "No se pudo usar el micrófono: " + (err?.message || err));
  }
}

function useFileSource() {
  ensureContext();
  if (!mediaElementSource) {
    mediaElementSource = audioContext.createMediaElementSource(audio);
  }
  clearRouting();
  mediaElementSource.connect(analyser);
  analyser.connect(audioContext.destination);
  activeMode = "file";
  markActive("none");
}

tabButton.addEventListener("click", captureTab);
micButton.addEventListener("click", captureMic);

// --- reproductor de archivo ---
function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
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
    audio.src = URL.createObjectURL(file);
    audio.currentTime = 0;
    if (seekSlider) seekSlider.value = 0;
    if (currentTimeLabel) currentTimeLabel.textContent = "0:00";
    if (durationLabel) durationLabel.textContent = "0:00";
    playButton.disabled = false;
    playButton.textContent = "Reproducir";
  });
}
if (playButton) {
  playButton.addEventListener("click", async () => {
    useFileSource();
    if (audioContext.state === "suspended") await audioContext.resume();
    if (audio.paused) {
      await audio.play();
      playButton.textContent = "Pausar";
      setStatus("Reproduciendo archivo.");
    } else {
      audio.pause();
      playButton.textContent = "Reproducir";
    }
  });
}
audio.addEventListener("loadedmetadata", updateSeekUI);
audio.addEventListener("timeupdate", updateSeekUI);
audio.addEventListener("ended", () => {
  if (playButton) playButton.textContent = "Reproducir";
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

// ============================================================
// 4 · Lectura de audio + onsets (idéntico a v3)
//     Añade onsetJustFired: el FLANCO exacto del golpe, que el ADN
//     usa para medir cuán percusiva es la dieta musical.
// ============================================================

let bassEnergy = 0, midsEnergy = 0, highsEnergy = 0, overallEnergy = 0;
let prevSpectrum = null;
const fluxHistory = [];
let onsetActive = 0;
let onsetCooldown = 0;
let onsetJustFired = false;

function averageRange(data, start, end) {
  let sum = 0;
  const safeEnd = Math.min(end, data.length);
  for (let i = start; i < safeEnd; i++) sum += data[i];
  return sum / Math.max(1, safeEnd - start) / 255;
}

function updateAudioValues() {
  onsetJustFired = false;
  if (onsetCooldown > 0) onsetCooldown--;
  if (onsetActive > 0) onsetActive--;

  if (!analyser || !frequencyData) {
    bassEnergy *= 0.92; midsEnergy *= 0.92;
    highsEnergy *= 0.92; overallEnergy *= 0.92;
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
    onsetJustFired = true; // flanco: este frame nació un golpe
  }
}

// ============================================================
// 5 · ADN — la dieta musical del ser, persistente
//     Tres rasgos que integran TODA la música escuchada, lentísimo:
//       energy   -> cuán intensa ha sido su dieta (0..1)
//       tilt     -> grave/oscura (-) vs brillante/luminosa (+)
//       density  -> ambiental (0) vs percusiva (1)
//     De estos tres nace su color, su forma de reposo y su carácter.
// ============================================================

const DNA_KEY = "audio-tunnel-being-dna";

function loadDNA() {
  try {
    const raw = localStorage.getItem(DNA_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      return {
        energy: d.energy ?? 0.3,
        tilt: d.tilt ?? 0,
        density: d.density ?? 0.3,
        age: d.age ?? 0, // segundos de música vividos
      };
    }
  } catch (e) { /* ignora datos corruptos */ }
  return { energy: 0.3, tilt: 0, density: 0.3, age: 0 };
}

let dna = loadDNA();
let dnaSaveTimer = 0;

function saveDNA() {
  try { localStorage.setItem(DNA_KEY, JSON.stringify(dna)); }
  catch (e) { /* almacenamiento lleno o bloqueado: no es crítico */ }
}
window.addEventListener("beforeunload", saveDNA);

// El ADN moldea al ser despacio. Solo se alimenta cuando hay música real.
function feedDNA(dt) {
  if (overallEnergy < 0.04) return; // el silencio no alimenta
  dna.energy += (overallEnergy - dna.energy) * 0.0009;
  const tilt = THREE.MathUtils.clamp((highsEnergy - bassEnergy) * 2.2, -1, 1);
  dna.tilt += (tilt - dna.tilt) * 0.0009;
  const beat = onsetJustFired ? 1 : 0;
  dna.density += (beat - dna.density) * 0.0025;
  dna.age += dt;
}

// Describe al ser en palabras llanas, a partir de su ADN.
function describeBeing() {
  const temperament =
    dna.density > 0.55 ? "inquieto" : dna.density < 0.28 ? "sereno" : "templado";
  const light =
    dna.tilt > 0.18 ? "luminoso" : dna.tilt < -0.18 ? "profundo" : "neutro";
  const vigor =
    dna.energy > 0.5 ? "intenso" : dna.energy < 0.25 ? "tranquilo" : "moderado";
  const minutes = Math.floor(dna.age / 60);
  const ageText = minutes < 1 ? "recién nacido"
    : minutes === 1 ? "1 minuto de vida"
    : `${minutes} minutos de vida`;
  return { temperament, light, vigor, ageText };
}

function refreshBeingLine() {
  const d = describeBeing();
  beingLine.innerHTML =
    `Tu ser es <b>${d.vigor}</b>, <b>${d.temperament}</b> y <b>${d.light}</b> · ${d.ageText}`;
  if (!beingLine.contains(resetButton)) beingLine.appendChild(resetButton);
}
refreshBeingLine();

resetButton.addEventListener("click", () => {
  if (!confirm("¿Empezar un ser nuevo? El que tienes se perderá.")) return;
  localStorage.removeItem(DNA_KEY);
  dna = loadDNA();
  birth = 0.74;
  born = false;
  refreshBeingLine();
  setStatus("Ser reiniciado. Pon música para que el nuevo despierte.");
});

// ============================================================
// 6 · Escena
// ============================================================

const COLOR_VOID = new THREE.Color("#05060a");

const scene = new THREE.Scene();
scene.background = COLOR_VOID.clone();

const camera = new THREE.PerspectiveCamera(
  52, window.innerWidth / window.innerHeight, 0.1, 100
);
camera.position.set(0, 0, 4.15);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.78;
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight("#8f7bff", "#050509", 0.85));
const keyLight = new THREE.DirectionalLight("#ffe0b7", 0.95);
keyLight.position.set(2.5, 3, 4);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight("#6de7ff", 0.62);
rimLight.position.set(-3, 1.5, 2.2);
scene.add(rimLight);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.2, 0.5, 0.2
);
composer.addPass(bloomPass);

// ============================================================
// 7 · EL SER
//     Un cuerpo blando deformado por ruido (vertex shader) + dos ojos.
//     La "mente" vive en JS; el shader solo es la piel.
// ============================================================

// --- Ruido simplex 3D (Ashima Arts / Stefan Gustavson, dominio público).
//     Da la deformación orgánica de la superficie. ---
const SIMPLEX_NOISE = `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(
    i.z+vec4(0.0,i1.z,i2.z,1.0))
    +i.y+vec4(0.0,i1.y,i2.y,1.0))
    +i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
`;

const bodyUniforms = {
  uTime:       { value: 0 },
  uArousal:    { value: 0 },   // excitación (0..1) — de la energía, con inercia
  uTension:    { value: 0 },   // alerta (0..1) — de agudos y golpes
  uPulse:      { value: 0 },   // respingo del golpe (decae rápido)
  uBirth:      { value: 0 },   // nacimiento (0..1)
  uCrisp:      { value: 0.3 }, // del ADN: forma de reposo lisa(0)/crispada(1)
  uColorCalm:  { value: new THREE.Color("#3a2d6b") },
  uColorActive:{ value: new THREE.Color("#7d5fd6") },
  uColorRim:   { value: new THREE.Color("#ffcf9c") },
  uColorDeep:  { value: new THREE.Color("#05040d") },
};

const bodyMaterial = new THREE.ShaderMaterial({
  transparent: true,
  uniforms: bodyUniforms,
  vertexShader: SIMPLEX_NOISE + `
    uniform float uTime, uArousal, uTension, uPulse, uBirth, uCrisp;
    varying vec3 vNormal;
    varying vec3 vViewDir;
    varying vec3 vModelPos;
    varying float vDisp;

    void main() {
      vec3 pos = position;
      vec3 n = normal;

      // Frecuencia del ruido: sube con la tensión y con un ADN crispado.
      float freq = 1.3 + uTension * 2.0 + uCrisp * 1.4;
      // Amplitud: respiración base SIEMPRE presente (vida) + energía + golpe.
      float amp  = 0.10 + uArousal * 0.26 + uPulse * 0.34;

      // Dos octavas de ruido animado: forma grande + detalle fino.
      float n1 = snoise(pos * freq + vec3(0.0, 0.0, uTime * (0.25 + uArousal * 0.7)));
      float n2 = snoise(pos * freq * 2.4 + vec3(uTime * 0.5)) * 0.38;
      float disp = (n1 + n2) * amp;
      pos += n * disp;

      // Respiración global lenta: aunque no haya música, el ser respira.
      float breathe = sin(uTime * 1.5) * 0.035 * (0.5 + uArousal);
      pos *= 1.0 + breathe;

      // Nacimiento: el cuerpo se despliega desde un punto.
      pos *= uBirth;

      vDisp = disp;
      vModelPos = pos;
      vNormal = normalize(normalMatrix * n);
      vec4 mv = modelViewMatrix * vec4(pos, 1.0);
      vViewDir = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    uniform float uTime, uArousal, uTension, uBirth;
    uniform vec3 uColorCalm, uColorActive, uColorRim, uColorDeep;
    varying vec3 vNormal;
    varying vec3 vViewDir;
    varying vec3 vModelPos;
    varying float vDisp;

    void main() {
      vec3 normal = normalize(vNormal);
      vec3 viewDir = normalize(vViewDir);
      vec3 lightDir = normalize(vec3(-0.45, 0.72, 0.52));
      float lambert = max(dot(normal, lightDir), 0.0);
      float halfLambert = lambert * 0.5 + 0.5;
      float fres = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.35);

      vec3 base = mix(uColorCalm, uColorActive, uArousal);
      float contour = sin(vModelPos.x * 8.0 + vModelPos.y * 5.0 - uTime * 0.35);
      contour += sin(vModelPos.z * 11.0 - vModelPos.y * 3.0 + uTime * 0.22) * 0.45;
      contour += sin((vModelPos.x + vModelPos.z) * 19.0 + uTension * 2.0) * 0.16;
      float vein = smoothstep(0.78, 0.97, abs(contour));
      float pore = smoothstep(0.84, 0.99, abs(sin(dot(vModelPos, vec3(23.0, 31.0, 17.0)))));

      vec3 col = mix(uColorDeep, base, 0.52 + halfLambert * 0.52);
      col += vDisp * 0.38;
      col = mix(col, uColorRim, vein * (0.08 + uArousal * 0.14));
      col += uColorRim * fres * (0.36 + uArousal * 1.05);
      col += base * pore * 0.06;

      gl_FragColor = vec4(col, uBirth);
    }
  `,
});

// Cuerpo: icosaedro subdividido — malla densa y uniforme para deformar.
const bodyGeometry = new THREE.IcosahedronGeometry(1.05, 4);
const body = new THREE.Mesh(bodyGeometry, bodyMaterial);

const coreMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uTime: { value: 0 },
    uArousal: { value: 0 },
    uBirth: { value: 0 },
    uColor: { value: new THREE.Color("#ffcf9c") },
  },
  vertexShader: `
    uniform float uTime, uArousal, uBirth;
    varying vec3 vNormal;
    varying vec3 vViewDir;

    void main() {
      vec3 pos = position * (0.68 + uArousal * 0.16);
      pos *= 1.0 + sin(uTime * 2.1 + position.y * 3.0) * 0.035;
      pos *= uBirth;
      vNormal = normalize(normalMatrix * normal);
      vec4 mv = modelViewMatrix * vec4(pos, 1.0);
      vViewDir = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    uniform float uArousal, uBirth;
    uniform vec3 uColor;
    varying vec3 vNormal;
    varying vec3 vViewDir;

    void main() {
      float fres = pow(1.0 - max(dot(normalize(vNormal), normalize(vViewDir)), 0.0), 1.7);
      float alpha = (0.18 + uArousal * 0.28) * (0.35 + fres) * uBirth;
      gl_FragColor = vec4(uColor * (0.55 + uArousal), alpha);
    }
  `,
});
const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.82, 4), coreMaterial);

// El ser entero (cuerpo + cara) vive en este grupo: así se mueve junto.
const being = new THREE.Group();
being.add(core);
being.add(body);
scene.add(being);

const filamentGroup = new THREE.Group();
being.add(filamentGroup);

const filamentMaterials = [
  new THREE.MeshBasicMaterial({
    color: "#ffcf9c",
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }),
  new THREE.MeshBasicMaterial({
    color: "#8ee7ff",
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }),
];

const filaments = [];
for (let i = 0; i < 6; i++) {
  const radius = 1.02 + i * 0.055;
  const tube = 0.004 + (i % 3) * 0.0015;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, tube, 6, 160),
    filamentMaterials[i % filamentMaterials.length].clone()
  );
  ring.rotation.set(
    Math.PI * (0.18 + i * 0.073),
    Math.PI * (0.07 + i * 0.11),
    Math.PI * (i * 0.17)
  );
  ring.userData.spin = (i % 2 ? -1 : 1) * (0.08 + i * 0.018);
  ring.userData.phase = i * 0.7;
  filamentGroup.add(ring);
  filaments.push(ring);
}

// --- Ojos: dos puntos. Bastan para que el cerebro vea un ser que mira. ---
function makeEye() {
  const eye = new THREE.Group();
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 32, 32),
    new THREE.MeshStandardMaterial({
      color: "#f5f0ff",
      roughness: 0.22,
      metalness: 0,
      emissive: "#171024",
      emissiveIntensity: 0.36,
    })
  );
  const iris = new THREE.Mesh(
    new THREE.CircleGeometry(0.078, 36),
    new THREE.MeshBasicMaterial({
      color: "#9dfff0",
      transparent: true,
      opacity: 0.92,
    })
  );
  const pupil = new THREE.Mesh(
    new THREE.CircleGeometry(0.039, 32),
    new THREE.MeshBasicMaterial({ color: "#05050a" })
  );
  const glint = new THREE.Mesh(
    new THREE.CircleGeometry(0.018, 16),
    new THREE.MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0.95,
    })
  );
  iris.position.z = 0.162;
  pupil.position.z = 0.164;
  glint.position.set(0.032, 0.034, 0.166);
  eye.add(ball);
  eye.add(iris);
  eye.add(pupil);
  eye.add(glint);
  return eye;
}

const leftEye = makeEye();
const rightEye = makeEye();
// La "cara" no rota con el cuerpo: siempre te mira de frente.
const face = new THREE.Group();
leftEye.position.set(-0.34, 0.16, 1.0);
rightEye.position.set(0.34, 0.16, 1.0);
face.add(leftEye);
face.add(rightEye);
being.add(face);

// El GLB generado por IA sustituye visualmente al cuerpo procedural.
// Dejamos las piezas antiguas apagadas para conservar el motor de estado/audio
// mientras validamos el modelo real.
core.visible = false;
body.visible = false;
filamentGroup.visible = false;
face.visible = false;
let proceduralFallbackActive = false;

const MODEL_URL = "/models/cute-being.glb";
const modelPivot = new THREE.Group();
const modelMaterials = [];
let modelRoot = null;
let modelMixer = null;
let modelLoadProgress = 0;

const loadingGlow = new THREE.Mesh(
  new THREE.SphereGeometry(0.56, 32, 32),
  new THREE.MeshBasicMaterial({
    color: "#8ee7ff",
    transparent: true,
    opacity: 0.1,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
);
being.add(loadingGlow);
being.add(modelPivot);

const auraMaterial = new THREE.MeshBasicMaterial({
  color: "#a78bff",
  transparent: true,
  opacity: 0.07,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const aura = new THREE.Mesh(new THREE.SphereGeometry(0.92, 32, 32), auraMaterial);
aura.visible = false;
being.add(aura);

const beatRingMaterial = new THREE.MeshBasicMaterial({
  color: "#ffcf9c",
  transparent: true,
  opacity: 0.16,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const beatRing = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.007, 8, 128), beatRingMaterial);
beatRing.rotation.x = Math.PI * 0.5;
beatRing.visible = false;
being.add(beatRing);

const sparklePositions = new Float32Array(90 * 3);
for (let i = 0; i < 90; i++) {
  const r = 0.85 + Math.random() * 0.42;
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  sparklePositions[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
  sparklePositions[i * 3 + 1] = Math.cos(phi) * r;
  sparklePositions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
}
const sparkleGeometry = new THREE.BufferGeometry();
sparkleGeometry.setAttribute("position", new THREE.BufferAttribute(sparklePositions, 3));
const sparkleMaterial = new THREE.PointsMaterial({
  color: "#ffffff",
  size: 0.018,
  transparent: true,
  opacity: 0.0,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const sparkles = new THREE.Points(sparkleGeometry, sparkleMaterial);
being.add(sparkles);

const gltfLoader = new GLTFLoader();
gltfLoader.load(
  MODEL_URL,
  (gltf) => {
    loadingGlow.visible = false;
    modelRoot = gltf.scene;

    const box = new THREE.Box3().setFromObject(modelRoot);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z) || 1;
    modelRoot.position.sub(center);
    modelRoot.scale.setScalar(1.38 / maxDimension);

    modelRoot.traverse((child) => {
      if (!child.isMesh) return;
      child.frustumCulled = false;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (!material) return;
        material.roughness = Math.min(0.9, Math.max(material.roughness ?? 0.55, 0.42));
        material.metalness = Math.min(material.metalness ?? 0, 0.05);
        material.envMapIntensity = 1.35;
        if (material.emissive) material.emissive.set("#08040f");
        modelMaterials.push(material);
      });
    });

    if (gltf.animations.length > 0) {
      modelMixer = new THREE.AnimationMixer(modelRoot);
      gltf.animations.forEach((clip) => modelMixer.clipAction(clip).play());
    }

    aura.visible = true;
    beatRing.visible = true;
    modelPivot.add(modelRoot);
    setStatus("Modelo cargado. Elige una fuente de audio para despertarlo.");
    applyDNAtoBeing();
  },
  (event) => {
    if (!event.total) return;
    modelLoadProgress = event.loaded / event.total;
    setStatus(`Cargando ser 3D... ${Math.round(modelLoadProgress * 100)}%`);
  },
  (error) => {
    console.error("No se pudo cargar el modelo GLB", error);
    loadingGlow.visible = false;
    body.visible = true;
    face.visible = true;
    proceduralFallbackActive = true;
    setStatus("No se pudo cargar el modelo 3D; usando el ser básico.");
  }
);

// Aplica al shader el color y la forma de reposo que dicta el ADN.
function applyDNAtoBeing() {
  // tilt: -1 grave/frío  ->  +1 brillante/cálido.
  // energy: cuanta más, más saturado e intenso.
  const t = (dna.tilt + 1) / 2;            // 0..1
  const e = THREE.MathUtils.clamp(dna.energy, 0, 1);

  // Familia púrpura siempre — el ADN la desplaza dentro de la familia.
  const calm = new THREE.Color().setHSL(
    0.70 - t * 0.06,            // hue: grave azulado -> brillante lila
    0.35 + e * 0.25,            // saturación crece con la intensidad vivida
    0.16 + t * 0.10             // brillante = un punto más claro
  );
  const active = new THREE.Color().setHSL(
    0.72 - t * 0.10,
    0.55 + e * 0.30,
    0.45 + t * 0.12 + e * 0.05
  );
  bodyUniforms.uColorCalm.value.copy(calm);
  bodyUniforms.uColorActive.value.copy(active);
  bodyUniforms.uColorDeep.value.copy(calm).multiplyScalar(0.16);
  bodyUniforms.uCrisp.value = THREE.MathUtils.clamp(dna.density, 0, 1);
  coreMaterial.uniforms.uColor.value.copy(active).lerp(bodyUniforms.uColorRim.value, 0.34);
  auraMaterial.color.copy(active);
  beatRingMaterial.color.copy(bodyUniforms.uColorRim.value);
  modelMaterials.forEach((material) => {
    if (!material.emissive) return;
    material.emissive.copy(active).multiplyScalar(0.035);
    material.emissiveIntensity = 0.32;
  });
}
applyDNAtoBeing();

// ============================================================
// 8 · Estado emocional + nacimiento
// ============================================================

let arousal = 0;   // excitación, con inercia: "siente", no "reacciona"
let tension = 0;   // alerta
let pulse = 0;     // respingo del golpe
let bodyScale = 1; // escala global: se encoge en el silencio

let birth = 0.74;  // 0..1
let born = false;  // ¿ya nació?

// Parpadeo: un detalle barato que dispara mucha sensación de vida.
let blink = 0;             // 0 abierto .. 1 cerrado
let nextBlink = 2 + Math.random() * 4;

// Hacia dónde "mira" el ser: deriva sola, se aviva con la energía.
let gazeX = 0, gazeY = 0;
let gazeTargetX = 0, gazeTargetY = 0;
let gazeTimer = 0;

function updateSceneLayout() {
  const desktop = window.innerWidth >= 820;
  being.position.x = desktop ? 0.92 : 0;
  being.position.y = desktop ? 0.02 : -0.18;
  camera.position.z = desktop ? 4.15 : 4.65;
}
updateSceneLayout();

// ============================================================
// 9 · Bucle de vida
// ============================================================

const clock = new THREE.Clock();

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  updateAudioValues();
  if (modelMixer) modelMixer.update(dt);

  // --- Nacimiento: al primer audio real, el ser despierta ---
  if (!born && overallEnergy > 0.06) {
    born = true;
    setStatus("Tu ser ha despertado.");
  }
  if (born && birth < 1) {
    birth = Math.min(1, birth + dt * 0.4); // se despliega en ~2.5 s
  }

  // --- Estado emocional: todo con inercia. La inercia es lo que separa
  //     "parece sentir" de "reacciona como un medidor". ---
  arousal += (overallEnergy - arousal) * 0.045;
  const targetTension = THREE.MathUtils.clamp(highsEnergy * 1.4 + (onsetActive > 0 ? 0.3 : 0), 0, 1);
  tension += (targetTension - tension) * 0.06;
  if (onsetJustFired) pulse = 1;
  pulse *= 0.86; // el respingo decae

  // --- El silencio encoge al ser: postura de espera, casi dormido ---
  const silence = overallEnergy < 0.04;
  const targetScale = silence ? 0.72 : 0.92 + arousal * 0.35;
  bodyScale += (targetScale - bodyScale) * 0.05;
  being.scale.setScalar(bodyScale * (0.4 + birth * 0.6));

  if (loadingGlow.visible) {
    loadingGlow.rotation.y += dt * 0.6;
    loadingGlow.scale.setScalar(0.8 + modelLoadProgress * 0.34 + Math.sin(t * 2.2) * 0.03);
    loadingGlow.material.opacity = 0.1 + modelLoadProgress * 0.18;
  }

  if (proceduralFallbackActive) {
    // --- Volcado al shader ---
    bodyUniforms.uTime.value = t;
    bodyUniforms.uArousal.value = arousal;
    bodyUniforms.uTension.value = tension;
    bodyUniforms.uPulse.value = pulse;
    bodyUniforms.uBirth.value = birth;
    coreMaterial.uniforms.uTime.value = t;
    coreMaterial.uniforms.uArousal.value = arousal;
    coreMaterial.uniforms.uBirth.value = birth;

    // --- El cuerpo gira despacio sobre sí mismo: la piel viva se ve por
    //     todos lados. La cara NO gira: los ojos siempre te miran. ---
    body.rotation.y += dt * (0.15 + arousal * 0.5);
    body.rotation.x = Math.sin(t * 0.3) * 0.15;
    core.rotation.y -= dt * (0.08 + arousal * 0.26);
    core.rotation.x = Math.sin(t * 0.23) * 0.16;

    filamentGroup.rotation.y += dt * (0.08 + arousal * 0.22);
    filamentGroup.rotation.x = Math.sin(t * 0.18) * 0.08;
    filaments.forEach((ring, index) => {
      ring.rotation.z += dt * ring.userData.spin * (0.6 + arousal * 1.8);
      const flare = onsetActive > 0 ? 0.18 : 0;
      ring.scale.setScalar(1 + Math.sin(t * 0.7 + ring.userData.phase) * 0.018 + arousal * 0.08 + flare);
      ring.material.opacity = (index % 2 ? 0.11 : 0.17) + arousal * 0.12 + flare * 0.22;
    });
  }

  if (modelRoot) {
    const happyPulse = pulse * 0.1 + (onsetActive > 0 ? 0.035 : 0);
    const idleFloat = Math.sin(t * 1.18) * 0.055;
    modelPivot.position.y = idleFloat + arousal * 0.075;
    modelPivot.rotation.y = Math.sin(t * 0.36) * 0.22 + gazeX * 0.55;
    modelPivot.rotation.x = Math.sin(t * 0.42) * 0.06 + gazeY * 0.22;
    modelPivot.rotation.z = Math.sin(t * 0.28) * 0.035;
    modelPivot.scale.set(
      1 + happyPulse * 0.9,
      1 - happyPulse * 0.34,
      1 + happyPulse * 0.45
    );

    aura.scale.setScalar(0.98 + arousal * 0.2 + pulse * 0.12);
    aura.material.opacity = 0.055 + arousal * 0.08 + pulse * 0.05;
    beatRing.rotation.z += dt * (0.16 + arousal * 0.9);
    beatRing.scale.setScalar(1.0 + arousal * 0.16 + pulse * 0.34);
    beatRing.material.opacity = 0.08 + arousal * 0.12 + pulse * 0.18;
    sparkles.rotation.y -= dt * (0.035 + arousal * 0.16);
    sparkleMaterial.opacity = 0.015 + arousal * 0.1 + pulse * 0.06;
    modelMaterials.forEach((material) => {
      if (!material.emissive) return;
      material.emissiveIntensity = 0.22 + arousal * 0.45 + pulse * 0.22;
    });
  }

  // --- Mirada: deriva sola; con energía mira más lejos y más a menudo ---
  gazeTimer -= dt;
  if (gazeTimer <= 0) {
    const reach = 0.12 + arousal * 0.3;
    gazeTargetX = (Math.random() - 0.5) * 2 * reach;
    gazeTargetY = (Math.random() - 0.5) * 2 * reach;
    gazeTimer = silence ? 2 + Math.random() * 3 : 0.6 + Math.random() * 1.4;
  }
  gazeX += (gazeTargetX - gazeX) * 0.06;
  gazeY += (gazeTargetY - gazeY) * 0.06;
  // En silencio el ser baja la mirada: tímido, a la espera.
  const gazeDown = silence ? -0.18 : 0;
  face.rotation.y = gazeX;
  face.rotation.x = gazeY + gazeDown;

  // --- Parpadeo ---
  nextBlink -= dt;
  if (nextBlink <= 0 && blink === 0) blink = 1;
  if (blink > 0) {
    blink -= dt * 9; // parpadeo rápido
    if (blink <= 0) {
      blink = 0;
      nextBlink = 2 + Math.random() * 4;
    }
  }
  if (proceduralFallbackActive) {
    const eyeOpen = 1 - Math.max(0, Math.sin(blink * Math.PI));
    leftEye.scale.y = Math.max(0.06, eyeOpen);
    rightEye.scale.y = Math.max(0.06, eyeOpen);
    // Los ojos solo aparecen cuando el nacimiento está casi completo.
    const eyeVisible = THREE.MathUtils.clamp((birth - 0.65) / 0.35, 0, 1);
    leftEye.scale.x = rightEye.scale.x = eyeVisible;
    leftEye.scale.z = rightEye.scale.z = eyeVisible;
  }

  // --- El ADN se alimenta y, de vez en cuando, se guarda ---
  feedDNA(dt);
  applyDNAtoBeing();
  dnaSaveTimer += dt;
  if (dnaSaveTimer > 5) {
    dnaSaveTimer = 0;
    saveDNA();
    refreshBeingLine();
  }

  // --- Bloom: el ser brilla un poco más cuando se excita ---
  bloomPass.strength = 0.16 + arousal * 0.32;

  // --- Cámara: deriva mínima, mantiene al ser centrado ---
  camera.position.x = Math.sin(t * 0.2) * 0.05;
  camera.position.y = Math.cos(t * 0.17) * 0.05;
  camera.lookAt(0, 0, 0);

  composer.render();
  requestAnimationFrame(animate);
}

animate();

// ============================================================
// 10 · Resize
// ============================================================

window.addEventListener("resize", () => {
  updateSceneLayout();
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});
