"""Modal app definition for the annotation ML pipeline."""

from __future__ import annotations

import logging
import traceback

import modal
from pydantic import BaseModel

logger = logging.getLogger(__name__)

app = modal.App("annotation-vad")

vad_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch",
        "torchaudio",
        extra_index_url="https://download.pytorch.org/whl/cpu",
    )
    .pip_install("boto3", "pydantic")
)


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


@app.function(
    image=vad_image,
    secrets=[modal.Secret.from_name("aws-credentials")],
    timeout=600,
    memory=2048,
)
@modal.web_endpoint(method="POST")
def process_vad(request: VadRequest) -> VadResponse:
    """Process a video through the Silero VAD pipeline.

    Downloads video from S3, runs VAD, uploads result JSON, and optionally
    calls back with status.
    """
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

    # Fire-and-forget callback if provided
    if request.callback_url:
        _send_callback(
            request.callback_url,
            request.job_id,
            response,
            request.callback_secret,
        )

    return response


def _send_callback(
    callback_url: str,
    job_id: str,
    response: VadResponse,
    callback_secret: str | None = None,
) -> None:
    """POST status back to the callback URL. Best-effort, non-blocking."""
    import urllib.request
    import json

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
