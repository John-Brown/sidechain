import type {
  VadResult,
  TranscriptionResult,
  DiarizationResult,
  FacialTrackingResult,
  MouthEnergyResult,
  StateAnnotationResult,
  IntentClassificationResult,
  PipelineStage,
} from '@annotation/shared';
import type { LoadStatus } from '../types.js';

export class AnnotationDataState {
  vad = $state<VadResult | null>(null);
  transcription = $state<TranscriptionResult | null>(null);
  diarization = $state<DiarizationResult | null>(null);
  facialTracking = $state<FacialTrackingResult | null>(null);
  mouthEnergy = $state<MouthEnergyResult | null>(null);
  stateAnnotation = $state<StateAnnotationResult | null>(null);
  intentClassification = $state<IntentClassificationResult | null>(null);

  loadStatus = $state<Record<PipelineStage, LoadStatus>>({
    vad: 'idle',
    transcription: 'idle',
    facial_tracking: 'idle',
    mouth_energy: 'idle',
    diarization: 'idle',
    state_annotation: 'idle',
    intent_classification: 'idle',
  });
}
