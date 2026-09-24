# Algorithm Reference, Part C: Intent Classification, Dependency Graph, Performance

> **Status (2026-09-24):** The algorithm descriptions here (processing steps, parameters, blend-shape weights, state rules, intent taxonomy and prompt) are still the design reference for each stage. The implementation details are from the Phase 0 spike and are historical: `src/processing/...` paths, FaceKitRunner (ARKit, 51 blend shapes), OpenAI/MLX Whisper, Silero VAD v3.1, local CLI usage and output directories. The current implementations are the Modal stages in `workers/ml-pipeline/stages/*.py` (Silero VAD v5, faster-whisper large-v3, MediaPipe FaceLandmarker with 52 blend shapes), documented in [PIPELINE.md](../workers/ml-pipeline/PIPELINE.md); current result shapes live in `packages/shared/src/annotation-types.ts`.

**Parts:** [02a: VAD, transcription, facial tracking](02a-algorithm-reference-vad-transcription-face.md) · [02b: mouth energy, diarization, states](02b-algorithm-reference-mouth-diarization-states.md) · [02c: intents, dependency graph, performance](02c-algorithm-reference-intents-summary.md) · [02d: Phase 0 extras](02d-algorithm-reference-phase0-extras.md)

---

## 7. Intent Classification

### Purpose
Classify expressive intents, intensity, and emotional valence of speech segments using large language models.

### Algorithm
**LLM-based Classification** - Context-aware natural language understanding

### Implementation
**File**: `src/processing/intent_annotation/intent_processor.py` (Phase 0; current: `workers/ml-pipeline/stages/intent_classification.py`)

**Models**:
- Anthropic Claude (via Anthropic API)
- OpenAI GPT (via OpenAI API)

**Method**: Structured prompting with conversation context

### Input

**Primary**:
- `annotations.json` (expression.state.* annotations for time boundaries)
- `speech_transcription.json` (transcribed words)
- `voice_activity.json` (speech probability and energy)

**Configuration**:
- Model selection (Claude vs GPT)
- Temperature: 0.3 (balanced determinism)
- Max context: 10 previous chunks

### Processing Steps

1. **Chunk Extraction**
   - Use state annotation time ranges as chunk boundaries
   - Extract transcribed words within each time range
   - Combine with voice activity metrics
   - Associate with speaker ID

2. **Context Window Construction**
   - For each chunk to classify:
     - Include 10 previous chunks as context
     - Maintain conversation flow
     - Preserve speaker identity

3. **Prompt Generation**
   - Structured prompt with:
     - Current chunk text and speaker
     - Context chunks (10 previous)
     - Classification instructions
     - Output format specification

4. **LLM Inference** (parallel)
   - Send up to 20 concurrent requests
   - Process multiple chunks simultaneously
   - Apply rate limiting to avoid API throttling

5. **Response Parsing**
   - Extract structured fields:
     - Intent type (6 categories)
     - Intensity level (3 levels)
     - Valence (3 types)
     - Confidence score
     - Reasoning explanation
   - Validate against allowed values
   - Handle partial or malformed responses

6. **Result Assembly**
   - Match classifications back to time ranges
   - Create intent annotation entries
   - Include confidence and reasoning

### Output Format

**File**: `intent_classification.json`

```json
{
  "metadata": {
    "source_file": "video.mov",
    "format_version": "1.0",
    "created_timestamp": "2025-01-14T12:00:00Z",
    "total_secs": 30.5,
    "algorithm": {
      "name": "intent_classification",
      "model": "claude-3-5-sonnet",
      "temperature": 0.3,
      "max_context_chunks": 10,
      "max_concurrent_requests": 20,
      "processing_time": 45.2
    }
  },
  "data": [
    {
      "time_range": {
        "start": 0.0,
        "end": 5.2
      },
      "intent_classification": {
        "intent": "engage",
        "intensity": "moderate",
        "valence": "positive",
        "confidence": 0.85,
        "reasoning": "Speaker is initiating conversation with friendly tone and open-ended question"
      }
    },
    {
      "time_range": {
        "start": 5.2,
        "end": 8.7
      },
      "intent_classification": {
        "intent": "inform",
        "intensity": "high",
        "valence": "neutral",
        "confidence": 0.92,
        "reasoning": "Speaker is providing detailed factual information in response to question"
      }
    }
  ]
}
```

### Intent Types

| Intent | Description | Example |
|--------|-------------|---------|
| `engage` | Initiating or maintaining interaction | "Hey, how are you?" |
| `inform` | Sharing information or facts | "The meeting is at 3pm" |
| `inquire` | Seeking information or asking questions | "What do you think about this?" |
| `challenge` | Questioning or pushing back | "I disagree with that approach" |
| `comfort` | Providing emotional support | "Don't worry, it'll be okay" |
| `celebrate` | Expressing joy or achievement | "That's amazing news!" |

### Intensity Levels

| Level | Description |
|-------|-------------|
| `low` | Subtle, understated expression |
| `moderate` | Normal, clear expression |
| `high` | Strong, emphatic expression |

### Valence Types

| Valence | Description |
|---------|-------------|
| `positive` | Positive emotional tone |
| `neutral` | Neutral emotional tone |
| `negative` | Negative emotional tone |

### Performance

- **Speed**: Variable (depends on API rate limits)
- **Throughput**: Up to 20 concurrent chunks
- **Latency**: 2-5 seconds per chunk
- **Cost**: API usage charges apply
- **Example**: 10-minute conversation (50 chunks) processes in 5-10 minutes

### Key Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `model` | claude-3-5-sonnet | LLM model to use |
| `temperature` | 0.3 | Sampling temperature |
| `max_context_chunks` | 10 | Previous chunks for context |
| `max_concurrent` | 20 | Parallel request limit |
| `default_confidence` | 0.5 | Fallback confidence |

### Prompt Template

```python
CLASSIFICATION_PROMPT = """
Analyze the following speech chunk and classify the speaker's expressive intent.

Current chunk:
Speaker: {speaker}
Text: {text}
Duration: {duration}s

Context (previous 10 chunks):
{context_chunks}

Classify the intent into one of:
- engage: Initiating or maintaining interaction
- inform: Sharing information
- inquire: Seeking information
- challenge: Questioning or pushing back
- comfort: Providing emotional support
- celebrate: Expressing joy or achievement

Also classify:
- Intensity: low, moderate, high
- Valence: positive, neutral, negative
- Confidence: 0.0 to 1.0

Respond in JSON format:
{
  "intent": "...",
  "intensity": "...",
  "valence": "...",
  "confidence": 0.0,
  "reasoning": "..."
}
"""
```

### Dependencies

```python
anthropic (for Claude)
openai (for GPT)
asyncio (for parallel processing)
aiohttp (for async HTTP)
json
```

### API Setup

**Environment Variables**:
```bash
export ANTHROPIC_API_KEY="your_key"
export OPENAI_API_KEY="your_key"
```

### Known Limitations

- Requires API access and internet connectivity
- Cost scales with video duration (API charges)
- Quality depends on transcription accuracy
- May misclassify subtle or ambiguous intents
- Context limited to 10 previous chunks
- No multi-speaker intent modeling (treats chunks independently)
- Rate limiting may slow processing
- Non-deterministic (temperature > 0)

### Error Handling

- Retries failed requests (3 attempts)
- Falls back to default confidence on parsing errors
- Validates all structured fields
- Logs classification failures for review
- Continues processing on individual failures

---

## Algorithm Dependency Graph

```
video_file
    ↓
┌───┴───┬───────────┬──────────────┐
│       │           │              │
VAD  Whisper  FaceKit         Audio Extract
│       │           │              │
│       │           ↓              │
│       │      Mouth Energy        │
│       │           │              │
└───┬───┴───────┬───┴──────────────┘
    │           │
    └─────┬─────┘
          ↓
    Diarization
          ↓
   State Annotation
          ↓
    ┌─────┴─────┐
    │           │
    │      Transcription
    │           │
    └─────┬─────┘
          ↓
  Intent Classification

ALTERNATIVE PATH (stereo recordings):

video_file (stereo audio)
    ↓
┌───┴──────────────────┐
│                      │
FaceKit          Source Separation
│                (Fast-MNMF)
↓                      ↓
Mouth Energy    ┌──────┴──────┐
                │             │
           Audio Gate    Audio Gate
           (Channel L)   (Channel R)
                │             │
                ↓             ↓
           MLX Whisper   MLX Whisper
                │             │
                └──────┬──────┘
                       ↓
              Merge + Deduplicate
                       ↓
         speech_transcription.json
         diarization.json
```

## Performance Summary Table

| Algorithm | Speed | Memory | Device | Model Size |
|-----------|-------|--------|--------|------------|
| VAD | 2-5x RT | 500MB | CPU | ~6MB |
| Transcription (Whisper) | 1x RT | 4-6GB | CPU/GPU | ~3GB |
| Per-Speaker (MLX Whisper) | 4-8x RT | 2-4GB | Apple Silicon | ~3GB |
| Facial Tracking | 4-20x RT | 2-4GB | CPU/Metal | N/A |
| Mouth Energy | Instant | <100MB | CPU | N/A |
| Diarization | 0.3x RT | 4-8GB | MPS/CUDA/CPU | ~500MB |
| Source Separation | ~0.5x RT | 2-4GB | CPU | N/A |
| State Annotation | Instant | <50MB | CPU | N/A |
| Intent Classification | Variable | <1GB | API | N/A |

**RT = Realtime** (1x RT means processing takes same time as video duration)

---

Previous: [Part B](02b-algorithm-reference-mouth-diarization-states.md) · Next: [Part D: Phase 0 extras](02d-algorithm-reference-phase0-extras.md)
