# Expected Pipeline Data Shapes

Last validated: 2026-02-08

This document records the **actual** JSON shapes produced by each Python pipeline stage.
These are the ground truth — TypeScript types must match these, not the other way around.

## VAD (`voice_activity.json`)

**Top-level keys**: `metadata`, `segments`, `frames`
**NOTE**: Does NOT use `data`. This is the only stage that diverges from the `{metadata, data}` pattern.

```json
{
  "metadata": {
    "source_file": "...",
    "format_version": "1.0",
    "created_timestamp": "...",
    "total_secs": 26.423,
    "algorithm": {
      "name": "silero-vad",
      "model": "silero-vad-v5",
      "version": "v5",
      "processing_time": 7.537,
      "window_size_ms": 32,
      "hop_size_ms": 32,
      "sample_rate": 16000,
      "threshold": 0.5,
      "parameters": { "merge_gap_ms": 300 }
    },
    "total_segments": 7,
    "speech_ratio": 0.787
  },
  "segments": [
    { "time_range": { "start": 1.346, "end": 9.15 }, "confidence": 1 }
  ],
  "frames": [
    { "time_range": { "start": 0, "end": 0.032 }, "speech_probability": 0.0926 }
  ]
}
```

**TS type**: `VadResult` with `segments: VadSegment[]` + `frames: VadFrame[]`
**Viewer uses**: `frames` array for `drawVad` (speech probability bars)
**No energy data**: The pipeline does not output energy_dbfs fields.

---

## Transcription (`speech_transcription.json`)

**Top-level keys**: `metadata`, `data`

```json
{
  "metadata": { "...standard..." },
  "data": [
    {
      "time_range": { "start": 1.36, "end": 1.68 },
      "speech": {
        "word": "hello",
        "speaker": "SPEAKER_00",
        "confidence": 0.95,
        "speech_segment": 0
      }
    }
  ]
}
```

**TS type**: `TranscriptionResult` with `data: SpeechWord[]`
**Viewer uses**: `data` array for DOM track blocks

---

## Facial Tracking (`facial_tracking.json`)

**Top-level keys**: `metadata`, `data`
**NOTE**: Uses `time` (single float), NOT `time_range`.

```json
{
  "metadata": {
    "...standard...",
    "video_width": 1920,
    "video_height": 1080
  },
  "data": [
    {
      "time": 0.0,
      "facial_tracking": {
        "tracking": {
          "blendshapes": [0.0, 0.0, "...52 values..."],
          "head_pose": {
            "rotation": [0.0, 0.0, 0.0],
            "translation": [0.0, 0.0, 0.0]
          },
          "gaze_direction": [0.0, 0.0, -1.0],
          "landmarks": [[0.5, 0.3], "...478 pairs..."],
          "confidence": 1.0,
          "face_detected": true
        }
      }
    }
  ]
}
```

**TS type**: `FacialTrackingResult` with `data: FacialTrackingFrame[]`
**Viewer uses**: `data` array for `drawHeadPose` (reads `.facial_tracking.tracking.head_pose.rotation`)
**Binary search note**: Uses custom inline search on `.time` field, not `binarySearchStart`/`End` which expect `.time_range`

---

## Mouth Energy (`mouth_energy.json`)

**Top-level keys**: `metadata`, `data`

```json
{
  "metadata": { "...standard..." },
  "data": [
    {
      "time_range": { "start": 0.0, "end": 0.1 },
      "mouth_energy": {
        "blend_shape_energy": {
          "jawOpen": { "raw_value": 0.0, "deviation": 0.0 },
          "mouthSmileLeft": { "raw_value": 0.0, "deviation": 0.0 }
        },
        "mouth_energy": 0.15
      }
    }
  ]
}
```

**TS type**: `MouthEnergyResult` with `data: MouthEnergySegment[]`
**Viewer uses**: `data` array for `drawMouthEnergy` (reads `.mouth_energy.mouth_energy`)

---

## Diarization (`diarization.json`)

**Top-level keys**: `metadata`, `data`

```json
{
  "metadata": {
    "...standard...",
    "requested_speakers": null,
    "detected_speakers": 2,
    "visible_speaker_probability": { "SPEAKER_00": 0.8, "SPEAKER_01": null },
    "visible_speaker_detection_status": "detected",
    "audio_channel_speaker_probability": { "left": { "SPEAKER_00": 0.9 } },
    "audio_channel_detection_status": "detected",
    "speaker_timing_metadata": {
      "SPEAKER_00": {
        "total_duration_secs": 15.2,
        "turn_count": 5,
        "avg_turn_duration_secs": 3.04
      }
    }
  },
  "data": [
    {
      "time_range": { "start": 0.0, "end": 5.0 },
      "diarization": { "speaker": "SPEAKER_00" }
    }
  ]
}
```

**TS type**: `DiarizationResult` with `data: DiarizationSegment[]`
**Status**: IN_DEVELOPMENT (not yet production-verified)

---

## State Annotation (`annotations.json`)

**Top-level keys**: `metadata`, `data`

```json
{
  "metadata": { "...standard..." },
  "data": [
    {
      "time_range": { "start": 0.0, "end": 5.0 },
      "category": "expression.state.speaking",
      "note": "Active speech with gesture",
      "parameters": { "speaker": "SPEAKER_00" }
    }
  ]
}
```

**TS type**: `StateAnnotationResult` with `data: StateAnnotation[]`
**Status**: IN_DEVELOPMENT (depends on diarization)

---

## Intent Classification (`intent_classification_annotations.json`)

**Top-level keys**: `metadata`, `data`

```json
{
  "metadata": { "...standard..." },
  "data": [
    {
      "time_range": { "start": 0.0, "end": 5.0 },
      "intent_classification": {
        "intent": "inform",
        "intensity": "moderate",
        "valence": "neutral",
        "confidence": 0.85,
        "reasoning": "Speaker is explaining a concept"
      }
    }
  ]
}
```

**TS type**: `IntentClassificationResult` with `data: IntentAnnotation[]`
**Status**: IN_DEVELOPMENT (depends on state_annotation)

## Waveform Peaks (`waveform_peaks.json`)

```json
{
  "metadata": { "...standard..." },
  "peaks_l": [0.01, 0.12, 0.34],
  "peaks_r": [0.02, 0.10, 0.31],
  "sample_rate": 200,
  "max_peak": 0.87,
  "duration": 42.5
}
```

200 peaks/sec, per-channel absolute max. `peaks_r` is `null` for mono audio. **`sample_rate` is the peak rate** (`PEAKS_PER_SECOND` = 200), not the audio rate. The audio rate (16 kHz) is in `metadata.algorithm.parameters.audio_sample_rate`. **Flat shape, no `data[]` array.**

**TS type**: `WaveformPeaksResult`
**Status**: WORKING (root stage, CPU)
