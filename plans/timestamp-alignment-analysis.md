# Pipeline Timestamp Alignment Analysis

## Problem (2026-02-08)
Word timestamps from faster-whisper consistently ~0.5-1s early relative to waveform and VAD tracks in the viewer.

## Root Cause
`vad_filter=True` in faster-whisper (`stages/transcription.py`) runs an **internal** Silero VAD pass, strips non-speech, concatenates speech segments, transcribes, then remaps timestamps back to original timeline. The remapping introduces systematic offset errors — particularly when there's leading silence.

Additionally, the internal VAD uses different parameters than the standalone Silero VAD stage (`stages/vad.py`: 512-sample window, 0.5 threshold, 300ms merge gap), so even without the offset bug, boundaries would never align between the two tracks.

## Fix Applied
Set `vad_filter=False` in transcription.py. Deployed 2026-02-08. Pending A/B comparison on same video.

**Trade-off**: Without VAD filtering, Whisper may hallucinate on extended silence/noise segments, but timestamps will be in the correct reference frame.

## Future Option: VAD-Gated Transcription
If `vad_filter=False` confirms the offset was the issue, consider full VAD-gated approach:

1. Make transcription depend on VAD in DAG (`STAGE_DEPS.transcription = ["vad"]`)
2. Transcription stage receives both video S3 key + VAD result JSON
3. Extract audio, pad VAD segments by ~200-300ms each side, merge overlapping
4. Run Whisper per padded chunk with `vad_filter=False`
5. Remap word timestamps to absolute time (chunk_start + word.start)
6. Clip words to unpadded VAD boundaries, drop words outside speech regions

**Benefits**: Referential consistency (words always inside VAD segments), hallucination suppression, slight speed improvement.

**Risks**: Context loss at hard boundaries (mitigated by padding), offset remapping bugs (but we control the math), mid-utterance pause splitting (300ms merge gap may need tuning).

## Whisper Timestamp Precision
Even with correct alignment, Whisper word timestamps have inherent ~20-50ms imprecision from cross-attention weight extraction. This is acceptable for annotation purposes but worth noting if sub-frame accuracy is ever needed.
