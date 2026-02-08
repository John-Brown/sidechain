import type {
  VadResult,
  TranscriptionResult,
  DiarizationResult,
  MouthEnergyResult,
  StateAnnotationResult,
  IntentClassificationResult,
  PipelineStage,
} from '@annotation/shared';
import type { LoadStatus } from '../types.js';

export function createAnnotationDataState() {
  let vad = $state<VadResult | null>(null);
  let transcription = $state<TranscriptionResult | null>(null);
  let diarization = $state<DiarizationResult | null>(null);
  let mouthEnergy = $state<MouthEnergyResult | null>(null);
  let stateAnnotation = $state<StateAnnotationResult | null>(null);
  let intentClassification = $state<IntentClassificationResult | null>(null);

  let loadStatus = $state<Record<PipelineStage, LoadStatus>>({
    vad: 'idle',
    transcription: 'idle',
    facial_tracking: 'idle',
    mouth_energy: 'idle',
    diarization: 'idle',
    state_annotation: 'idle',
    intent_classification: 'idle',
  });

  return {
    get vad() { return vad; },
    set vad(v: VadResult | null) { vad = v; },
    get transcription() { return transcription; },
    set transcription(v: TranscriptionResult | null) { transcription = v; },
    get diarization() { return diarization; },
    set diarization(v: DiarizationResult | null) { diarization = v; },
    get mouthEnergy() { return mouthEnergy; },
    set mouthEnergy(v: MouthEnergyResult | null) { mouthEnergy = v; },
    get stateAnnotation() { return stateAnnotation; },
    set stateAnnotation(v: StateAnnotationResult | null) { stateAnnotation = v; },
    get intentClassification() { return intentClassification; },
    set intentClassification(v: IntentClassificationResult | null) { intentClassification = v; },
    get loadStatus() { return loadStatus; },
    set loadStatus(v: Record<PipelineStage, LoadStatus>) { loadStatus = v; },
  };
}

export type AnnotationDataState = ReturnType<typeof createAnnotationDataState>;
