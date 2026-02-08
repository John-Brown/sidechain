"""Speech transcription stage using faster-whisper (CTranslate2 Whisper large-v3)."""

from __future__ import annotations

import logging
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

from .utils import download_from_s3, upload_json_to_s3

logger = logging.getLogger(__name__)


def run_transcription(s3_key: str, result_s3_key: str) -> dict:
    """Download video from S3, run Whisper large-v3, upload transcription JSON.

    Output shape matches TranscriptionResult from annotation-types.ts:
    - metadata: AnnotationMetadata with algorithm info
    - data: list of SpeechWord entries with time_range + speech info
    """
    from faster_whisper import WhisperModel

    t0 = time.monotonic()

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)

        # Download source video
        source_ext = Path(s3_key).suffix or ".mp4"
        local_source = tmp_path / f"source{source_ext}"
        try:
            download_from_s3(s3_key, local_source)
        except Exception as e:
            raise RuntimeError(f"Failed to download source from S3: {e}") from e

        # Load model and transcribe
        logger.info("Loading Whisper large-v3-turbo model...")
        model = WhisperModel("large-v3-turbo", device="cuda", compute_type="float16")

        segments_iter, info = model.transcribe(
            str(local_source),
            beam_size=5,
            word_timestamps=True,
            vad_filter=True,
        )

        total_duration = info.duration
        detected_language = info.language
        language_prob = info.language_probability

        logger.info(
            "Transcribing: duration=%.1fs, language=%s (%.2f)",
            total_duration,
            detected_language,
            language_prob,
        )

        # Collect word-level results
        words_data: list[dict] = []
        segment_idx = 0

        for segment in segments_iter:
            if segment.words:
                for word_info in segment.words:
                    words_data.append({
                        "time_range": {
                            "start": round(word_info.start, 3),
                            "end": round(word_info.end, 3),
                        },
                        "speech": {
                            "word": word_info.word.strip(),
                            "speaker": "unknown",
                            "confidence": round(word_info.probability, 3),
                            "speech_segment": segment_idx,
                        },
                    })
            segment_idx += 1

        processing_time = time.monotonic() - t0

        result = {
            "metadata": {
                "source_file": s3_key,
                "format_version": "1.0",
                "created_timestamp": datetime.now(timezone.utc).isoformat(),
                "total_secs": round(total_duration, 3),
                "algorithm": {
                    "name": "whisper",
                    "model": "large-v3-turbo",
                    "version": "faster-whisper",
                    "processing_time": round(processing_time, 3),
                    "parameters": {
                        "beam_size": 5,
                        "vad_filter": True,
                        "word_timestamps": True,
                        "language_detected": detected_language,
                        "language_probability": round(language_prob, 3),
                    },
                },
            },
            "data": words_data,
        }

        try:
            upload_json_to_s3(result, result_s3_key)
        except Exception as e:
            raise RuntimeError(f"Failed to upload result to S3: {e}") from e

        logger.info(
            "Transcription complete: %d words, language=%s, %.1fs processing",
            len(words_data),
            detected_language,
            processing_time,
        )

        return result
