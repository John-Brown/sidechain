"""Speech transcription stage: faster-whisper + wav2vec2 forced alignment.

Pipeline:
1. faster-whisper (direct) — full audio, no VAD trimming, no batching
2. whisperx.align (wav2vec2) — phoneme-level forced alignment for precise timestamps
3. whisperx diarization (optional) — speaker labels per word via pyannote
"""

from __future__ import annotations

import logging
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

from .utils import download_from_s3, upload_json_to_s3

logger = logging.getLogger(__name__)


def run_transcription(s3_key: str, result_s3_key: str) -> dict:
    """Download video from S3, transcribe, align, upload result JSON.

    Step 1 uses faster-whisper directly — no VAD preprocessing, no audio
    trimming. The full audio is transcribed as-is so timestamps are relative
    to the original file.

    Step 2 runs wav2vec2 forced alignment (via whisperx) against the original
    audio to refine word timestamps from cross-attention approximations to
    phoneme-level precision.

    Step 3 optionally runs pyannote diarization (via whisperx) if HF_TOKEN
    is set, assigning speaker labels per word.

    Output shape matches TranscriptionResult from annotation-types.ts.
    """
    from faster_whisper import WhisperModel
    import whisperx

    t0 = time.monotonic()
    device = "cuda"
    compute_type = "float16"

    hf_token = os.environ.get("HF_TOKEN")
    diarize_enabled = bool(hf_token)

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)

        # Download source video
        source_ext = Path(s3_key).suffix or ".mp4"
        local_source = tmp_path / f"source{source_ext}"
        try:
            download_from_s3(s3_key, local_source)
        except Exception as e:
            raise RuntimeError(f"Failed to download source from S3: {e}") from e

        # --- Step 1: Transcribe with faster-whisper (no VAD, full audio) ---
        logger.info("Loading faster-whisper large-v3-turbo...")
        model = WhisperModel("large-v3-turbo", device=device, compute_type=compute_type)

        segments_iter, info = model.transcribe(
            str(local_source),
            beam_size=5,
            word_timestamps=True,
            vad_filter=False,
        )

        total_duration = info.duration
        detected_language = info.language
        language_prob = info.language_probability

        # Collect segments into the dict format whisperx.align() expects:
        # [{"start": float, "end": float, "text": str}, ...]
        whisper_segments: list[dict] = []
        for segment in segments_iter:
            whisper_segments.append({
                "start": segment.start,
                "end": segment.end,
                "text": segment.text,
            })

        logger.info(
            "Transcription complete: duration=%.1fs, language=%s (%.2f), %d segments",
            total_duration,
            detected_language,
            language_prob,
            len(whisper_segments),
        )

        del model

        # --- Step 2: Forced alignment (wav2vec2 via whisperx) ---
        # Load audio in whisperx format (16kHz numpy) for alignment
        audio = whisperx.load_audio(str(local_source))

        aligned_segments = whisper_segments  # fallback
        alignment_used = False
        try:
            model_a, metadata_a = whisperx.load_align_model(
                language_code=detected_language,
                device=device,
            )
            aligned_result = whisperx.align(
                whisper_segments,
                model_a,
                metadata_a,
                audio,
                device,
                return_char_alignments=False,
            )
            aligned_segments = aligned_result.get("segments", whisper_segments)
            alignment_used = True
            logger.info("wav2vec2 alignment complete")
            del model_a
        except Exception as e:
            logger.warning(
                "Forced alignment failed (lang=%s), using Whisper timestamps: %s",
                detected_language,
                e,
            )

        # --- Step 3: Speaker diarization (optional) ---
        diarization_used = False
        if diarize_enabled:
            try:
                from whisperx.diarize import DiarizationPipeline

                logger.info("Running speaker diarization...")
                diarize_model = DiarizationPipeline(
                    use_auth_token=hf_token,
                    device=device,
                )
                diarize_segments = diarize_model(audio)
                diarize_result = whisperx.assign_word_speakers(
                    diarize_segments, {"segments": aligned_segments}
                )
                aligned_segments = diarize_result.get("segments", aligned_segments)
                diarization_used = True
                logger.info("Diarization complete")
                del diarize_model
            except Exception as e:
                logger.warning("Diarization failed, continuing without speaker labels: %s", e)

        # --- Build output ---
        words_data: list[dict] = []
        segment_idx = 0

        for segment in aligned_segments:
            word_list = segment.get("words", [])
            segment_speaker = segment.get("speaker", "unknown")

            for w in word_list:
                # After alignment: {word, start, end, score, speaker?}
                # Words that couldn't be aligned lack start/end — skip them.
                if "start" not in w or "end" not in w:
                    continue

                speaker = w.get("speaker", segment_speaker) or "unknown"

                words_data.append({
                    "time_range": {
                        "start": round(w["start"], 3),
                        "end": round(w["end"], 3),
                    },
                    "speech": {
                        "word": w.get("word", "").strip(),
                        "speaker": speaker,
                        "confidence": round(w.get("score", 0.0), 3),
                        "speech_segment": segment_idx,
                    },
                })

            segment_idx += 1

        processing_time = time.monotonic() - t0

        result_json = {
            "metadata": {
                "source_file": s3_key,
                "format_version": "1.0",
                "created_timestamp": datetime.now(timezone.utc).isoformat(),
                "total_secs": round(total_duration, 3),
                "algorithm": {
                    "name": "whisperx",
                    "model": "large-v3-turbo",
                    "version": "faster-whisper+wav2vec2",
                    "processing_time": round(processing_time, 3),
                    "parameters": {
                        "beam_size": 5,
                        "compute_type": compute_type,
                        "vad_filter": False,
                        "language_detected": detected_language,
                        "language_probability": round(language_prob, 3),
                        "alignment": "wav2vec2" if alignment_used else "whisper_cross_attention",
                        "diarization": diarization_used,
                    },
                },
            },
            "data": words_data,
        }

        try:
            upload_json_to_s3(result_json, result_s3_key)
        except Exception as e:
            raise RuntimeError(f"Failed to upload result to S3: {e}") from e

        logger.info(
            "Transcription complete: %d words, language=%s, alignment=%s, diarization=%s, %.1fs",
            len(words_data),
            detected_language,
            "wav2vec2" if alignment_used else "whisper",
            diarization_used,
            processing_time,
        )

        return result_json
