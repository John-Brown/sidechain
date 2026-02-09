import { describe, it, expect } from "vitest";
import type { PipelineStage } from "@annotation/shared";
import {
  STAGE_DEPS,
  ROOT_STAGES,
  STAGE_RESULT_KEYS,
  getResultS3Key,
  buildS3KeysIn,
  IN_DEVELOPMENT_STAGES,
  getReadyStages,
} from "./dag";

// Helper to build a full job list with a given default status and overrides
function makeJobs(
  defaults: string,
  overrides: Partial<Record<PipelineStage, string>> = {},
): { stage: PipelineStage; status: string }[] {
  const stages: PipelineStage[] = [
    "vad",
    "transcription",
    "facial_tracking",
    "mouth_energy",
    "diarization",
    "state_annotation",
    "intent_classification",
  ];
  return stages.map((stage) => ({
    stage,
    status: overrides[stage] ?? defaults,
  }));
}

describe("ROOT_STAGES", () => {
  it("contains exactly vad, transcription, facial_tracking, waveform", () => {
    expect(ROOT_STAGES).toHaveLength(4);
    expect(ROOT_STAGES).toEqual(
      expect.arrayContaining(["vad", "transcription", "facial_tracking", "waveform"]),
    );
  });
});

describe("getResultS3Key", () => {
  it("returns correct path for vad", () => {
    expect(getResultS3Key("vid123", "vad")).toBe(
      "results/vid123/voice_activity.json",
    );
  });

  it("returns correct path for transcription", () => {
    expect(getResultS3Key("vid123", "transcription")).toBe(
      "results/vid123/speech_transcription.json",
    );
  });
});

describe("buildS3KeysIn", () => {
  it("root stage (vad) maps video input to the video S3 key", () => {
    const result = buildS3KeysIn("vad", "vid123", "videos/proj/vid123/clip.mp4");
    expect(result).toEqual({ video: "videos/proj/vid123/clip.mp4" });
  });

  it("dependent stage (mouth_energy) maps upstream result", () => {
    const result = buildS3KeysIn("mouth_energy", "vid123", "videos/proj/vid123/clip.mp4");
    expect(result).toEqual({
      facial_tracking: "results/vid123/facial_tracking.json",
    });
  });

  it("multi-input stage (intent_classification) maps all upstream results", () => {
    const result = buildS3KeysIn(
      "intent_classification",
      "vid123",
      "videos/proj/vid123/clip.mp4",
    );
    expect(result).toEqual({
      states: "results/vid123/annotations.json",
      transcription: "results/vid123/speech_transcription.json",
      vad: "results/vid123/voice_activity.json",
    });
  });

  it("diarization maps video + two upstream stages", () => {
    const result = buildS3KeysIn("diarization", "vid123", "videos/proj/vid123/clip.mp4");
    expect(result).toEqual({
      video: "videos/proj/vid123/clip.mp4",
      vad: "results/vid123/voice_activity.json",
      mouth_energy: "results/vid123/mouth_energy.json",
    });
  });
});

describe("getReadyStages", () => {
  it("all pending → returns only non-in-dev root stages", () => {
    const jobs = makeJobs("pending");
    const ready = getReadyStages(jobs);
    expect(ready).toEqual(
      expect.arrayContaining(["vad", "transcription", "facial_tracking"]),
    );
    expect(ready).toHaveLength(3);
  });

  it("root stages completed + mouth_energy pending → mouth_energy ready", () => {
    const jobs = makeJobs("pending", {
      vad: "completed",
      transcription: "completed",
      facial_tracking: "completed",
    });
    const ready = getReadyStages(jobs);
    expect(ready).toContain("mouth_energy");
  });

  it("partial deps: diarization pending but only vad completed (still needs mouth_energy) → not returned", () => {
    const jobs = makeJobs("pending", {
      vad: "completed",
    });
    const ready = getReadyStages(jobs);
    // diarization is in-dev so it would be filtered anyway, but verify
    // the dep logic: mouth_energy depends on facial_tracking which is still pending
    expect(ready).not.toContain("diarization");
    // mouth_energy also not ready since facial_tracking is pending
    expect(ready).not.toContain("mouth_energy");
  });

  it("all stages completed → empty array", () => {
    const jobs = makeJobs("completed");
    const ready = getReadyStages(jobs);
    expect(ready).toEqual([]);
  });

  it("in-development stages never returned even when deps satisfied", () => {
    // Complete all deps for diarization: vad, mouth_energy (and facial_tracking for mouth_energy)
    const jobs = makeJobs("pending", {
      vad: "completed",
      transcription: "completed",
      facial_tracking: "completed",
      mouth_energy: "completed",
    });
    const ready = getReadyStages(jobs);
    expect(ready).not.toContain("diarization");
    expect(ready).not.toContain("state_annotation");
    expect(ready).not.toContain("intent_classification");
  });

  it("stage with status 'running' is not returned", () => {
    const jobs = makeJobs("pending", { vad: "running" });
    const ready = getReadyStages(jobs);
    expect(ready).not.toContain("vad");
    // Other root stages still returned
    expect(ready).toContain("transcription");
    expect(ready).toContain("facial_tracking");
  });

  it("stage with status 'failed' is not returned", () => {
    const jobs = makeJobs("pending", { transcription: "failed" });
    const ready = getReadyStages(jobs);
    expect(ready).not.toContain("transcription");
    expect(ready).toContain("vad");
  });

  it("downstream blocked when upstream failed", () => {
    // facial_tracking failed → mouth_energy should not be ready
    const jobs = makeJobs("pending", { facial_tracking: "failed" });
    const ready = getReadyStages(jobs);
    expect(ready).not.toContain("mouth_energy");
  });

  it("empty jobs list → empty result", () => {
    expect(getReadyStages([])).toEqual([]);
  });

  it("only in-development stages pending → empty result", () => {
    const jobs: { stage: PipelineStage; status: string }[] = [
      { stage: "diarization", status: "pending" },
      { stage: "state_annotation", status: "pending" },
      { stage: "intent_classification", status: "pending" },
    ];
    expect(getReadyStages(jobs)).toEqual([]);
  });

  it("cancelled stage is not returned and blocks dependents", () => {
    const jobs = makeJobs("pending", { facial_tracking: "cancelled" });
    const ready = getReadyStages(jobs);
    expect(ready).not.toContain("facial_tracking");
    expect(ready).not.toContain("mouth_energy");
  });
});

describe("STAGE_DEPS consistency", () => {
  it("all dependency references point to valid stages", () => {
    const allStages = new Set(Object.keys(STAGE_DEPS));
    for (const [stage, deps] of Object.entries(STAGE_DEPS)) {
      for (const dep of deps) {
        expect(allStages.has(dep)).toBe(true);
      }
    }
  });

  it("no stage depends on itself", () => {
    for (const [stage, deps] of Object.entries(STAGE_DEPS)) {
      expect(deps).not.toContain(stage);
    }
  });
});
