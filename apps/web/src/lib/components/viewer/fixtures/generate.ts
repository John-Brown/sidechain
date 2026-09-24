/**
 * Deterministic synthetic data for the `/dev/viewer` fixture route.
 *
 * Ported from the Claude Design project's `timeline-data.js` (same seed, same
 * transcript, same hand-tuned intent/state overrides in the 42–72s review
 * window) so the dev fixture matches the design mockups pixel-for-pixel in
 * content, not just in layout. Every pipeline result is shaped exactly like
 * `@annotation/shared`'s result types — see `.claude/rules/data-contracts.md`.
 *
 * Everything here is pure and seeded: `createViewerFixture()` returns
 * bit-for-bit identical data on every call (see `generate.test.ts`).
 */

import type {
  AlgorithmInfo,
  AnnotationMetadata,
  AnnotationSetType,
  DiarizationResult,
  DiarizationSegment,
  EditType,
  FacialTrackingResult,
  FacialTrackingFrame,
  IntentAnnotation,
  IntentClassificationResult,
  IntentIntensity,
  IntentType,
  IntentValence,
  MeshKeyframe,
  MeshTopology,
  MouthEnergyResult,
  MouthEnergySegment,
  SpeechWord,
  StateAnnotation,
  StateAnnotationResult,
  StateCategory,
  TaskConstraints,
  TranscriptionResult,
  UserLabel,
  UserLabelResult,
  VadFrame,
  VadResult,
  VadSegment,
  WaveformPeaksResult,
} from '@annotation/shared';
import { withReview } from '../review.js';

// --- Fixture identity (matches timeline-screen.html's header/task chrome exactly) ---

export const DURATION = 252;
const FILENAME = 'interview_0417.mp4';
const PROJECT_NAME = 'Turn-taking pilot';
const VIDEO_ID = 'fixture-video';
const PROJECT_ID = 'fixture-project';
const SOURCE_FILE = `videos/${PROJECT_ID}/${VIDEO_ID}/${FILENAME}`;
/** Fixed instead of `new Date()` so the fixture is bit-for-bit reproducible. */
const CREATED_TIMESTAMP = '2026-03-14T12:00:00.000Z';
const REVIEWED_AT = '2026-03-14T15:22:00.000Z';

const SEED = 417;

// --- Deterministic RNG (ported verbatim from timeline-data.js) ---

function createRng(seed: number): () => number {
  let s = seed;
  return function next() {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap deterministic pseudo-noise in [0, 1), keyed by an arbitrary number (time, index, ...). */
function noise(x: number): number {
  const v = Math.sin(x * 12.9898) * 43758.5453;
  return v - Math.floor(v);
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

// --- Transcript synthesis (verbatim script + turn/word timing from timeline-data.js) ---

const SCRIPT = (
  'so when you first moved here what surprised you most honestly the quiet i expected the city ' +
  'to be loud all the time right and it just is not at night you can hear the river from our ' +
  'street that is lovely do you miss anything from home the food mostly my grandmother made this ' +
  'soup every sunday i have tried to make it maybe ten times and it never tastes the same mm ' +
  'maybe it is the pot she used that is exactly what my sister says she thinks the pot has ' +
  'memory have you asked your grandmother for the recipe i did she laughed and said there is no ' +
  'recipe you just watch and you learn so you watched every sunday for years and i still got it ' +
  'wrong that says something about memory i think yeah it is more about the hands than the words ' +
  'okay tell me about the first week here the first week was chaos we had no furniture we slept ' +
  'on the floor and ate noodles out of the pot did that bring you closer as a family oddly yes ' +
  'we talked more than we had in months no screens no wifi just boxes and each other what would ' +
  'you tell someone moving next month bring a pot and a good pillow'
).split(' ');

interface RawWord {
  start: number;
  end: number;
  text: string;
  speaker: number;
  conf: number;
}

interface RawTurn {
  start: number;
  end: number;
  speaker: number;
  words: RawWord[];
}

interface RawState {
  start: number;
  end: number;
  category: StateCategory;
  human?: boolean;
}

interface RawIntent {
  start: number;
  end: number;
  cat: IntentType;
  conf: number;
  speaker: number;
  idx: number;
  human?: boolean;
}

interface RawLabel {
  start: number;
  end: number;
  text: string;
}

interface Transcript {
  turns: RawTurn[];
  words: RawWord[];
  states: RawState[];
  intents: RawIntent[];
  labels: RawLabel[];
}

const INTENT_CATS: IntentType[] = [
  'engage',
  'inform',
  'inquire',
  'comfort',
  'inform',
  'engage',
  'inquire',
  'celebrate',
  'inform',
  'challenge',
];

/** Hand-tuned confidences for the task's review window, matching timeline-data.js exactly. */
const REVIEW_WINDOW_OVERRIDES: { cat: IntentType; conf: number; human?: boolean }[] = [
  { cat: 'engage', conf: 0.91 },
  { cat: 'inquire', conf: 0.54, human: false },
  { cat: 'inform', conf: 0.83, human: true },
  { cat: 'inquire', conf: 0.48 },
  { cat: 'comfort', conf: 0.72 },
  { cat: 'inform', conf: 0.57 },
  { cat: 'engage', conf: 0.88 },
];

function buildTranscript(): Transcript {
  const rng = createRng(SEED);
  const turns: RawTurn[] = [];
  const words: RawWord[] = [];
  let wi = 0;
  let t = 0.4;
  let spk = 0;

  while (t < DURATION - 1) {
    const len = spk === 0 ? 3 + rng() * 5 : 2 + rng() * 4.5;
    const end = Math.min(t + len, DURATION - 0.2);
    const turn: RawTurn = { start: t, end, speaker: spk, words: [] };
    let w = t;
    while (w < end - 0.15) {
      const d = 0.16 + rng() * 0.3;
      const we = Math.min(w + d, end);
      let conf = 0.72 + rng() * 0.27;
      if (rng() < 0.07) conf = 0.31 + rng() * 0.27;
      const word: RawWord = { start: w, end: we, text: SCRIPT[wi++ % SCRIPT.length], speaker: spk, conf: round(conf, 3) };
      words.push(word);
      turn.words.push(word);
      w = we + 0.02 + rng() * (rng() < 0.12 ? 0.35 : 0.09);
    }
    turn.end = Math.max(turn.words.length ? turn.words[turn.words.length - 1].end : end, t + 0.3);
    turns.push(turn);
    t = turn.end + 0.2 + rng() * 0.5;
    spk = spk === 0 ? 1 : 0;
  }

  // States: full coverage, midpoint-split between adjacent turns (tracked face = speaker 0).
  const states: RawState[] = turns.map((tr, i) => {
    const prev = turns[i - 1];
    const next = turns[i + 1];
    const s = prev ? (prev.end + tr.start) / 2 : 0;
    const e = next ? (tr.end + next.start) / 2 : DURATION;
    return {
      start: round(s, 3),
      end: round(e, 3),
      category: (tr.speaker === 0 ? 'expression.state.speaking' : 'expression.state.listening') as StateCategory,
    };
  });

  // Intents: one per turn, cycling through INTENT_CATS.
  const intents: RawIntent[] = turns.map((tr, i) => ({
    start: tr.start,
    end: tr.end,
    cat: INTENT_CATS[i % INTENT_CATS.length],
    conf: round(0.62 + rng() * 0.36, 3),
    speaker: tr.speaker,
    idx: i,
  }));

  // Hand-tuned slice inside the 42–72s review window (mutates the same objects in `intents`).
  const inWindow = intents.filter((x) => x.start >= 41 && x.start < 72);
  inWindow.forEach((x, i) => {
    const fixed = REVIEW_WINDOW_OVERRIDES[i];
    if (fixed) Object.assign(x, fixed);
  });

  const stateWindow = states.filter((x) => x.start >= 40 && x.start < 72);
  if (stateWindow[2]) stateWindow[2].human = true;

  // User labels: two hand-placed annotations, always human (no pipeline stage produces these).
  const labels: RawLabel[] = [];
  const laughTurn = turns.find((x) => x.start > 48);
  if (laughTurn) labels.push({ start: round(laughTurn.start + 0.6, 3), end: round(laughTurn.start + 1.5, 3), text: 'laugh' });
  const overlapTurn = turns.find((x) => x.start > 60);
  if (overlapTurn) labels.push({ start: round(overlapTurn.start - 0.4, 3), end: round(overlapTurn.start + 1.2, 3), text: 'overlap — check' });

  return { turns, words, states, intents, labels };
}

// --- Continuous signals (ported from timeline-data.js; drive VAD/waveform/mouth/head-pose) ---

function findWordAt(words: RawWord[], tm: number): RawWord | null {
  let lo = 0;
  let hi = words.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].end <= tm) lo = mid + 1;
    else if (words[mid].start > tm) hi = mid - 1;
    else return words[mid];
  }
  return null;
}

function findTurnAt(turns: RawTurn[], tm: number): RawTurn | null {
  for (const tr of turns) {
    if (tm >= tr.start && tm < tr.end) return tr;
    if (tr.start > tm) return null;
  }
  return null;
}

function amp(words: RawWord[], tm: number, ch: number): number {
  const w = findWordAt(words, tm);
  if (w && w.speaker === ch) {
    const p = (tm - w.start) / (w.end - w.start);
    const env = Math.sin(Math.PI * Math.max(0, Math.min(1, p)));
    return (0.3 + 0.65 * env) * (0.55 + 0.45 * noise(tm * 97.1 + ch));
  }
  return 0.03 + 0.05 * noise(tm * 53.3 + ch * 7);
}

function vadProbability(turns: RawTurn[], words: RawWord[], tm: number): number {
  const w = findWordAt(words, tm);
  if (w) return 0.86 + 0.12 * noise(tm * 31);
  const tr = findTurnAt(turns, tm);
  if (tr) return 0.45 + 0.25 * noise(tm * 17);
  return 0.03 + 0.1 * noise(tm * 11);
}

function mouthSignal(words: RawWord[], tm: number): number {
  const w = findWordAt(words, tm);
  if (w && w.speaker === 0) {
    const p = (tm - w.start) / (w.end - w.start);
    return 0.35 + 0.55 * Math.sin(Math.PI * Math.max(0, Math.min(1, p))) * (0.6 + 0.4 * noise(tm * 7));
  }
  return 0.06 + 0.08 * noise(tm * 5);
}

function poseSignal(tm: number, axis: 0 | 1 | 2): number {
  if (axis === 0) return 7 * Math.sin(0.7 * tm) + 3 * Math.sin(2.3 * tm + 1);
  if (axis === 1) return 14 * Math.sin(0.23 * tm + 1) + 5 * Math.sin(1.1 * tm);
  return 4 * Math.sin(0.4 * tm + 2) + 1.5 * Math.sin(1.7 * tm);
}

// --- Metadata helper ---

function makeMetadata(algorithm: AlgorithmInfo): AnnotationMetadata {
  return {
    source_file: SOURCE_FILE,
    format_version: '1.0',
    created_timestamp: CREATED_TIMESTAMP,
    total_secs: DURATION,
    algorithm,
  };
}

// --- VAD (workers/ml-pipeline/stages/vad.py: 512-sample windows @ 16kHz = 32ms hop, threshold 0.5) ---

const VAD_SAMPLE_RATE = 16000;
const VAD_WINDOW_MS = 32;
const VAD_THRESHOLD = 0.5;
const VAD_MERGE_GAP_SEC = 0.3;

function buildVad(turns: RawTurn[], words: RawWord[]): VadResult {
  const hop = VAD_WINDOW_MS / 1000;
  const frames: VadFrame[] = [];
  const n = Math.floor(DURATION / hop);
  for (let i = 0; i < n; i++) {
    const start = round(i * hop, 3);
    const end = round((i + 1) * hop, 3);
    const prob = round(vadProbability(turns, words, (start + end) / 2), 4);
    frames.push({ time_range: { start, end }, speech_probability: prob });
  }

  const segments: VadSegment[] = [];
  let run: VadFrame[] | null = null;
  const flush = () => {
    if (!run || run.length === 0) return;
    const confidence = round(run.reduce((s, f) => s + f.speech_probability, 0) / run.length, 3);
    segments.push({ time_range: { start: run[0].time_range.start, end: run[run.length - 1].time_range.end }, confidence });
    run = null;
  };
  for (const frame of frames) {
    const isSpeech = frame.speech_probability >= VAD_THRESHOLD;
    if (isSpeech) {
      if (run && frame.time_range.start - run[run.length - 1].time_range.end <= VAD_MERGE_GAP_SEC) {
        run.push(frame);
      } else {
        flush();
        run = [frame];
      }
    }
  }
  flush();

  const speechSecs = segments.reduce((s, seg) => s + (seg.time_range.end - seg.time_range.start), 0);

  return {
    metadata: {
      ...makeMetadata({ name: 'silero-vad-v5', version: '5.0', processing_time: 4.2 }),
      algorithm: {
        name: 'silero-vad-v5',
        version: '5.0',
        processing_time: 4.2,
        window_size_ms: VAD_WINDOW_MS,
        hop_size_ms: VAD_WINDOW_MS,
        sample_rate: VAD_SAMPLE_RATE,
        threshold: VAD_THRESHOLD,
      },
      total_segments: segments.length,
      speech_ratio: round(speechSecs / DURATION, 3),
    },
    segments,
    frames,
  };
}

// --- Waveform (workers/ml-pipeline/stages/waveform.py: 200 peaks/sec; stereo, one speaker per channel as in the design) ---

const PEAKS_PER_SECOND = 200;

function buildWaveform(words: RawWord[]): WaveformPeaksResult {
  const n = Math.floor(DURATION * PEAKS_PER_SECOND);
  const peaks_l: number[] = new Array(n);
  const peaks_r: number[] = new Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) {
    const tm = i / PEAKS_PER_SECOND;
    peaks_l[i] = round(amp(words, tm, 0), 4);
    peaks_r[i] = round(amp(words, tm, 1), 4);
    max = Math.max(max, peaks_l[i], peaks_r[i]);
  }
  return {
    metadata: makeMetadata({
      name: 'ffmpeg_peaks',
      version: '1.0',
      processing_time: 1.1,
      parameters: { peaks_per_second: PEAKS_PER_SECOND, audio_sample_rate: VAD_SAMPLE_RATE },
    }),
    peaks_l,
    peaks_r,
    sample_rate: PEAKS_PER_SECOND,
    max_peak: max || 1,
    duration: DURATION,
  };
}

// --- Transcription ---

function speakerLabel(n: number): string {
  return `SPEAKER_0${n}`;
}

function buildTranscription(turns: RawTurn[]): TranscriptionResult {
  const data: SpeechWord[] = [];
  turns.forEach((turn, turnIdx) => {
    for (const w of turn.words) {
      data.push({
        time_range: { start: round(w.start, 3), end: round(w.end, 3) },
        speech: { word: w.text, speaker: speakerLabel(w.speaker), confidence: w.conf, speech_segment: turnIdx },
      });
    }
  });
  return {
    metadata: makeMetadata({ name: 'whisperx', model: 'large-v3-turbo', version: '3.1.1', processing_time: 18.4 }),
    data,
  };
}

// --- Diarization ---

function buildDiarization(turns: RawTurn[]): DiarizationResult {
  const data: DiarizationSegment[] = turns.map((tr) => ({
    time_range: { start: round(tr.start, 3), end: round(tr.end, 3) },
    diarization: { speaker: speakerLabel(tr.speaker) },
  }));

  const bySpeaker = new Map<string, { total: number; count: number }>();
  for (const tr of turns) {
    const key = speakerLabel(tr.speaker);
    const entry = bySpeaker.get(key) ?? { total: 0, count: 0 };
    entry.total += tr.end - tr.start;
    entry.count += 1;
    bySpeaker.set(key, entry);
  }
  const speaker_timing_metadata: DiarizationResult['metadata']['speaker_timing_metadata'] = {};
  for (const [speaker, { total, count }] of bySpeaker) {
    speaker_timing_metadata[speaker] = {
      total_duration_secs: round(total, 2),
      turn_count: count,
      avg_turn_duration_secs: round(total / count, 2),
    };
  }

  return {
    metadata: {
      ...makeMetadata({ name: 'pyannote-speaker-diarization', version: '3.1', processing_time: 22.7 }),
      requested_speakers: null,
      detected_speakers: bySpeaker.size,
      visible_speaker_probability: { SPEAKER_00: 0.94, SPEAKER_01: 0.89 },
      visible_speaker_detection_status: 'detected',
      audio_channel_speaker_probability: {
        SPEAKER_00: { SPEAKER_00: 0.97, SPEAKER_01: 0.03 },
        SPEAKER_01: { SPEAKER_00: 0.04, SPEAKER_01: 0.96 },
      },
      audio_channel_detection_status: 'detected',
      speaker_timing_metadata,
    },
    data,
  };
}

// --- Facial tracking + mesh overlay ---
//
// The real pipeline (workers/ml-pipeline/stages/facial_tracking.py) runs MediaPipe
// FaceLandmarker on every video frame (~30fps) with 478 landmarks. For this fixture
// (no backing video, purely for exercising the head-pose canvas track and the
// state/intent tracks around it) we sample at 10Hz — the same rate as mesh keyframes
// and mouth energy — to keep the fixture small and fast to generate. If a real video
// is later wired into `/dev/viewer`, swap this for a fuller-fidelity generator; see
// integrationNotes.
const FACE_HZ = 10;
const BLEND_SHAPE_COUNT = 52; // matches BLEND_SHAPE_NAMES in facial_tracking.py
const JAW_OPEN_INDEX = 24; // index of "jawOpen" in BLEND_SHAPE_NAMES

/** Face-not-detected windows, to exercise that rendering path. */
const FACE_LOST_RANGES: [number, number][] = [
  [100, 102],
  [180, 181.5],
];

function faceDetectedAt(tm: number): boolean {
  return !FACE_LOST_RANGES.some(([s, e]) => tm >= s && tm < e);
}

/** A small, self-consistent face outline used for both `landmarks` and `mesh_keyframes.vertices`. */
function miniFaceLandmarks(tm: number, words: RawWord[]): [number, number, number][] {
  const jaw = mouthSignal(words, tm);
  const cx = 960 + poseSignal(tm, 1) * 2;
  const cy = 540 + poseSignal(tm, 0) * 2;
  const pts: [number, number, number][] = [];
  // 0-3: outline (top, right, bottom, left)
  pts.push([cx, cy - 120, 0]);
  pts.push([cx + 90, cy, 0]);
  pts.push([cx, cy + 120 + jaw * 20, 0]);
  pts.push([cx - 90, cy, 0]);
  // 4-15: interior ring (brows/cheeks/nose) — deterministic jitter per point index
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const jitter = 2 * noise(tm * 3 + i);
    pts.push([cx + Math.cos(angle) * (50 + jitter), cy + Math.sin(angle) * (60 + jitter), 0.5 * noise(tm + i)]);
  }
  // 16-19: iris pairs (left eye, right eye)
  pts.push([cx - 35, cy - 25, 0]);
  pts.push([cx - 25, cy - 25, 0]);
  pts.push([cx + 25, cy - 25, 0]);
  pts.push([cx + 35, cy - 25, 0]);
  return pts.map(([x, y, z]) => [round(x, 1), round(y, 1), round(z, 3)]);
}

const MESH_TOPOLOGY: MeshTopology = {
  tessellation: Array.from({ length: 12 }, (_, i) => [4 + i, 4 + ((i + 1) % 12)]),
  contours: [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
  ],
  irises: [
    [16, 17],
    [18, 19],
  ],
};

function buildFacialTracking(words: RawWord[]): FacialTrackingResult {
  const step = 1 / FACE_HZ;
  const n = Math.floor(DURATION / step);
  const data: FacialTrackingFrame[] = [];
  const mesh_keyframes: MeshKeyframe[] = [];

  for (let i = 0; i < n; i++) {
    const tm = round(i * step, 3);
    const detected = faceDetectedAt(tm);
    const landmarks = miniFaceLandmarks(tm, words);
    const blendshapes = new Array(BLEND_SHAPE_COUNT).fill(0);
    blendshapes[JAW_OPEN_INDEX] = round(mouthSignal(words, tm), 3);

    data.push({
      time: tm,
      facial_tracking: {
        tracking: {
          blendshapes,
          head_pose: {
            rotation: [round(poseSignal(tm, 0), 2), round(poseSignal(tm, 1), 2), round(poseSignal(tm, 2), 2)],
            translation: [round(2 * noise(tm * 2), 2), round(2 * noise(tm * 2 + 1), 2), 0],
          },
          gaze_direction: [round(0.3 * noise(tm * 4), 3), round(0.3 * noise(tm * 4 + 1), 3), round(0.9 + 0.1 * noise(tm * 4 + 2), 3)],
          landmarks,
          confidence: detected ? round(0.85 + 0.14 * noise(tm * 6), 3) : 0,
          face_detected: detected,
        },
      },
    });

    mesh_keyframes.push({
      time: tm,
      vertices: landmarks,
      depth: landmarks.map((_, idx) => round(0.8 + 1.2 * noise(tm * 5 + idx), 3)),
      face_detected: detected,
    });
  }

  return {
    metadata: {
      ...makeMetadata({ name: 'mediapipe-face-landmarker', version: '0.10', processing_time: 61.3 }),
      video_width: 1920,
      video_height: 1080,
      mesh_topology: MESH_TOPOLOGY,
      depth_estimation: { model: 'depth-anything-v2', encoder: 'vitb', sample_rate_hz: FACE_HZ },
    },
    data,
    mesh_keyframes,
  };
}

// --- Mouth energy (workers/ml-pipeline/stages/mouth_energy.py: 10Hz windows) ---

function buildMouthEnergy(words: RawWord[]): MouthEnergyResult {
  const step = 1 / FACE_HZ;
  const n = Math.floor(DURATION / step);
  const data: MouthEnergySegment[] = [];
  for (let i = 0; i < n; i++) {
    const start = round(i * step, 3);
    const end = round((i + 1) * step, 3);
    const tm = (start + end) / 2;
    const energy = round(mouthSignal(words, tm), 3);
    data.push({
      time_range: { start, end },
      mouth_energy: {
        blend_shape_energy: {
          jawOpen: { raw_value: energy, deviation: round(0.1 * noise(tm * 9), 3) },
          mouthSmileLeft: { raw_value: round(0.2 * noise(tm * 13), 3), deviation: round(0.05 * noise(tm * 13 + 1), 3) },
        },
        mouth_energy: energy,
      },
    });
  }
  return { metadata: makeMetadata({ name: 'blend-shape-energy', version: '1.0', processing_time: 2.8 }), data };
}

// --- State annotation (contiguous, full coverage) ---

function buildStateAnnotation(states: RawState[]): StateAnnotationResult {
  const data: StateAnnotation[] = states.map((s) => {
    const item: StateAnnotation = {
      time_range: { start: s.start, end: s.end },
      category: s.category,
      note: '',
      parameters: {},
    };
    return s.human ? withReview(item, { confirmed: true, at: REVIEWED_AT }) : item;
  });
  return { metadata: makeMetadata({ name: 'rule-based-state', version: '1.0', processing_time: 0.4 }), data };
}

// --- Intent classification ---

const VALENCE_BY_CAT: Record<IntentType, IntentValence> = {
  engage: 'positive',
  celebrate: 'positive',
  comfort: 'positive',
  inform: 'neutral',
  inquire: 'neutral',
  challenge: 'negative',
};

function intensityFor(conf: number): IntentIntensity {
  if (conf >= 0.8) return 'high';
  if (conf >= 0.6) return 'moderate';
  return 'low';
}

function reasoningFor(cat: IntentType, conf: number, speaker: number): string {
  return `Turn by speaker ${speaker}: word choice and prosody signal "${cat}" (model confidence ${conf.toFixed(2)}).`;
}

function buildIntentClassification(intents: RawIntent[]): IntentClassificationResult {
  const data: IntentAnnotation[] = intents.map((it) => {
    const item: IntentAnnotation = {
      time_range: { start: round(it.start, 3), end: round(it.end, 3) },
      intent_classification: {
        intent: it.cat,
        intensity: intensityFor(it.conf),
        valence: VALENCE_BY_CAT[it.cat],
        confidence: it.conf,
        reasoning: reasoningFor(it.cat, it.conf, it.speaker),
      },
    };
    return it.human ? withReview(item, { confirmed: true, at: REVIEWED_AT }) : item;
  });
  return {
    metadata: makeMetadata({ name: 'claude-intent-classifier', model: 'claude-sonnet-5', version: '1.0', processing_time: 9.6 }),
    data,
  };
}

// --- User labels (human-only, no pipeline stage) ---

function buildUserLabels(labels: RawLabel[]): UserLabelResult {
  const data: UserLabel[] = labels.map((l) => ({ time_range: { start: l.start, end: l.end }, text: l.text }));
  return {
    metadata: makeMetadata({ name: 'human', model: 'manual', version: '1.0', processing_time: 0 }),
    data,
  };
}

// --- Public fixture shape ---

/** Mirrors `AnnotationDataState`'s field names 1:1 so the integrator can assign each field directly. */
export interface ViewerFixtureData {
  vad: VadResult;
  transcription: TranscriptionResult;
  diarization: DiarizationResult;
  facialTracking: FacialTrackingResult;
  mouthEnergy: MouthEnergyResult;
  stateAnnotation: StateAnnotationResult;
  intentClassification: IntentClassificationResult;
  backchannel: null;
  userLabels: UserLabelResult;
  waveform: WaveformPeaksResult;
}

export interface ViewerFixtureTask {
  id: string;
  title: string;
  type: 'verify_intents';
  constraints: TaskConstraints;
  assignedBy: string;
  dueDate: string;
  brief: string;
  /** Reviewer feedback from a previous return (TaskInfo.reviewNotes) */
  feedback?: string;
  /** When the task was returned with that feedback */
  feedbackAt?: string;
}

export interface ViewerFixture {
  /** Mode the viewer starts in: 'edit' enters edit mode, 'task' activates `task` */
  mode: 'view' | 'edit' | 'task';
  duration: number;
  /** No synthetic video file ships with this fixture; the video element has nothing to play. */
  videoSrc?: string;
  filename: string;
  projectName: string;
  data: ViewerFixtureData;
  task?: ViewerFixtureTask;
}

/** Locked ranges from the design's task mode ("2 locked ranges 00:42.0–00:44.8 · 01:04.2–01:06.0"). */
const TASK_LOCKED_RANGES = [
  { start: 42.0, end: 44.8 },
  { start: 64.2, end: 66.0 },
];

function buildTask(): ViewerFixtureTask {
  const editableTypes: AnnotationSetType[] = ['intent'];
  // 'confirm' is a concurrent addition to packages/shared's EditType union (see integrationNotes);
  // the cast keeps this file buildable regardless of which lands first.
  const allowedOperations = ['confirm', 'classify', 'resize'] as EditType[];
  const constraints: TaskConstraints = {
    editableTypes,
    allowedOperations,
    lockedTimeRanges: TASK_LOCKED_RANGES,
  };
  return {
    id: 'T-0192',
    title: 'Verify intents',
    type: 'verify_intents',
    constraints,
    assignedBy: 'M. Okafor',
    dueDate: '2026-09-26',
    brief: "Confirm or correct every intent. Pay attention to inquire vs inform on rising-pitch statements. Don't touch locked ranges.",
    feedback: 'Several inquire labels between 00:50 and 01:05 are statements with rising intonation. Recheck those against the transcript.',
    feedbackAt: '2026-09-22',
  };
}

export interface CreateViewerFixtureOptions {
  mode?: 'view' | 'edit' | 'task';
}

/**
 * Build the full `/dev/viewer` fixture: deterministic pipeline-shaped data for
 * every annotation track, plus (in task mode) the verify-intents task from the
 * design mockup. Same seed every call — see `generate.test.ts` for the
 * determinism check.
 */
export function createViewerFixture(opts: CreateViewerFixtureOptions = {}): ViewerFixture {
  const { turns, words, states, intents, labels } = buildTranscript();

  const data: ViewerFixtureData = {
    vad: buildVad(turns, words),
    transcription: buildTranscription(turns),
    diarization: buildDiarization(turns),
    facialTracking: buildFacialTracking(words),
    mouthEnergy: buildMouthEnergy(words),
    stateAnnotation: buildStateAnnotation(states),
    intentClassification: buildIntentClassification(intents),
    backchannel: null,
    userLabels: buildUserLabels(labels),
    waveform: buildWaveform(words),
  };

  return {
    mode: opts.mode ?? 'view',
    duration: DURATION,
    filename: FILENAME,
    projectName: PROJECT_NAME,
    data,
    task: opts.mode === 'task' ? buildTask() : undefined,
  };
}
