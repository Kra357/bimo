"use strict";

// Начальные настройки левого и правого голоса.
const state = {
  a: {
    attack: 0.05,
    sustain: 0.6,
    release: 0.7,
    volume: 0.27,
    pan: -0.5,
    chorus: 0.25,
    delay: 0.2,
    wave: "sine",
  },
  b: {
    attack: 0.01,
    sustain: 0.5,
    release: 0.25,
    volume: 0.22,
    pan: 0.5,
    distortion: 0.15,
    filter: 1400,
    chorus: 0.1,
    delay: 0.08,
    wave: "triangle",
  },
  master: 0.7,
};
let engine = null,
  playing = false,
  generation = 0;
const active = { a: false, b: false },
  pending = { a: null, b: null };
const setStatus = (text) => {
  document.querySelector("#live").textContent = text;
};
// Изменение параметров синтезатора и эффектов.
function apply(voice, key, value) {
  state[voice][key] = value;
  if (!engine) return;
  const v = engine[voice];
  if (["attack", "sustain", "release"].includes(key)) v.synth.envelope[key] = value;
  else if (key === "wave") {
    v.synth.oscillator.type = value;
    if (value === "pulse") v.synth.oscillator.width.value = 0.35;
  } else if (key === "volume") v.gain.gain.rampTo(value, 0.04);
  else if (key === "pan") v.pan.pan.rampTo(value, 0.04);
  else if (key === "filter") v.filter.frequency.rampTo(value, 0.04);
  else if (key === "distortion") v.distortion.distortion = value;
  else v[key].wet.rampTo(value, 0.04);
}
// Подключение ползунков, уже размеченных в index.html.
function setupSlider(el) {
  const voice = el.dataset.voice;
  const key = el.dataset.param;
  el.value = state[voice][key];
  el.setAttribute("aria-label", `${voice === "a" ? "Star Melody" : "Bubble Bass"} ${key}`);
  el.title = el.getAttribute("aria-label");
  el.oninput = () => {
    apply(voice, key, +el.value);
    el.title = `${key}: ${(+el.value).toFixed(2)}`;
  };
}
document.querySelectorAll(".slider").forEach(setupSlider);

const waves = [];
const selectedWave = { a: null, b: null };
const defaultWave = { a: "sine", b: "triangle" };
// Выбор формы волны не запускает и не останавливает партию.
function setupWaveButton(el) {
  const voice = el.dataset.voice;
  const type = el.dataset.wave;
  el.addEventListener("click", () => {
    selectedWave[voice] = selectedWave[voice] === type ? null : type;
    apply(voice, "wave", selectedWave[voice] || defaultWave[voice]);
    syncButtons();
  });
  waves.push({ el, voice, type });
}
document.querySelectorAll(".wave").forEach(setupWaveButton);

// Круглые регуляторы: перетаскивание мышью или стрелки клавиатуры.
function setupKnob(el) {
  const voice = el.dataset.voice;
  const key = el.dataset.param;
  const update = (v) => {
    apply(voice, key, Math.max(0, Math.min(1, v)));
    el.style.setProperty("--angle", `${-135 + state[voice][key] * 270}deg`);
    el.setAttribute("aria-valuenow", Math.round(state[voice][key] * 100));
    el.title = `${key}: ${Math.round(state[voice][key] * 100)}%`;
  };
  let origin;
  el.onpointerdown = (e) => {
    origin = { y: e.clientY, v: state[voice][key] };
    el.setPointerCapture(e.pointerId);
  };
  el.onpointermove = (e) => {
    if (origin) update(origin.v + (origin.y - e.clientY) / 150);
  };
  el.onpointerup = el.onpointercancel = () => (origin = null);
  el.onkeydown = (e) => {
    if (["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      update(
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? 1
            : state[voice][key] + (["ArrowUp", "ArrowRight"].includes(e.key) ? 0.05 : -0.05),
      );
    }
  };
  update(state[voice][key]);
}
document.querySelectorAll(".knob").forEach(setupKnob);

// Кнопки уже находятся в HTML; здесь подключаем только их действия.
const playButton = document.querySelector("#launch-right");
const plusButton = document.querySelector("#launch-left");
const stopButton = document.querySelector("#stop-button");
playButton.addEventListener("click", () => toggleVoice("b"));
plusButton.addEventListener("click", () => toggleVoice("a"));
stopButton.addEventListener("click", stop);

// Подсветка отражает реальную активность голоса и выбранной формы волны.
function syncButtons() {
  playButton.setAttribute("aria-pressed", String(active.b));
  plusButton.setAttribute("aria-pressed", String(active.a));
  document.querySelector("#launch-left-art").classList.toggle("is-on", active.a);
  document.querySelector("#launch-right-art").classList.toggle("is-on", active.b);
  for (const { el, voice, type } of waves) {
    const on = selectedWave[voice] === type;
    el.setAttribute("aria-pressed", String(on));
    document.querySelector(`#wave-${voice}-${type}-art`).classList.toggle("is-on", on);
  }
}

function toggleVoice(voice) {
  if (active[voice] || pending[voice] !== null) stopVoice(voice);
  else startVoice(voice);
}

function stopVoice(voice) {
  pending[voice] = null;
  active[voice] = false;
  if (engine) {
    engine[voice].synth.triggerRelease();
    // Gain после эффектов гасит также хвосты Delay и Chorus только этой стороны.
    engine[voice].gain.gain.cancelScheduledValues(Tone.now());
    engine[voice].gain.gain.rampTo(0, 0.08);
  }
  if (!active.a && !active.b && pending.a === null && pending.b === null) stop();
  else {
    syncButtons();
    setStatus(active.a ? "Играет левый голос" : active.b ? "Играет правый голос" : "Запуск");
  }
}

// Создаём аудиоцепочки и музыкальные партии один раз.
function createEngine() {
  const master = new Tone.Gain(state.master);
  const gate = new Tone.Gain(0);
  const limiter = new Tone.Limiter(-3).toDestination();
  master.chain(gate, limiter);
  const a = {
    synth: new Tone.Synth({
      oscillator: { type: state.a.wave },
      envelope: {
        attack: state.a.attack,
        decay: 0.18,
        sustain: state.a.sustain,
        release: state.a.release,
      },
    }),
    chorus: new Tone.Chorus(2.4, 3, 0.45).start(),
    delay: new Tone.FeedbackDelay("8n", 0.25),
    gain: new Tone.Gain(state.a.volume),
    pan: new Tone.Panner(state.a.pan),
  };
  a.synth.chain(a.chorus, a.delay, a.gain, a.pan, master);
  const b = {
    synth: new Tone.Synth({
      oscillator: { type: state.b.wave },
      envelope: {
        attack: state.b.attack,
        decay: 0.12,
        sustain: state.b.sustain,
        release: state.b.release,
      },
    }),
    distortion: new Tone.Distortion(state.b.distortion),
    filter: new Tone.Filter(state.b.filter, "lowpass"),
    chorus: new Tone.Chorus(1.5, 2, 0.3).start(),
    delay: new Tone.FeedbackDelay("8n", 0.15),
    gain: new Tone.Gain(state.b.volume),
    pan: new Tone.Panner(state.b.pan),
  };
  b.synth.chain(b.distortion, b.filter, b.chorus, b.delay, b.gain, b.pan, master);
  const melody = [
    "C5",
    "E5",
    "G5",
    "B5",
    "A5",
    "G5",
    "E5",
    null,
    "D5",
    "E5",
    "G5",
    "A5",
    "G5",
    "E5",
    "D5",
    null,
  ];
  const bass = [
    "C2",
    null,
    "C2",
    "G2",
    "A1",
    null,
    "A1",
    "E2",
    "F1",
    null,
    "F2",
    "C2",
    "G1",
    null,
    "G2",
    "B1",
  ];
  const seqA = new Tone.Sequence(
    (time, note) => {
      if (active.a && note) a.synth.triggerAttackRelease(note, "8n", time, 0.7);
    },
    melody,
    "8n",
  ).start(0);
  const seqB = new Tone.Sequence(
    (time, note) => {
      if (active.b && note) b.synth.triggerAttackRelease(note, "16n", time, 0.8);
    },
    bass,
    "8n",
  ).start(0);
  Tone.Transport.bpm.value = 110;
  engine = { a, b, master, gate, limiter, seqA, seqB, player: null, recordingAttempted: false };
  for (const voice of ["a", "b"])
    for (const [key, value] of Object.entries(state[voice])) apply(voice, key, value);
  return engine;
}
async function loadRecording(e) {
  if (e.recordingAttempted) return;
  e.recordingAttempted = true;
  try {
    const response = await fetch("assets/bmo-voice.mp3", { method: "HEAD" });
    if (!response.ok) return;
    const player = new Tone.Player({ loop: true, volume: -18, fadeIn: 0.1, fadeOut: 0.15 }).connect(
      e.master,
    );
    await player.load("assets/bmo-voice.mp3");
    e.player = player;
  } catch (err) {
    console.info("Запись БМО не загружена; синтезаторы доступны.", err);
  }
}
// Запуск только выбранной стороны, без дублирования циклов.
async function startVoice(voice) {
  if (active[voice] || pending[voice] !== null) return;
  const epoch = generation;
  const token = Symbol("voice-start");
  pending[voice] = token;
  try {
    if (!window.Tone) throw new Error("Не загрузился vendor/Tone.js");
    await Tone.start();
    if (epoch !== generation || pending[voice] !== token) return;
    const e = engine || createEngine();
    active[voice] = true;
    e[voice].gain.gain.cancelScheduledValues(Tone.now());
    e[voice].gain.gain.rampTo(state[voice].volume, 0.04);
    if (!playing) {
      playing = true;
      e.gate.gain.cancelScheduledValues(Tone.now());
      e.gate.gain.rampTo(1, 0.04);
      Tone.Transport.start("+0.05", 0);
      if (e.player) e.player.start("+0.05");
      else
        loadRecording(e).then(() => {
          if (playing && engine === e && e.player && e.player.state !== "started") e.player.start();
        });
    }
    syncButtons();

    setStatus(
      active.a && active.b
        ? "Играют оба голоса"
        : active.a
          ? "Играет левый голос"
          : "Играет правый голос",
    );
  } catch (err) {
    setStatus(`Ошибка: ${err.message}`);
    console.error(err);
  } finally {
    if (pending[voice] === token) pending[voice] = null;
  }
}
// Общая остановка с плавным затуханием звука и эффектов.
function stop() {
  generation++;
  playing = false;
  active.a = false;
  active.b = false;
  pending.a = null;
  pending.b = null;

  syncButtons();
  if (engine) {
    Tone.Transport.stop();
    Tone.Transport.position = 0;
    const now = Tone.now();
    engine.a.synth.triggerRelease(now);
    engine.b.synth.triggerRelease(now);
    if (engine.player && engine.player.state === "started") engine.player.stop(now);
    engine.gate.gain.cancelScheduledValues(now);
    engine.gate.gain.rampTo(0, 0.25);
  }
  setStatus("Остановлено");
}
window.addEventListener("pagehide", () => {
  stop();
  if (engine) {
    engine.seqA.dispose();
    engine.seqB.dispose();
    for (const voice of ["a", "b"]) Object.values(engine[voice]).forEach((node) => node.dispose());
    engine.player?.dispose();
    engine.master.dispose();
    engine.gate.dispose();
    engine.limiter.dispose();
    engine = null;
  }
});
