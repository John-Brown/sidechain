import { describe, it, expect } from 'vitest';
import { createViewerFixture, DURATION } from './generate.js';
import { isLowConfidence, isHumanReviewed } from '../review.js';

const CONTIGUITY_TOLERANCE = 1e-6;

describe('createViewerFixture — determinism', () => {
  it('produces bit-for-bit identical output across calls (view mode)', () => {
    const a = createViewerFixture();
    const b = createViewerFixture();
    expect(a).toEqual(b);
  });

  it('produces bit-for-bit identical annotation data regardless of mode', () => {
    const view = createViewerFixture({ mode: 'view' });
    const edit = createViewerFixture({ mode: 'edit' });
    const task = createViewerFixture({ mode: 'task' });
    expect(edit.data).toEqual(view.data);
    expect(task.data).toEqual(view.data);
  });

  it('duration is 252s', () => {
    expect(createViewerFixture().duration).toBe(252);
    expect(DURATION).toBe(252);
  });
});

describe('createViewerFixture — result shapes', () => {
  const fixture = createViewerFixture();

  it('VadResult has segments and frames with the real stage rate (32ms hop)', () => {
    const { vad } = fixture.data;
    expect(vad.segments.length).toBeGreaterThan(0);
    expect(vad.frames.length).toBeGreaterThan(0);
    const f = vad.frames[0];
    expect(f.time_range.end - f.time_range.start).toBeCloseTo(0.032, 3);
    expect(f.speech_probability).toBeGreaterThanOrEqual(0);
    expect(f.speech_probability).toBeLessThanOrEqual(1);
    expect(vad.metadata.algorithm.sample_rate).toBe(16000);
    expect(vad.metadata.algorithm.threshold).toBe(0.5);
  });

  it('WaveformPeaksResult is the flat shape at 200 peaks/sec', () => {
    const { waveform } = fixture.data;
    expect(waveform.peaks_l.length).toBe(DURATION * 200);
    expect(waveform.peaks_r?.length).toBe(waveform.peaks_l.length);
    expect(waveform.max_peak).toBeGreaterThan(0);
    expect(waveform.duration).toBe(DURATION);
    expect('data' in waveform).toBe(false);
  });

  it('TranscriptionResult words carry confidence, speaker and speech_segment', () => {
    const { transcription } = fixture.data;
    expect(transcription.data.length).toBeGreaterThan(0);
    for (const w of transcription.data) {
      expect(typeof w.speech.word).toBe('string');
      expect(typeof w.speech.speaker).toBe('string');
      expect(w.speech.confidence).toBeGreaterThan(0);
      expect(w.speech.confidence).toBeLessThanOrEqual(1);
      expect(typeof w.speech.speech_segment).toBe('number');
    }
  });

  it('FacialTrackingResult has head-pose rotation and a mesh topology', () => {
    const { facialTracking } = fixture.data;
    expect(facialTracking.data.length).toBeGreaterThan(0);
    const frame = facialTracking.data[0];
    expect(frame.facial_tracking.tracking.head_pose.rotation).toHaveLength(3);
    expect(frame.facial_tracking.tracking.blendshapes.length).toBe(52);
    expect(facialTracking.metadata.mesh_topology).toBeDefined();
    expect(facialTracking.mesh_keyframes?.length).toBe(facialTracking.data.length);
    // The face-lost windows should produce at least one face_detected:false frame.
    expect(facialTracking.data.some((f) => !f.facial_tracking.tracking.face_detected)).toBe(true);
  });

  it('MouthEnergyResult has blend_shape_energy and a scalar mouth_energy', () => {
    const { mouthEnergy } = fixture.data;
    expect(mouthEnergy.data.length).toBeGreaterThan(0);
    const seg = mouthEnergy.data[0];
    expect(seg.mouth_energy.blend_shape_energy.jawOpen).toBeDefined();
    expect(typeof seg.mouth_energy.mouth_energy).toBe('number');
  });

  it('DiarizationResult has segments and speaker metadata', () => {
    const { diarization } = fixture.data;
    expect(diarization.data.length).toBeGreaterThan(0);
    expect(diarization.metadata.detected_speakers).toBeGreaterThan(0);
    expect(Object.keys(diarization.metadata.speaker_timing_metadata).length).toBeGreaterThan(0);
  });

  it('IntentClassificationResult carries confidence and reasoning', () => {
    const { intentClassification } = fixture.data;
    expect(intentClassification.data.length).toBeGreaterThan(0);
    for (const it of intentClassification.data) {
      expect(it.intent_classification.confidence).toBeGreaterThan(0);
      expect(it.intent_classification.reasoning.length).toBeGreaterThan(0);
    }
  });

  it('UserLabelResult has the two hand-placed labels from the design', () => {
    const { userLabels } = fixture.data;
    const texts = userLabels.data.map((l) => l.text);
    expect(texts).toContain('laugh');
    expect(texts).toContain('overlap — check');
  });
});

describe('createViewerFixture — state contiguity', () => {
  it('states partition the full timeline with no gaps', () => {
    const { stateAnnotation } = createViewerFixture().data;
    const sorted = [...stateAnnotation.data].sort((a, b) => a.time_range.start - b.time_range.start);
    expect(sorted[0].time_range.start).toBeCloseTo(0, 6);
    expect(sorted[sorted.length - 1].time_range.end).toBeCloseTo(DURATION, 6);
    for (let i = 1; i < sorted.length; i++) {
      expect(Math.abs(sorted[i].time_range.start - sorted[i - 1].time_range.end)).toBeLessThan(CONTIGUITY_TOLERANCE);
    }
  });
});

describe('createViewerFixture — 42–72s review window', () => {
  it('carries the design\'s hand-tuned intent confidences in order', () => {
    const { intentClassification } = createViewerFixture().data;
    const inWindow = intentClassification.data
      .filter((it) => it.time_range.start >= 41 && it.time_range.start < 72)
      .sort((a, b) => a.time_range.start - b.time_range.start);

    // Only 6 turns land in [41, 72) for this seed, so the 7th override in
    // REVIEW_WINDOW_OVERRIDES (engage/0.88) is never applied — matches
    // timeline-data.js, whose `inWin.forEach` silently skips a missing index.
    const expected = [
      { cat: 'engage', conf: 0.91 },
      { cat: 'inquire', conf: 0.54 },
      { cat: 'inform', conf: 0.83 },
      { cat: 'inquire', conf: 0.48 },
      { cat: 'comfort', conf: 0.72 },
      { cat: 'inform', conf: 0.57 },
    ];
    expect(inWindow.length).toBe(expected.length);
    expected.forEach((exp, i) => {
      expect(inWindow[i].intent_classification.intent).toBe(exp.cat);
      expect(inWindow[i].intent_classification.confidence).toBeCloseTo(exp.conf, 3);
    });
  });

  it('exactly one intent in the window is stamped human (the design\'s hand-tuned "inform" pick)', () => {
    const { intentClassification } = createViewerFixture().data;
    const inWindow = intentClassification.data.filter((it) => it.time_range.start >= 41 && it.time_range.start < 72);
    const humanOnes = inWindow.filter(isHumanReviewed);
    expect(humanOnes).toHaveLength(1);
    expect(humanOnes[0].intent_classification.intent).toBe('inform');
    expect(humanOnes[0].intent_classification.confidence).toBeCloseTo(0.83, 3);
  });

  it('one state in the window is stamped human, matching the design generator', () => {
    const { stateAnnotation } = createViewerFixture().data;
    const inWindow = stateAnnotation.data.filter((s) => s.time_range.start >= 40 && s.time_range.start < 72);
    expect(inWindow.filter(isHumanReviewed)).toHaveLength(1);
  });
});

describe('createViewerFixture — low confidence coverage', () => {
  it('has more than zero low-confidence intents and words for the review queue to show', () => {
    const { intentClassification, transcription } = createViewerFixture().data;
    const lowIntents = intentClassification.data.filter((it) => isLowConfidence(it));
    const lowWords = transcription.data.filter((w) => isLowConfidence(w));
    expect(lowIntents.length).toBeGreaterThan(0);
    expect(lowWords.length).toBeGreaterThan(0);
  });
});

describe('createViewerFixture — task mode', () => {
  it('is absent outside task mode', () => {
    expect(createViewerFixture({ mode: 'view' }).task).toBeUndefined();
    expect(createViewerFixture({ mode: 'edit' }).task).toBeUndefined();
    expect(createViewerFixture().task).toBeUndefined();
  });

  it('matches the design\'s verify-intents task', () => {
    const { task } = createViewerFixture({ mode: 'task' });
    expect(task).toBeDefined();
    expect(task?.type).toBe('verify_intents');
    expect(task?.constraints.editableTypes).toEqual(['intent']);
    expect(task?.constraints.allowedOperations).toEqual(['confirm', 'classify', 'resize']);
    expect(task?.constraints.lockedTimeRanges).toEqual([
      { start: 42.0, end: 44.8 },
      { start: 64.2, end: 66.0 },
    ]);
    expect(task?.assignedBy).toBe('M. Okafor');
    expect(task?.dueDate).toBe('2026-09-26');
  });
});
