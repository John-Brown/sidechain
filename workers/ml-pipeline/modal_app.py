"""Modal app definition for the annotation ML pipeline.

Defines web endpoints for all processing stages:
- VAD (voice activity detection)
- Transcription (Whisper large-v3)
- Facial tracking (MediaPipe Face Mesh)
- Mouth energy (from facial tracking blend shapes)
- Diarization (pyannote.audio 3.1)
- State annotation (rule-based speaking/listening)
- Intent classification (Claude API)
"""

from __future__ import annotations

import logging
import traceback

import modal
from pydantic import BaseModel

logger = logging.getLogger(__name__)

app = modal.App("annotation-pipeline")

# ---------------------------------------------------------------------------
# Modal images — one per resource profile
# ---------------------------------------------------------------------------

# VAD: needs torch + torchaudio (CPU)
vad_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch",
        "torchaudio",
        extra_index_url="https://download.pytorch.org/whl/cpu",
    )
    .pip_install("boto3", "pydantic")
)

# Transcription: needs faster-whisper + CUDA
transcription_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("boto3", "pydantic", "faster-whisper", "torch", "ctranslate2")
)

# Facial tracking: MediaPipe + OpenCV (CPU-heavy)
cpu_heavy_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libgl1-mesa-glx", "libglib2.0-0")
    .pip_install("boto3", "pydantic", "mediapipe", "opencv-python-headless", "numpy")
)

# Mouth energy + state annotation: lightweight CPU
cpu_light_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("boto3", "pydantic", "numpy")
)

# Diarization: pyannote.audio + torch
diarization_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("boto3", "pydantic", "pyannote.audio", "torch", "speechbrain")
)

# Intent classification: Anthropic SDK (lightweight)
intent_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("boto3", "pydantic", "anthropic")
)


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

# Legacy VAD models (backward compatibility)
class VadRequest(BaseModel):
    job_id: str
    video_s3_key: str
    result_s3_key: str
    callback_url: str | None = None
    callback_secret: str | None = None


class VadResponse(BaseModel):
    status: str  # "completed" | "failed"
    result_s3_key: str
    segment_count: int = 0
    error: str | None = None


# Generic stage models
class StageRequest(BaseModel):
    job_id: str
    video_id: str
    s3_keys_in: dict[str, str]  # stage_name -> s3_key for inputs
    result_s3_key: str
    callback_url: str | None = None
    callback_secret: str | None = None


class StageResponse(BaseModel):
    status: str  # "completed" | "failed"
    result_s3_key: str
    error: str | None = None


# ---------------------------------------------------------------------------
# Callback helper
# ---------------------------------------------------------------------------

def _send_callback(
    callback_url: str,
    job_id: str,
    response: VadResponse | StageResponse,
    callback_secret: str | None = None,
) -> None:
    """POST status back to the callback URL. Best-effort, non-blocking."""
    import json
    import urllib.request

    payload = {
        "job_id": job_id,
        "status": response.status,
        "result_s3_key": response.result_s3_key,
        "error_message": response.error,
    }

    headers: dict[str, str] = {"Content-Type": "application/json"}
    if callback_secret:
        headers["x-callback-secret"] = callback_secret

    try:
        req = urllib.request.Request(
            callback_url,
            data=json.dumps(payload).encode(),
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            logger.info("Callback sent: %d", resp.status)
    except Exception as e:
        logger.warning("Callback to %s failed: %s", callback_url, e)


# ---------------------------------------------------------------------------
# Stage endpoints
# ---------------------------------------------------------------------------

@app.function(
    image=vad_image,
    secrets=[modal.Secret.from_name("aws-credentials")],
    timeout=600,
    memory=2048,
)
@modal.web_endpoint(method="POST")
def process_vad(request: VadRequest) -> VadResponse:
    """Process a video through the Silero VAD pipeline (legacy endpoint)."""
    from stages.vad import run_vad

    logger.info(
        "Processing VAD for job_id=%s, s3_key=%s",
        request.job_id,
        request.video_s3_key,
    )

    try:
        result = run_vad(
            s3_key=request.video_s3_key,
            result_s3_key=request.result_s3_key,
        )
        response = VadResponse(
            status="completed",
            result_s3_key=request.result_s3_key,
            segment_count=result.metadata.total_segments,
        )
    except Exception as e:
        logger.error("VAD processing failed: %s\n%s", e, traceback.format_exc())
        response = VadResponse(
            status="failed",
            result_s3_key=request.result_s3_key,
            segment_count=0,
            error=str(e),
        )

    if request.callback_url:
        _send_callback(
            request.callback_url, request.job_id, response, request.callback_secret
        )

    return response


@app.function(
    image=vad_image,
    secrets=[modal.Secret.from_name("aws-credentials")],
    timeout=600,
    memory=2048,
)
@modal.web_endpoint(method="POST")
def process_vad_stage(request: StageRequest) -> StageResponse:
    """VAD via the generic StageRequest interface."""
    from stages.vad import run_vad

    logger.info("Processing VAD stage for job_id=%s", request.job_id)

    try:
        run_vad(
            s3_key=request.s3_keys_in["video"],
            result_s3_key=request.result_s3_key,
        )
        response = StageResponse(
            status="completed", result_s3_key=request.result_s3_key
        )
    except Exception as e:
        logger.error("VAD stage failed: %s\n%s", e, traceback.format_exc())
        response = StageResponse(
            status="failed", result_s3_key=request.result_s3_key, error=str(e)
        )

    if request.callback_url:
        _send_callback(
            request.callback_url, request.job_id, response, request.callback_secret
        )
    return response


@app.function(
    image=transcription_image,
    secrets=[modal.Secret.from_name("aws-credentials")],
    gpu="A10G",
    timeout=1200,
    memory=4096,
)
@modal.web_endpoint(method="POST")
def process_transcription(request: StageRequest) -> StageResponse:
    """Transcribe speech using Whisper large-v3 via faster-whisper."""
    from stages.transcription import run_transcription

    logger.info("Processing transcription for job_id=%s", request.job_id)

    try:
        run_transcription(
            s3_key=request.s3_keys_in["video"],
            result_s3_key=request.result_s3_key,
        )
        response = StageResponse(
            status="completed", result_s3_key=request.result_s3_key
        )
    except Exception as e:
        logger.error(
            "Transcription failed: %s\n%s", e, traceback.format_exc()
        )
        response = StageResponse(
            status="failed", result_s3_key=request.result_s3_key, error=str(e)
        )

    if request.callback_url:
        _send_callback(
            request.callback_url, request.job_id, response, request.callback_secret
        )
    return response


@app.function(
    image=cpu_heavy_image,
    secrets=[modal.Secret.from_name("aws-credentials")],
    timeout=1800,
    memory=4096,
    cpu=4,
)
@modal.web_endpoint(method="POST")
def process_facial_tracking(request: StageRequest) -> StageResponse:
    """Run MediaPipe Face Mesh on every video frame."""
    from stages.facial_tracking import run_facial_tracking

    logger.info("Processing facial tracking for job_id=%s", request.job_id)

    try:
        run_facial_tracking(
            s3_key=request.s3_keys_in["video"],
            result_s3_key=request.result_s3_key,
        )
        response = StageResponse(
            status="completed", result_s3_key=request.result_s3_key
        )
    except Exception as e:
        logger.error(
            "Facial tracking failed: %s\n%s", e, traceback.format_exc()
        )
        response = StageResponse(
            status="failed", result_s3_key=request.result_s3_key, error=str(e)
        )

    if request.callback_url:
        _send_callback(
            request.callback_url, request.job_id, response, request.callback_secret
        )
    return response


@app.function(
    image=cpu_light_image,
    secrets=[modal.Secret.from_name("aws-credentials")],
    timeout=300,
    memory=1024,
)
@modal.web_endpoint(method="POST")
def process_mouth_energy(request: StageRequest) -> StageResponse:
    """Compute mouth energy from facial tracking blend shapes."""
    from stages.mouth_energy import run_mouth_energy

    logger.info("Processing mouth energy for job_id=%s", request.job_id)

    try:
        run_mouth_energy(
            facial_tracking_s3_key=request.s3_keys_in["facial_tracking"],
            result_s3_key=request.result_s3_key,
        )
        response = StageResponse(
            status="completed", result_s3_key=request.result_s3_key
        )
    except Exception as e:
        logger.error(
            "Mouth energy failed: %s\n%s", e, traceback.format_exc()
        )
        response = StageResponse(
            status="failed", result_s3_key=request.result_s3_key, error=str(e)
        )

    if request.callback_url:
        _send_callback(
            request.callback_url, request.job_id, response, request.callback_secret
        )
    return response


@app.function(
    image=diarization_image,
    secrets=[
        modal.Secret.from_name("aws-credentials"),
        modal.Secret.from_name("huggingface"),
    ],
    gpu="A10G",
    timeout=1200,
    memory=4096,
)
@modal.web_endpoint(method="POST")
def process_diarization(request: StageRequest) -> StageResponse:
    """Run pyannote speaker diarization enriched with VAD + mouth energy."""
    from stages.diarization import run_diarization

    logger.info("Processing diarization for job_id=%s", request.job_id)

    try:
        run_diarization(
            s3_key=request.s3_keys_in["video"],
            vad_s3_key=request.s3_keys_in["vad"],
            mouth_energy_s3_key=request.s3_keys_in["mouth_energy"],
            result_s3_key=request.result_s3_key,
        )
        response = StageResponse(
            status="completed", result_s3_key=request.result_s3_key
        )
    except Exception as e:
        logger.error(
            "Diarization failed: %s\n%s", e, traceback.format_exc()
        )
        response = StageResponse(
            status="failed", result_s3_key=request.result_s3_key, error=str(e)
        )

    if request.callback_url:
        _send_callback(
            request.callback_url, request.job_id, response, request.callback_secret
        )
    return response


@app.function(
    image=cpu_light_image,
    secrets=[modal.Secret.from_name("aws-credentials")],
    timeout=300,
    memory=1024,
)
@modal.web_endpoint(method="POST")
def process_state_annotation(request: StageRequest) -> StageResponse:
    """Rule-based speaking/listening state annotation from diarization."""
    from stages.state_annotation import run_state_annotation

    logger.info("Processing state annotation for job_id=%s", request.job_id)

    try:
        run_state_annotation(
            diarization_s3_key=request.s3_keys_in["diarization"],
            result_s3_key=request.result_s3_key,
        )
        response = StageResponse(
            status="completed", result_s3_key=request.result_s3_key
        )
    except Exception as e:
        logger.error(
            "State annotation failed: %s\n%s", e, traceback.format_exc()
        )
        response = StageResponse(
            status="failed", result_s3_key=request.result_s3_key, error=str(e)
        )

    if request.callback_url:
        _send_callback(
            request.callback_url, request.job_id, response, request.callback_secret
        )
    return response


@app.function(
    image=intent_image,
    secrets=[
        modal.Secret.from_name("aws-credentials"),
        modal.Secret.from_name("anthropic"),
    ],
    timeout=900,
    memory=1024,
)
@modal.web_endpoint(method="POST")
def process_intent_classification(request: StageRequest) -> StageResponse:
    """Classify communicative intent for speaking segments using Claude."""
    from stages.intent_classification import run_intent_classification

    logger.info("Processing intent classification for job_id=%s", request.job_id)

    try:
        run_intent_classification(
            states_s3_key=request.s3_keys_in["states"],
            transcription_s3_key=request.s3_keys_in["transcription"],
            vad_s3_key=request.s3_keys_in["vad"],
            result_s3_key=request.result_s3_key,
        )
        response = StageResponse(
            status="completed", result_s3_key=request.result_s3_key
        )
    except Exception as e:
        logger.error(
            "Intent classification failed: %s\n%s", e, traceback.format_exc()
        )
        response = StageResponse(
            status="failed", result_s3_key=request.result_s3_key, error=str(e)
        )

    if request.callback_url:
        _send_callback(
            request.callback_url, request.job_id, response, request.callback_secret
        )
    return response
