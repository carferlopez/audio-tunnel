import "./style.css";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

// ------------------------------------------------------
// DOM
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

// Build missing player controls from JS so the prototype keeps working
// even if the HTML is still the older version.
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
// Audio setup
// ------------------------------------------------------

let audioContext;
let analyser;
let source;
let frequencyData;

let bassEnergy = 0;
let midsEnergy = 0;
let highsEnergy = 0;
let overallEnergy = 0;

function averageRange(data, start, end) {
  let sum = 0;
  const safeEnd = Math.min(end, data.length);

  for (let i = start; i < safeEnd; i++) {
    sum += data[i];
  }

  return sum / Math.max(1, safeEnd - start) / 255;
}

function setupAudioAnalyzer() {
  if (audioContext) return;

  audioContext = new AudioContext();
  analyser = audioContext.createAnalyser();

  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.82;

  frequencyData = new Uint8Array(analyser.frequencyBinCount);

  source = audioContext.createMediaElementSource(audio);
  source.connect(analyser);
  analyser.connect(audioContext.destination);
}

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

    if (fileNameLabel) {
      fileNameLabel.textContent = file.name;
    }

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
    setupAudioAnalyzer();

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    if (audio.paused) {
      await audio.play();
      playButton.textContent = "Pause";
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
// Scene setup
// ------------------------------------------------------

const scene = new THREE.Scene();
scene.background = new THREE.Color("#020207");
scene.fog = new THREE.Fog("#020207", 8, 42);

const camera = new THREE.PerspectiveCamera(
  78,
  window.innerWidth / window.innerHeight,
  0.1,
  120
);

camera.position.set(0, 0, 4.6);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
});

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;

document.body.appendChild(renderer.domElement);

// ------------------------------------------------------
// Soft postprocessing bloom
// ------------------------------------------------------

const composer = new EffectComposer(renderer);

const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.28,
  0.38,
  0.24
);

composer.addPass(bloomPass);

// ------------------------------------------------------
// Lights
// ------------------------------------------------------

const ambientLight = new THREE.AmbientLight("#ffffff", 0.22);
scene.add(ambientLight);

const pointLight = new THREE.PointLight("#8b5cf6", 10, 40);
pointLight.position.set(0, 0, 3);
scene.add(pointLight);

const rearLight = new THREE.PointLight("#22d3ee", 7, 58);
rearLight.position.set(0, 0, -18);
scene.add(rearLight);

// ------------------------------------------------------
// Tunnel rings
// ------------------------------------------------------

const tunnelGroup = new THREE.Group();
scene.add(tunnelGroup);

const tunnelSegments = [];
const segmentCount = 42;
const segmentSpacing = 1.08;

const ringGeometry = new THREE.TorusGeometry(3, 0.04, 16, 128);

for (let i = 0; i < segmentCount; i++) {
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color().setHSL(0.68 + i * 0.006, 0.9, 0.54),
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });

  const ring = new THREE.Mesh(ringGeometry, material);

  ring.position.z = -i * segmentSpacing;
  ring.rotation.z = i * 0.21;

  tunnelGroup.add(ring);
  tunnelSegments.push(ring);
}

// ------------------------------------------------------
// Inner spiral lines
// ------------------------------------------------------

const spiralGroup = new THREE.Group();
scene.add(spiralGroup);

const spiralLines = [];
const spiralCount = 8;
const pointsPerSpiral = 260;
const spiralLength = segmentCount * segmentSpacing;

for (let s = 0; s < spiralCount; s++) {
  const points = [];

  for (let i = 0; i < pointsPerSpiral; i++) {
    const t = i / pointsPerSpiral;
    const angle = t * Math.PI * 18 + s * ((Math.PI * 2) / spiralCount);
    const radius = 2.85 + Math.sin(t * Math.PI * 10) * 0.08;
    const z = -t * spiralLength;

    points.push(
      new THREE.Vector3(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        z
      )
    );
  }

  const geometry = new THREE.BufferGeometry().setFromPoints(points);

  const material = new THREE.LineBasicMaterial({
    color: new THREE.Color().setHSL(0.52 + s * 0.035, 0.88, 0.56),
    transparent: true,
    opacity: 0.3,
  });

  const line = new THREE.Line(geometry, material);
  spiralGroup.add(line);
  spiralLines.push(line);
}

// ------------------------------------------------------
// Particles
// ------------------------------------------------------

const particleCount = 1500;
const particleGeometry = new THREE.BufferGeometry();
const particlePositions = new Float32Array(particleCount * 3);

for (let i = 0; i < particleCount; i++) {
  const radius = 1.2 + Math.random() * 2.8;
  const angle = Math.random() * Math.PI * 2;
  const z = -Math.random() * spiralLength;

  particlePositions[i * 3] = Math.cos(angle) * radius;
  particlePositions[i * 3 + 1] = Math.sin(angle) * radius;
  particlePositions[i * 3 + 2] = z;
}

particleGeometry.setAttribute(
  "position",
  new THREE.BufferAttribute(particlePositions, 3)
);

const particleMaterial = new THREE.PointsMaterial({
  color: "#eef2ff",
  size: 0.017,
  transparent: true,
  opacity: 0.46,
  depthWrite: false,
});

const particles = new THREE.Points(particleGeometry, particleMaterial);
scene.add(particles);

// ------------------------------------------------------
// Audio values
// ------------------------------------------------------

function updateAudioValues() {
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
}

// ------------------------------------------------------
// Animation
// ------------------------------------------------------

const clock = new THREE.Clock();

function animate() {
  const elapsedTime = clock.getElapsedTime();

  updateAudioValues();

  const speed = 0.032 + overallEnergy * 0.18;
  const bassPulse = bassEnergy * 0.42;
  const midsTwist = midsEnergy * 0.018;
  const highSparkle = highsEnergy * 0.048;

  tunnelSegments.forEach((ring, index) => {
    ring.position.z += speed;

    if (ring.position.z > 4.5) {
      ring.position.z = -segmentCount * segmentSpacing;
    }

    ring.rotation.z += 0.004 + index * 0.00008 + midsTwist;

    const organicWave = Math.sin(elapsedTime * 2.4 + index * 0.5) * 0.035;
    const bassWave = Math.sin(elapsedTime * 8 + index * 0.18) * bassEnergy * 0.08;

    ring.scale.setScalar(1 + organicWave + bassPulse + bassWave);

    const hue = 0.57 + midsEnergy * 0.28 + index * 0.0035;
    const lightness = 0.4 + bassEnergy * 0.22 + highsEnergy * 0.1;

    ring.material.color.setHSL(hue % 1, 0.88, lightness);
    ring.material.opacity = 0.42 + overallEnergy * 0.34;
  });

  spiralGroup.rotation.z += 0.0025 + midsEnergy * 0.018;

  spiralLines.forEach((line, index) => {
    line.position.z += speed * 0.95;

    if (line.position.z > spiralLength) {
      line.position.z = 0;
    }

    const hue = 0.48 + midsEnergy * 0.28 + index * 0.022;
    line.material.color.setHSL(hue % 1, 0.88, 0.5 + highsEnergy * 0.16);
    line.material.opacity = 0.16 + overallEnergy * 0.28;
  });

  const positions = particles.geometry.attributes.position.array;

  for (let i = 0; i < particleCount; i++) {
    positions[i * 3 + 2] += speed * (1.2 + highsEnergy * 3.6);

    if (positions[i * 3 + 2] > 4.5) {
      positions[i * 3 + 2] = -spiralLength;
    }
  }

  particles.geometry.attributes.position.needsUpdate = true;

  particleMaterial.size = 0.012 + highSparkle;
  particleMaterial.opacity = 0.26 + highsEnergy * 0.48;

  pointLight.intensity = 5 + overallEnergy * 20;
  pointLight.color.setHSL(0.6 + midsEnergy * 0.2, 0.9, 0.55);

  rearLight.intensity = 4 + bassEnergy * 18;
  rearLight.color.setHSL(0.48 + midsEnergy * 0.22, 0.88, 0.5);

  bloomPass.strength = 0.18 + overallEnergy * 0.55;
  bloomPass.radius = 0.22 + bassEnergy * 0.26;
  bloomPass.threshold = 0.24 + highsEnergy * 0.08;

  renderer.toneMappingExposure = 0.96 + overallEnergy * 0.32;

  camera.position.x = Math.sin(elapsedTime * 0.55) * (0.08 + midsEnergy * 0.28);
  camera.position.y = Math.cos(elapsedTime * 0.42) * (0.08 + midsEnergy * 0.28);

  const cameraShake = bassEnergy * 0.035;
  camera.position.x += Math.sin(elapsedTime * 34) * cameraShake;
  camera.position.y += Math.cos(elapsedTime * 28) * cameraShake;

  camera.lookAt(0, 0, -9);

  composer.render();
  requestAnimationFrame(animate);
}

animate();

// ------------------------------------------------------
// Resize handling
// ------------------------------------------------------

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});