# TalkVid Dataset Reference

Source: [FreedomIntelligence/TalkVid](https://github.com/FreedomIntelligence/TalkVid)
Paper: [arxiv.org/abs/2508.13618](https://arxiv.org/abs/2508.13618)
HuggingFace: [FreedomIntelligence/TalkVid](https://huggingface.co/datasets/FreedomIntelligence/TalkVid)

## Overview

1,244+ hours of HD/4K talking head video from YouTube. 7,729 unique speakers, 15 languages, age range 0-60+. Full upper-body (not head-only crops). Licensed CC BY-NC 4.0.

## Clip Metadata Schema

```json
{
  "id": "videovideoTr6MMsoWAog-scene1-scene1",
  "video-path": "TalkVid-bench/age/videos/...",
  "audio-path": "TalkVid-bench/age/audios/...",
  "height": 1080,
  "width": 1920,
  "fps": 24,
  "start-time": 0.1,
  "start-frame": 0,
  "end-time": 5.142,
  "end-frame": 121,
  "durations": "5.042s",
  "dover_scores": 8.9,
  "cotracker_ratio": 0.927,
  "head_detail": {
    "passed": true,
    "scores": {
      "avg_completeness": 100.0,
      "min_completeness": 100.0,
      "avg_movement": 97.9,
      "min_movement": 89.4,
      "avg_orientation": 94.8,
      "min_orientation": 92.9,
      "avg_resolution": 327.0,
      "min_resolution": 270.8,
      "avg_rotation": 93.8,
      "min_rotation": 70.4
    }
  },
  "info": {
    "Person ID": "597",
    "Ethnicity": "White",
    "Age Group": "60+",
    "Gender": "Male",
    "Language": "English",
    "Video Link": "https://www.youtube.com/watch?v=Tr6MMsoWAog",
    "Video Category": "Personal Experience"
  },
  "description": "Natural language description of motion and content..."
}
```

## Quality Metrics

| Metric | Range | Description |
|--------|-------|-------------|
| `dover_scores` | 5.2–10.6 | DOVER video quality model (higher = better) |
| `cotracker_ratio` | 0.7–0.99 | Optical flow tracking stability |
| `head_detail.scores.avg_movement` | 0–100 | Head movement smoothness |
| `head_detail.scores.avg_rotation` | 0–100 | Head rotation range quality |
| `head_detail.scores.avg_completeness` | 0–100 | Face visibility (100 = fully visible) |
| `head_detail.scores.avg_resolution` | float | Face bounding box size (pixels) |
| `head_detail.scores.avg_orientation` | 0–100 | Face orientation stability |

Each metric has both `avg_*` and `min_*` variants (aggregate vs worst-frame).

## Data Pipeline (their processing stages)

| Stage | Purpose | Technique |
|-------|---------|-----------|
| 0. Download | YouTube clip extraction | yt-dlp with time sections |
| 1. Rough segmentation | Scene boundary detection | Histogram-based (threshold 0.085) or content-based |
| 2a. Quality filtering | Video quality scoring | DOVER model (ONNX), threshold ≥5 |
| 2b. Motion filtering | Optical flow analysis | CoTracker (offline mode) |
| 3. Head filtering | Face quality & pose | MediaPipe-like head metrics, multi-threshold |

## Speaker Demographics

- **Languages**: English, Chinese, Arabic, Polish, German, Russian, French, Korean, Portuguese, Japanese, Thai, Spanish, Italian, Hindi, Others
- **Age Groups**: 0-19, 19-30, 31-45, 46-60, 60+
- **Ethnicities**: White, Asian, African, Others
- **Gender**: Male, Female

## Relevance to Sidechain

TalkVid clips are good test data for our pipeline because they:
- Are ~5s talking head clips (matches our VAD/transcription/facial tracking stages)
- Come with quality scores we can cross-reference against our own processing
- Include speaker demographics for testing diversity
- Have pre-computed head tracking metrics comparable to our MediaPipe facial tracking stage
- Use float seconds for time (same as our convention)

Key differences from our annotation format:
- TalkVid: quality-focused metadata (dover, cotracker, head detail scores)
- Sidechain: behavior-focused annotations (VAD segments, transcription, states, intents)
- TalkVid includes NL descriptions per clip (could inform future intent classification)

## Download Sample Data

```bash
uv run --with datasets --with yt-dlp scripts/download-talkvid-sample.py --limit 5
```

Output goes to `data/talkvid-samples/` with per-clip metadata JSON and a manifest.
