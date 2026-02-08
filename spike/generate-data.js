#!/usr/bin/env node
/**
 * Generates synthetic Sidechain-format test data for the Phase 0 de-risk spike.
 * Produces: voice_activity.json, speech_transcription.json, annotations.json, diarization.json
 *
 * Usage: node generate-data.js [duration_secs]
 */

const fs = require('fs');
const path = require('path');

const DURATION = parseFloat(process.argv[2]) || 120; // 2 minutes default
const OUTPUT_DIR = path.join(__dirname, 'data');
const NOW = new Date().toISOString();

function makeMetadata(algorithm) {
  return {
    source_file: 'test_video.mp4',
    format_version: '1.0',
    created_timestamp: NOW,
    total_secs: DURATION,
    algorithm,
  };
}

// --- VAD: 10Hz windows, speech probability + energy ---
function generateVAD() {
  const data = [];
  const windowSec = 0.1;
  const numWindows = Math.floor(DURATION / windowSec);

  // Create speech regions (roughly 60% speech)
  const speechRegions = [];
  let t = 0.5 + Math.random() * 2;
  while (t < DURATION - 2) {
    const dur = 1 + Math.random() * 8;
    speechRegions.push({ start: t, end: Math.min(t + dur, DURATION) });
    t += dur + 0.3 + Math.random() * 3;
  }

  for (let i = 0; i < numWindows; i++) {
    const start = +(i * windowSec).toFixed(3);
    const end = +((i + 1) * windowSec).toFixed(3);
    const mid = (start + end) / 2;

    const inSpeech = speechRegions.some(r => mid >= r.start && mid < r.end);
    const baseProbability = inSpeech ? 0.7 + Math.random() * 0.3 : Math.random() * 0.15;
    const baseEnergy = inSpeech ? -30 + Math.random() * 15 : -60 + Math.random() * 15;

    data.push({
      time_range: { start, end },
      voice_activity: {
        speech_probability: +baseProbability.toFixed(3),
        energy_dbfs: +baseEnergy.toFixed(1),
        energy_dbfs_left: +(baseEnergy + (Math.random() - 0.5) * 4).toFixed(1),
        energy_dbfs_right: +(baseEnergy + (Math.random() - 0.5) * 4).toFixed(1),
      },
    });
  }

  return {
    metadata: makeMetadata({
      name: 'voice_activity_detection',
      model: 'silero-vad-v3.1',
      window_size_ms: 100,
      hop_size_ms: 100,
      sample_rate: 16000,
      threshold: 0.5,
      processing_time: 12.3,
    }),
    data,
    _speechRegions: speechRegions, // internal, stripped before save
  };
}

// --- Speech Transcription: word-level with speakers ---
function generateTranscription(speechRegions) {
  const words = [
    'so', 'yeah', 'I', 'think', 'that', 'the', 'main', 'thing', 'is',
    'we', 'need', 'to', 'figure', 'out', 'how', 'this', 'works',
    'right', 'okay', 'um', 'like', 'actually', 'well', 'basically',
    'interesting', 'sure', 'absolutely', 'probably', 'maybe', 'definitely',
    'because', 'when', 'you', 'look', 'at', 'it', 'from', 'that',
    'perspective', 'makes', 'sense', 'agree', 'but', 'what', 'about',
    'the', 'other', 'option', 'could', 'also', 'try', 'something',
    'different', 'let', 'me', 'explain', 'here', 'point',
  ];

  const data = [];
  let segmentIdx = 0;

  for (const region of speechRegions) {
    const speaker = Math.random() > 0.5 ? 'SPEAKER_00' : 'SPEAKER_01';
    let t = region.start;
    while (t < region.end - 0.15) {
      const word = words[Math.floor(Math.random() * words.length)];
      const wordDur = 0.1 + Math.random() * 0.4;
      const end = Math.min(t + wordDur, region.end);

      data.push({
        time_range: { start: +t.toFixed(3), end: +end.toFixed(3) },
        speech: {
          word,
          speaker,
          confidence: +(0.7 + Math.random() * 0.3).toFixed(2),
          speech_segment: segmentIdx,
        },
      });

      t = end + 0.02 + Math.random() * 0.08;
    }
    segmentIdx++;
  }

  return {
    metadata: makeMetadata({
      name: 'speech_transcription',
      model: 'openai-whisper-large-v3',
      language: 'en',
      word_timestamps: true,
      temperature: 0.0,
      processing_time: 95.1,
      parameters: { audio_duration: DURATION, speaker_count: 2 },
    }),
    data,
  };
}

// --- Diarization: speaker segments ---
function generateDiarization(speechRegions) {
  const data = [];
  for (const region of speechRegions) {
    // Split some regions into speaker turns
    const numTurns = 1 + Math.floor(Math.random() * 3);
    const turnDur = (region.end - region.start) / numTurns;
    let speaker = Math.random() > 0.5 ? 'SPEAKER_00' : 'SPEAKER_01';

    for (let i = 0; i < numTurns; i++) {
      const start = +(region.start + i * turnDur).toFixed(3);
      const end = +(region.start + (i + 1) * turnDur).toFixed(3);
      data.push({
        time_range: { start, end },
        diarization: { speaker },
      });
      speaker = speaker === 'SPEAKER_00' ? 'SPEAKER_01' : 'SPEAKER_00';
    }
  }

  return {
    metadata: {
      ...makeMetadata({
        name: 'speaker_diarization',
        model: 'pyannote/speaker-diarization-community-1',
        processing_time: 182.5,
        parameters: { speaker_count: 2 },
      }),
      requested_speakers: null,
      detected_speakers: 2,
      visible_speaker_probability: { SPEAKER_00: 0.92, SPEAKER_01: null },
      visible_speaker_detection_status: 'SUCCESS',
      speaker_timing_metadata: {
        SPEAKER_00: { total_duration_secs: DURATION * 0.35, turn_count: 15, avg_turn_duration_secs: 2.8 },
        SPEAKER_01: { total_duration_secs: DURATION * 0.25, turn_count: 12, avg_turn_duration_secs: 2.5 },
      },
    },
    data,
  };
}

// --- State Annotations: speaking/listening ---
function generateAnnotations(diarizationData) {
  const data = [];
  for (const seg of diarizationData) {
    const speaker = seg.diarization.speaker;
    const isVisible = speaker === 'SPEAKER_00';
    data.push({
      time_range: { ...seg.time_range },
      category: 'expression.state.speaking',
      note: `${isVisible ? 'Visible speaker' : 'Speaker'} ${speaker}`,
      parameters: {},
    });
  }

  // Fill gaps with listening states
  const sorted = [...data].sort((a, b) => a.time_range.start - b.time_range.start);
  const withGaps = [];
  let lastEnd = 0;
  for (const ann of sorted) {
    if (ann.time_range.start - lastEnd > 0.15) {
      withGaps.push({
        time_range: { start: +lastEnd.toFixed(3), end: +ann.time_range.start.toFixed(3) },
        category: 'expression.state.listening',
        note: 'Silence / listening',
        parameters: {},
      });
    }
    withGaps.push(ann);
    lastEnd = ann.time_range.end;
  }
  if (DURATION - lastEnd > 0.15) {
    withGaps.push({
      time_range: { start: +lastEnd.toFixed(3), end: +DURATION.toFixed(3) },
      category: 'expression.state.listening',
      note: 'Silence / listening',
      parameters: {},
    });
  }

  return {
    metadata: makeMetadata({
      name: 'state_annotation_generator',
      version: '1.0',
      source_algorithm: 'speaker_diarization',
      processing_time: 0.02,
    }),
    data: withGaps,
  };
}

// --- Intent Classifications ---
function generateIntents(annotations) {
  const intents = ['engage', 'inform', 'inquire', 'challenge', 'comfort', 'celebrate'];
  const intensities = ['low', 'moderate', 'high'];
  const valences = ['positive', 'neutral', 'negative'];

  const speakingStates = annotations.data.filter(a => a.category === 'expression.state.speaking');
  const data = speakingStates.map(state => ({
    time_range: { ...state.time_range },
    intent_classification: {
      intent: intents[Math.floor(Math.random() * intents.length)],
      intensity: intensities[Math.floor(Math.random() * intensities.length)],
      valence: valences[Math.floor(Math.random() * valences.length)],
      confidence: +(0.6 + Math.random() * 0.4).toFixed(2),
      reasoning: 'Synthetic test data',
    },
  }));

  return {
    metadata: makeMetadata({
      name: 'intent_classification',
      model: 'claude-3-5-sonnet',
      temperature: 0.3,
      max_context_chunks: 10,
      max_concurrent_requests: 20,
      processing_time: 35.7,
    }),
    data,
  };
}

// --- Generate all ---
const vad = generateVAD();
const speechRegions = vad._speechRegions;
delete vad._speechRegions;

const transcription = generateTranscription(speechRegions);
const diarization = generateDiarization(speechRegions);
const annotations = generateAnnotations(diarization.data);
const intents = generateIntents(annotations);

const files = {
  'voice_activity.json': vad,
  'speech_transcription.json': transcription,
  'diarization.json': diarization,
  'annotations.json': annotations,
  'intent_classification_annotations.json': intents,
};

for (const [name, content] of Object.entries(files)) {
  const filePath = path.join(OUTPUT_DIR, name);
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
  console.log(`Wrote ${name}: ${content.data.length} entries`);
}

console.log(`\nGenerated ${DURATION}s of synthetic data in ${OUTPUT_DIR}/`);
