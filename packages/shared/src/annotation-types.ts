// --- Temporal primitives ---

export interface TimeRange {
  start: number;
  end: number;
}

// --- VAD ---

/** Per-frame speech probability (used for timeline visualization). */
export interface VadFrame {
  time_range: TimeRange;
  speech_probability: number;
}

/** Speech segment detected by VAD (contiguous speech region above threshold). */
export interface VadSegment {
  time_range: TimeRange;
  confidence: number;
}

export interface VadResult {
  metadata: AnnotationMetadata & {
    algorithm: AlgorithmInfo & {
      window_size_ms: number;
      hop_size_ms: number;
      sample_rate: number;
      threshold: number;
    };
    total_segments: number;
    speech_ratio: number;
  };
  segments: VadSegment[];
  frames: VadFrame[];
}

// --- Speech Transcription ---

export interface SpeechWord {
  time_range: TimeRange;
  speech: {
    word: string;
    speaker: string;
    confidence: number;
    speech_segment: number;
  };
}

export interface TranscriptionResult {
  metadata: AnnotationMetadata;
  data: SpeechWord[];
}

// --- Diarization ---

export interface DiarizationSegment {
  time_range: TimeRange;
  diarization: {
    speaker: string;
  };
}

export interface DiarizationResult {
  metadata: AnnotationMetadata & {
    requested_speakers: number | null;
    detected_speakers: number;
    visible_speaker_probability: Record<string, number | null>;
    visible_speaker_detection_status: string;
    audio_channel_speaker_probability: Record<
      string,
      Record<string, number>
    >;
    audio_channel_detection_status: string;
    speaker_timing_metadata: Record<
      string,
      {
        total_duration_secs: number;
        turn_count: number;
        avg_turn_duration_secs: number;
      }
    >;
  };
  data: DiarizationSegment[];
}

// --- Facial Tracking ---

export interface FacialTrackingFrame {
  time: number;
  facial_tracking: {
    tracking: {
      blendshapes: number[];
      head_pose: {
        rotation: [number, number, number];
        translation: [number, number, number];
      };
      gaze_direction: [number, number, number];
      landmarks: [number, number, number][];
      confidence: number;
      face_detected: boolean;
    };
  };
}

export interface MeshKeyframe {
  time: number;
  vertices: [number, number, number][];
  depth: number[];
  face_detected: boolean;
}

export interface MeshTopology {
  tessellation: [number, number][];
  contours: [number, number][];
  irises: [number, number][];
}

export interface DepthEstimationInfo {
  model: string;
  encoder: string;
  sample_rate_hz: number;
}

export interface FacialTrackingResult {
  metadata: AnnotationMetadata & {
    video_width: number;
    video_height: number;
    mesh_topology?: MeshTopology;
    depth_estimation?: DepthEstimationInfo;
  };
  data: FacialTrackingFrame[];
  mesh_keyframes?: MeshKeyframe[];
}

// --- Mouth Energy ---

export interface MouthEnergySegment {
  time_range: TimeRange;
  mouth_energy: {
    blend_shape_energy: Record<
      string,
      { raw_value: number; deviation: number }
    >;
    mouth_energy: number;
  };
}

export interface MouthEnergyResult {
  metadata: AnnotationMetadata;
  data: MouthEnergySegment[];
}

// --- State Annotations ---

export type StateCategory =
  | "expression.state.speaking"
  | "expression.state.listening";

export interface StateAnnotation {
  time_range: TimeRange;
  category: StateCategory;
  note: string;
  parameters: Record<string, unknown>;
}

export interface StateAnnotationResult {
  metadata: AnnotationMetadata;
  data: StateAnnotation[];
}

// --- Intent Classification ---

export type IntentType =
  | "engage"
  | "inform"
  | "inquire"
  | "challenge"
  | "comfort"
  | "celebrate";

export type IntentIntensity = "low" | "moderate" | "high";

export type IntentValence = "positive" | "neutral" | "negative";

export interface IntentAnnotation {
  time_range: TimeRange;
  intent_classification: {
    intent: IntentType;
    intensity: IntentIntensity;
    valence: IntentValence;
    confidence: number;
    reasoning: string;
  };
}

export interface IntentClassificationResult {
  metadata: AnnotationMetadata;
  data: IntentAnnotation[];
}

// --- Backchannel Annotations ---

export type BackchannelType =
  | "acknowledgment"
  | "agreement"
  | "surprise"
  | "encouragement"
  | "laughter";

export interface BackchannelAnnotation {
  time_range: TimeRange;
  backchannel: {
    type: BackchannelType;
    speaker: string;
    note: string;
  };
}

export interface BackchannelResult {
  metadata: AnnotationMetadata;
  data: BackchannelAnnotation[];
}

// --- User Labels ---

export interface UserLabel {
  time_range: TimeRange;
  text: string;
}

export interface UserLabelResult {
  metadata: AnnotationMetadata;
  data: UserLabel[];
}

// --- Waveform Peaks ---

export interface WaveformPeaksResult {
  metadata: AnnotationMetadata;
  peaks_l: number[];
  peaks_r: number[] | null;
  sample_rate: number;
  max_peak: number;
  duration: number;
}

// --- Shared metadata types ---

export interface AlgorithmInfo {
  name: string;
  model?: string;
  version?: string;
  processing_time: number;
  parameters?: Record<string, unknown>;
}

export interface AnnotationMetadata {
  source_file: string;
  format_version: string;
  created_timestamp: string;
  total_secs: number;
  algorithm: AlgorithmInfo;
}

// --- Union of all annotation data stored in JSONB ---

export type AnnotationData =
  | { type: "state"; data: StateAnnotation[] }
  | { type: "intent"; data: IntentAnnotation[] }
  | { type: "backchannel"; data: BackchannelAnnotation[] }
  | { type: "transcription"; data: SpeechWord[] }
  | { type: "session_bounds"; data: TimeRange[] }
  | { type: "user_labels"; data: UserLabel[] };
