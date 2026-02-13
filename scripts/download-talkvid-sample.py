#!/usr/bin/env python3
"""Download sample clips from TalkVid dataset for Sidechain testing.

Usage:
    uv run --with datasets --with yt-dlp scripts/download-talkvid-sample.py [--limit 5] [--output data/talkvid-samples]

Requires ffmpeg installed (brew install ffmpeg).
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Download TalkVid sample clips")
    parser.add_argument("--limit", type=int, default=5, help="Number of clips to download")
    parser.add_argument("--output", type=str, default="data/talkvid-samples", help="Output directory")
    parser.add_argument("--min-duration", type=float, default=4.0, help="Min clip duration in seconds")
    parser.add_argument("--language", type=str, default="English", help="Filter by language")
    parser.add_argument("--min-dover", type=float, default=7.0, help="Min quality score")
    args = parser.parse_args()

    # Check ffmpeg
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
    except FileNotFoundError:
        print("ffmpeg not found. Install with: brew install ffmpeg")
        sys.exit(1)

    from datasets import load_dataset

    print(f"Loading TalkVid dataset from HuggingFace...")
    ds = load_dataset("FreedomIntelligence/TalkVid", split="test")
    print(f"Loaded {len(ds)} entries")

    # Filter for quality English clips
    candidates = []
    for row in ds:
        info = row["info"]
        duration = row["end-time"] - row["start-time"]
        if (
            info.get("Language") == args.language
            and info.get("Video Link")
            and duration >= args.min_duration
            and row["dover_scores"] >= args.min_dover
            and row["height"] >= 720
        ):
            candidates.append(row)

    # Sort by quality score descending
    candidates.sort(key=lambda r: r["dover_scores"], reverse=True)
    selected = candidates[: args.limit]

    print(f"Selected {len(selected)} clips (from {len(candidates)} candidates)")
    if not selected:
        print("No clips matched filters. Try relaxing --min-dover or --language.")
        sys.exit(1)

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    metadata_dir = output_dir / "metadata"
    metadata_dir.mkdir(exist_ok=True)

    downloaded = []
    for i, row in enumerate(selected):
        video_link = row["info"]["Video Link"]
        start = row["start-time"]
        end = row["end-time"]
        clip_id = row["id"]
        safe_name = clip_id.replace("/", "_")

        print(f"\n[{i+1}/{len(selected)}] {video_link} [{start:.1f}s - {end:.1f}s]")
        print(f"  {row['info'].get('Gender', '?')}, {row['info'].get('Age Group', '?')}, "
              f"dover={row['dover_scores']:.1f}, {row['width']}x{row['height']}")

        out_video = output_dir / f"{safe_name}.mp4"
        out_audio = output_dir / f"{safe_name}.m4a"

        if out_video.exists():
            print(f"  Already downloaded, skipping.")
            downloaded.append({"file": str(out_video), "metadata": row})
            continue

        # Download video clip with yt-dlp
        cmd = [
            "yt-dlp",
            "--download-sections", f"*{start}-{end}",
            "--force-keyframes-at-cuts",
            "-f", "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]",
            "--merge-output-format", "mp4",
            "-o", str(out_video),
            "--no-playlist",
            "--quiet", "--progress",
            video_link,
        ]

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            if result.returncode != 0:
                print(f"  Failed: {result.stderr[:200]}")
                continue
        except subprocess.TimeoutExpired:
            print(f"  Timeout after 120s, skipping.")
            continue

        # Save metadata
        meta = dict(row)
        meta["downloaded_file"] = str(out_video)
        with open(metadata_dir / f"{safe_name}.json", "w") as f:
            json.dump(meta, f, indent=2, default=str)

        if out_video.exists():
            size_mb = out_video.stat().st_size / (1024 * 1024)
            print(f"  Saved: {out_video.name} ({size_mb:.1f} MB)")
            downloaded.append({"file": str(out_video), "metadata": meta})
        else:
            print(f"  File not created (yt-dlp may have used different naming)")

    # Write manifest
    manifest = {
        "source": "FreedomIntelligence/TalkVid",
        "split": "test",
        "filters": {
            "language": args.language,
            "min_duration": args.min_duration,
            "min_dover": args.min_dover,
        },
        "clips": [
            {
                "file": d["file"],
                "id": d["metadata"]["id"],
                "duration": d["metadata"]["end-time"] - d["metadata"]["start-time"],
                "resolution": f"{d['metadata']['width']}x{d['metadata']['height']}",
                "speaker": {
                    "gender": d["metadata"]["info"].get("Gender"),
                    "age_group": d["metadata"]["info"].get("Age Group"),
                    "ethnicity": d["metadata"]["info"].get("Ethnicity"),
                },
            }
            for d in downloaded
        ],
    }
    manifest_path = output_dir / "manifest.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\nDone. {len(downloaded)}/{len(selected)} clips downloaded.")
    print(f"Manifest: {manifest_path}")


if __name__ == "__main__":
    main()
