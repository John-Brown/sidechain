"""Shared utilities for ML pipeline stages — S3 operations and audio loading."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

import boto3

logger = logging.getLogger(__name__)


def get_s3_client() -> boto3.client:
    """Create an S3 client from environment variables."""
    return boto3.client(
        "s3",
        aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
        region_name=os.environ.get("S3_REGION", "us-east-1"),
    )


def get_bucket() -> str:
    """Return the S3 bucket name from environment."""
    return os.environ["S3_BUCKET"]


def download_from_s3(s3_key: str, local_path: Path) -> None:
    """Download a file from S3 to a local path."""
    client = get_s3_client()
    bucket = get_bucket()
    logger.info("Downloading s3://%s/%s -> %s", bucket, s3_key, local_path)
    client.download_file(bucket, s3_key, str(local_path))


def upload_to_s3(local_path: Path, s3_key: str) -> None:
    """Upload a local file to S3."""
    client = get_s3_client()
    bucket = get_bucket()
    logger.info("Uploading %s -> s3://%s/%s", local_path, bucket, s3_key)
    client.upload_file(
        str(local_path),
        bucket,
        s3_key,
        ExtraArgs={"ContentType": "application/json"},
    )


def download_json_from_s3(s3_key: str) -> dict:
    """Download and parse a JSON file from S3."""
    client = get_s3_client()
    bucket = get_bucket()
    logger.info("Downloading JSON s3://%s/%s", bucket, s3_key)
    response = client.get_object(Bucket=bucket, Key=s3_key)
    return json.loads(response["Body"].read().decode("utf-8"))


def upload_json_to_s3(data: dict, s3_key: str) -> None:
    """Serialize dict to JSON and upload to S3."""
    client = get_s3_client()
    bucket = get_bucket()
    body = json.dumps(data, indent=2).encode("utf-8")
    logger.info("Uploading JSON -> s3://%s/%s (%d bytes)", bucket, s3_key, len(body))
    client.put_object(
        Bucket=bucket,
        Key=s3_key,
        Body=body,
        ContentType="application/json",
    )


def load_audio(path: Path):
    """Load audio from a video/audio file, resample to 16kHz mono.

    Returns a torch.Tensor (1-D, float32).
    Imports torch/torchaudio lazily so stages that don't need audio can skip them.
    """
    import torch
    import torchaudio

    SAMPLE_RATE = 16000

    waveform, sr = torchaudio.load(str(path))

    # Mix to mono if stereo
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)

    # Resample if needed
    if sr != SAMPLE_RATE:
        resampler = torchaudio.transforms.Resample(orig_freq=sr, new_freq=SAMPLE_RATE)
        waveform = resampler(waveform)

    return waveform.squeeze(0)
