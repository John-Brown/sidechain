"""Intent classification for speaking segments using Claude API."""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone

from .utils import download_json_from_s3, upload_json_to_s3

logger = logging.getLogger(__name__)

CLAUDE_MODEL = "claude-sonnet-5"

INTENT_TYPES = ["engage", "inform", "inquire", "challenge", "comfort", "celebrate"]
INTENSITY_LEVELS = ["low", "moderate", "high"]
VALENCE_LEVELS = ["positive", "neutral", "negative"]

CLASSIFICATION_PROMPT = """\
You are classifying the communicative intent of a speech segment in a conversation.

Given the transcript text and surrounding context, classify the segment with:
- intent: one of {intents}
- intensity: one of {intensities}
- valence: one of {valences}
- confidence: 0.0 to 1.0
- reasoning: brief explanation (1-2 sentences)

Definitions:
- engage: initiating or maintaining social connection (greetings, small talk)
- inform: sharing factual information or explaining something
- inquire: asking questions or seeking information
- challenge: disagreeing, pushing back, or questioning assumptions
- comfort: providing emotional support or reassurance
- celebrate: expressing joy, congratulations, or shared excitement

Respond with ONLY valid JSON matching this schema:
{{"intent": "...", "intensity": "...", "valence": "...", "confidence": 0.0, "reasoning": "..."}}

Transcript segment: "{text}"
Context (preceding text): "{context}"
"""


def _classify_segment(
    client,
    text: str,
    context: str,
) -> dict:
    """Classify a single speaking segment using the Claude API."""
    prompt = CLASSIFICATION_PROMPT.format(
        intents=", ".join(INTENT_TYPES),
        intensities=", ".join(INTENSITY_LEVELS),
        valences=", ".join(VALENCE_LEVELS),
        text=text,
        context=context,
    )

    response = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=256,
        messages=[{"role": "user", "content": prompt}],
    )

    response_text = response.content[0].text.strip()

    try:
        result = json.loads(response_text)
    except json.JSONDecodeError:
        logger.warning("Failed to parse Claude response: %s", response_text)
        return {
            "intent": "inform",
            "intensity": "moderate",
            "valence": "neutral",
            "confidence": 0.0,
            "reasoning": "Classification failed: could not parse model response",
        }

    # Validate and clamp values
    if result.get("intent") not in INTENT_TYPES:
        result["intent"] = "inform"
    if result.get("intensity") not in INTENSITY_LEVELS:
        result["intensity"] = "moderate"
    if result.get("valence") not in VALENCE_LEVELS:
        result["valence"] = "neutral"

    confidence = result.get("confidence", 0.5)
    result["confidence"] = round(max(0.0, min(1.0, float(confidence))), 3)
    result["reasoning"] = str(result.get("reasoning", ""))

    return result


def run_intent_classification(
    states_s3_key: str,
    transcription_s3_key: str,
    vad_s3_key: str,
    result_s3_key: str,
) -> dict:
    """Classify intent for each speaking segment using transcript + context + Claude.

    Output shape matches IntentClassificationResult from annotation-types.ts.
    """
    import anthropic

    t0 = time.monotonic()

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY environment variable required")

    client = anthropic.Anthropic(api_key=api_key)

    # Load input data
    try:
        states_data = download_json_from_s3(states_s3_key)
    except Exception as e:
        raise RuntimeError(f"Failed to download state annotations: {e}") from e

    try:
        transcription_data = download_json_from_s3(transcription_s3_key)
    except Exception as e:
        raise RuntimeError(f"Failed to download transcription: {e}") from e

    try:
        vad_data = download_json_from_s3(vad_s3_key)
    except Exception as e:
        raise RuntimeError(f"Failed to download VAD data: {e}") from e

    source_file = states_data.get("metadata", {}).get("source_file", "")
    total_secs = states_data.get("metadata", {}).get("total_secs", 0.0)

    # Get speaking segments from state annotations
    speaking_segments = [
        s for s in states_data.get("data", [])
        if s.get("category") == "expression.state.speaking"
    ]

    # Build word list from transcription for quick time-range lookup
    words = transcription_data.get("data", [])

    def _get_text_for_range(start: float, end: float) -> str:
        """Extract transcript words within a time range."""
        segment_words = []
        for w in words:
            w_start = w["time_range"]["start"]
            w_end = w["time_range"]["end"]
            # Word overlaps with range
            if w_end > start and w_start < end:
                segment_words.append(w["speech"]["word"])
        return " ".join(segment_words)

    def _get_context(end_before: float, max_words: int = 30) -> str:
        """Get preceding transcript context up to max_words."""
        context_words = []
        for w in words:
            if w["time_range"]["end"] <= end_before:
                context_words.append(w["speech"]["word"])
        return " ".join(context_words[-max_words:])

    # Classify each speaking segment
    annotations: list[dict] = []
    classified = 0
    skipped = 0

    for seg in speaking_segments:
        seg_start = seg["time_range"]["start"]
        seg_end = seg["time_range"]["end"]

        text = _get_text_for_range(seg_start, seg_end)
        if not text.strip():
            skipped += 1
            continue

        context = _get_context(seg_start)

        classification = _classify_segment(client, text, context)

        annotations.append({
            "time_range": {
                "start": round(seg_start, 3),
                "end": round(seg_end, 3),
            },
            "intent_classification": classification,
        })
        classified += 1

    processing_time = time.monotonic() - t0

    result = {
        "metadata": {
            "source_file": source_file,
            "format_version": "1.0",
            "created_timestamp": datetime.now(timezone.utc).isoformat(),
            "total_secs": round(total_secs, 3),
            "algorithm": {
                "name": "claude-intent-classification",
                "model": CLAUDE_MODEL,
                "version": "1.0",
                "processing_time": round(processing_time, 3),
                "parameters": {
                    "classified_segments": classified,
                    "skipped_segments": skipped,
                },
            },
        },
        "data": annotations,
    }

    try:
        upload_json_to_s3(result, result_s3_key)
    except Exception as e:
        raise RuntimeError(f"Failed to upload result to S3: {e}") from e

    logger.info(
        "Intent classification complete: %d classified, %d skipped in %.1fs",
        classified,
        skipped,
        processing_time,
    )

    return result
