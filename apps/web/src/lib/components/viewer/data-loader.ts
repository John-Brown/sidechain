/**
 * Data loading module for the annotation viewer.
 *
 * Extracts all tRPC data fetching, S3 result loading, annotation set loading,
 * polling, and normalization range computation from AnnotationViewer.svelte
 * into a standalone factory function.
 */

import type {
  VadResult,
  TranscriptionResult,
  DiarizationResult,
  FacialTrackingResult,
  MouthEnergyResult,
  StateAnnotationResult,
  IntentClassificationResult,
  BackchannelResult,
  WaveformPeaksResult,
  SpeechWord,
  UserLabel,
  UserLabelResult,
  AnnotationSetType,
  PipelineStage,
  StateAnnotation,
  IntentAnnotation,
  BackchannelAnnotation,
} from '@annotation/shared';

import type { AnnotationDataState } from './state/annotation-data.svelte.js';
import type { TimelineState } from './state/timeline.svelte.js';
import type { SessionState } from './state/session.svelte.js';
import type { LoadStatus } from './types.js';
import { getCachedAnnotation, setCachedAnnotation } from './utils/annotation-cache.js';
import type { ViewerFixture } from './fixtures/generate.js';

interface TRPCClient {
  videos: {
    get: { query: (input: { id: string }) => Promise<any> };
    getStreamUrl: { query: (input: { id: string }) => Promise<{ url: string }> };
  };
  processing: {
    getAllResults: { query: (input: { videoId: string }) => Promise<{ results: Record<string, unknown>; jobStatuses: { stage: string; status: string }[] }> };
    getResults: { query: (input: { videoId: string; stage: PipelineStage }) => Promise<unknown> };
    getJobStatus: { query: (input: { videoId: string }) => Promise<{ stage: string; status: string }[]> };
  };
  annotations: {
    get: { query: (input: { videoId: string; type: AnnotationSetType }) => Promise<any> };
  };
}

export interface DataLoaderDeps {
  trpc: TRPCClient;
  annotations: AnnotationDataState;
  timeline: TimelineState;
  session: SessionState;
  videoId: string;
}

/** Precompute the normalization maxima (VAD, mouth energy, waveform) from loaded data. */
export function computeDataRangesFor(annotations: AnnotationDataState): void {
  if (annotations.vad?.frames) {
    let max = 0;
    for (const frame of annotations.vad.frames) {
      if (frame.speech_probability > max) max = frame.speech_probability;
    }
    annotations.vadMax = max || 1;
  }

  if (annotations.mouthEnergy?.data) {
    let max = 0;
    for (const seg of annotations.mouthEnergy.data) {
      if (seg.mouth_energy.mouth_energy > max) max = seg.mouth_energy.mouth_energy;
    }
    annotations.mouthEnergyMax = max || 1;
  }

  if (annotations.waveform) {
    annotations.waveformMax = annotations.waveform.max_peak || 1;
  }
}

/** Precompute the head-pose normalization range (10% padding) from facial tracking. */
export function computeHeadPoseRangeFor(annotations: AnnotationDataState): void {
  if (!annotations.facialTracking?.data) return;
  let min = Infinity, max = -Infinity;
  for (const frame of annotations.facialTracking.data) {
    if (!frame.facial_tracking.tracking.face_detected) continue;
    for (const angle of frame.facial_tracking.tracking.head_pose.rotation) {
      if (angle < min) min = angle;
      if (angle > max) max = angle;
    }
  }
  if (min !== Infinity) {
    const padding = (max - min) * 0.1 || 1;
    annotations.headPoseMin = min - padding;
    annotations.headPoseMax = max + padding;
  }
}

export interface FixtureLoadDeps {
  fixture: ViewerFixture;
  annotations: AnnotationDataState;
  timeline: TimelineState;
  session: SessionState;
}

/**
 * Fill the viewer state straight from a synthetic fixture (/dev/viewer):
 * no tRPC, no S3, no DB. Every stage present in the fixture is marked loaded.
 */
export function loadFixture({ fixture, annotations, timeline, session }: FixtureLoadDeps): void {
  const d = fixture.data;
  annotations.vad = d.vad;
  annotations.transcription = d.transcription;
  annotations.diarization = d.diarization;
  annotations.facialTracking = d.facialTracking;
  annotations.mouthEnergy = d.mouthEnergy;
  annotations.stateAnnotation = d.stateAnnotation;
  annotations.intentClassification = d.intentClassification;
  annotations.backchannel = d.backchannel;
  annotations.userLabels = d.userLabels;
  annotations.waveform = d.waveform;
  annotations.latestEditTimestamp = null;

  const loaded = (present: unknown): LoadStatus => (present ? 'loaded' : 'idle');
  annotations.loadStatus = {
    vad: loaded(d.vad),
    transcription: loaded(d.transcription),
    facial_tracking: loaded(d.facialTracking),
    mouth_energy: loaded(d.mouthEnergy),
    diarization: loaded(d.diarization),
    state_annotation: loaded(d.stateAnnotation),
    intent_classification: loaded(d.intentClassification),
    waveform: loaded(d.waveform),
  };

  computeDataRangesFor(annotations);
  computeHeadPoseRangeFor(annotations);

  session.filename = fixture.filename;
  session.projectName = fixture.projectName;
  session.videoSrc = fixture.videoSrc ?? '';
  timeline.duration = fixture.duration;
}

export function createDataLoader(deps: DataLoaderDeps) {
  const { trpc, annotations, timeline, session, videoId } = deps;

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let completedAtMap: Record<string, string> = {};

  const computeDataRanges = () => computeDataRangesFor(annotations);
  const computeHeadPoseRange = () => computeHeadPoseRangeFor(annotations);

  function assignResults(results: Record<string, unknown>) {
    if (results.vad) annotations.vad = results.vad as VadResult;
    if (results.transcription) annotations.transcription = results.transcription as TranscriptionResult;
    if (results.diarization) annotations.diarization = results.diarization as DiarizationResult;
    if (results.mouth_energy) annotations.mouthEnergy = results.mouth_energy as MouthEnergyResult;
    if (results.state_annotation) annotations.stateAnnotation = results.state_annotation as StateAnnotationResult;
    if (results.intent_classification) annotations.intentClassification = results.intent_classification as IntentClassificationResult;
    if (results.waveform) annotations.waveform = results.waveform as WaveformPeaksResult;
  }

  async function loadFacialTracking() {
    const status = { ...annotations.loadStatus };
    status.facial_tracking = 'loading';
    annotations.loadStatus = status;
    try {
      const completedAt = completedAtMap['facial_tracking'];
      if (completedAt) {
        const cached = await getCachedAnnotation<FacialTrackingResult>(videoId, 'facial_tracking', completedAt);
        if (cached) {
          console.log('[viewer] facial_tracking loaded from cache');
          annotations.facialTracking = cached;
          annotations.loadStatus = { ...annotations.loadStatus, facial_tracking: 'loaded' };
          computeHeadPoseRange();
          return;
        }
      }

      const data = await trpc.processing.getResults.query({
        videoId,
        stage: 'facial_tracking',
      });
      annotations.facialTracking = data as FacialTrackingResult;
      annotations.loadStatus = { ...annotations.loadStatus, facial_tracking: 'loaded' };
      computeHeadPoseRange();

      if (completedAt) {
        setCachedAnnotation(videoId, 'facial_tracking', completedAt, data);
      }
    } catch {
      annotations.loadStatus = { ...annotations.loadStatus, facial_tracking: 'error' };
    }
  }

  async function loadAnnotationSets() {
    const editableTypes: AnnotationSetType[] = ['state', 'intent', 'transcription', 'user_labels', 'backchannel'];

    function makeMetadata() {
      return {
        source_file: '',
        format_version: '1.0',
        created_timestamp: new Date().toISOString(),
        total_secs: timeline.duration,
        algorithm: { name: 'human', model: 'manual', version: '1.0', processing_time: 0 },
      };
    }

    try {
      const results = await Promise.all(
        editableTypes.map((type) =>
          trpc.annotations.get.query({ videoId, type }).catch(() => null),
        ),
      );

      let latestTimestamp: number | null = null;

      for (let i = 0; i < editableTypes.length; i++) {
        const annotationSet = results[i];
        if (!annotationSet?.data) continue;

        const source = annotationSet.source;
        if (source !== 'human' && source !== 'supervisor_override') continue;

        // Track latest edit timestamp for draft freshness
        if (annotationSet.createdAt) {
          const ts = new Date(annotationSet.createdAt).getTime();
          if (latestTimestamp === null || ts > latestTimestamp) {
            latestTimestamp = ts;
          }
        }

        const meta = (annotationSet.metadata as Record<string, unknown>) ?? makeMetadata();
        const type = editableTypes[i];

        switch (type) {
          case 'state':
            annotations.stateAnnotation = { metadata: meta, data: annotationSet.data as StateAnnotation[] } as unknown as StateAnnotationResult;
            break;
          case 'intent':
            annotations.intentClassification = { metadata: meta, data: annotationSet.data as IntentAnnotation[] } as unknown as IntentClassificationResult;
            break;
          case 'transcription':
            annotations.transcription = { metadata: meta, data: annotationSet.data as SpeechWord[] } as unknown as TranscriptionResult;
            break;
          case 'user_labels':
            annotations.userLabels = { metadata: meta, data: annotationSet.data as UserLabel[] } as unknown as UserLabelResult;
            break;
          case 'backchannel':
            annotations.backchannel = { metadata: meta, data: annotationSet.data as BackchannelAnnotation[] } as unknown as BackchannelResult;
            break;
        }
      }

      annotations.latestEditTimestamp = latestTimestamp;
    } catch (e) {
      console.warn('[viewer] Failed to load annotation sets:', e);
    }
  }

  async function loadResults() {
    try {
      const stagesWithCache = Object.entries(completedAtMap).filter(([stage]) => stage !== 'facial_tracking');
      const cachedResults: Record<string, unknown> = {};
      let allCached = stagesWithCache.length > 0;

      for (const [stage, completedAt] of stagesWithCache) {
        const cached = await getCachedAnnotation(videoId, stage, completedAt);
        if (cached) {
          cachedResults[stage] = cached;
        } else {
          allCached = false;
        }
      }

      if (allCached && stagesWithCache.length > 0) {
        console.log('[viewer] All annotation results loaded from cache:', Object.keys(cachedResults));
        assignResults(cachedResults);
        const status = { ...annotations.loadStatus };
        for (const stage of Object.keys(cachedResults)) {
          if (stage in status) {
            (status as Record<string, string>)[stage] = 'loaded';
          }
        }
        annotations.loadStatus = status;
        computeDataRanges();
        return;
      }

      const { results, jobStatuses } = await trpc.processing.getAllResults.query({ videoId });

      console.log('[viewer] getAllResults:', {
        resultKeys: Object.keys(results),
        jobStatuses: jobStatuses.map((j: { stage: string; status: string }) => `${j.stage}:${j.status}`),
      });

      const status: Record<string, LoadStatus> = { ...annotations.loadStatus };
      for (const { stage, status: jobStatus } of jobStatuses) {
        if (stage === 'facial_tracking') continue;
        if (jobStatus === 'completed' && stage in results) {
          status[stage] = 'loaded';
        } else if (jobStatus === 'completed') {
          console.warn(`[viewer] Stage ${stage} completed but no result data — marking as error`);
          status[stage] = 'error';
        } else if (jobStatus === 'failed') {
          status[stage] = 'error';
        } else if (jobStatus === 'running' || jobStatus === 'pending') {
          status[stage] = 'loading';
        }
      }
      annotations.loadStatus = status as typeof annotations.loadStatus;
      console.log('[viewer] Final load statuses:', { ...status });

      assignResults(results);
      computeDataRanges();

      for (const [stage, data] of Object.entries(results)) {
        const completedAt = completedAtMap[stage];
        if (completedAt && data) {
          setCachedAnnotation(videoId, stage, completedAt, data);
        }
      }
    } catch (e) {
      console.error('[viewer] loadResults failed:', e);
    }
  }

  async function pollForUpdates() {
    try {
      const jobs = await trpc.processing.getJobStatus.query({ videoId });

      const hasActive = jobs.some(
        (j) => j.status === 'running' || j.status === 'pending'
      );

      const status: Record<string, LoadStatus> = { ...annotations.loadStatus };
      let hasNewCompletions = false;
      for (const job of jobs) {
        if (job.status === 'completed' && status[job.stage] !== 'loaded') {
          hasNewCompletions = true;
          status[job.stage] = 'loading';
        } else if (job.status === 'failed') {
          status[job.stage] = 'error';
        }
      }
      annotations.loadStatus = status as typeof annotations.loadStatus;

      if (hasNewCompletions) {
        await loadResults();
        if (status.facial_tracking === 'loading' && !annotations.facialTracking) {
          loadFacialTracking();
        }
      }

      if (!hasActive && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    } catch {
      // Silently ignore poll errors
    }
  }

  async function loadViewerData(): Promise<void> {
    const [videoInfo, streamInfo] = await Promise.all([
      trpc.videos.get.query({ id: videoId }),
      trpc.videos.getStreamUrl.query({ id: videoId }),
    ]);

    session.filename = videoInfo.filename;
    session.videoSrc = streamInfo.url;
    if (videoInfo.durationSecs) {
      timeline.duration = videoInfo.durationSecs;
    }

    // Build completedAt map for cache keying
    completedAtMap = {};
    for (const job of videoInfo.processingJobs) {
      if (job.status === 'completed' && job.completedAt) {
        completedAtMap[job.stage] = job.completedAt instanceof Date
          ? job.completedAt.toISOString()
          : String(job.completedAt);
      }
    }

    // Set initial load statuses from existing jobs
    let hasFacialTracking = false;
    console.log('[viewer] Processing jobs:', videoInfo.processingJobs.map((j: { stage: string; status: string }) => `${j.stage}:${j.status}`));
    for (const job of videoInfo.processingJobs) {
      const status: Record<string, LoadStatus> = { ...annotations.loadStatus };
      if (job.status === 'completed') {
        status[job.stage] = 'loading';
        if (job.stage === 'facial_tracking') hasFacialTracking = true;
      } else if (job.status === 'failed') {
        status[job.stage] = 'error';
      } else if (job.status === 'running' || job.status === 'pending') {
        status[job.stage] = 'loading';
      }
      annotations.loadStatus = status as typeof annotations.loadStatus;
    }
    console.log('[viewer] Load statuses after job scan:', { ...annotations.loadStatus });

    // Fetch all completed results (excludes facial_tracking)
    await loadResults();

    // Load human annotation sets from DB — overwrites pipeline data with human edits
    await loadAnnotationSets();

    // Lazy-load facial tracking separately (non-blocking)
    if (hasFacialTracking) {
      loadFacialTracking();
    }

    // Poll if any stages still running
    const hasActive = videoInfo.processingJobs.some(
      (j: { status: string }) => j.status === 'running' || j.status === 'pending'
    );
    if (hasActive) {
      pollTimer = setInterval(pollForUpdates, 5000);
    }
  }

  function dispose() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  return {
    loadViewerData,
    loadResults,
    loadAnnotationSets,
    loadFacialTracking,
    pollForUpdates,
    computeDataRanges,
    computeHeadPoseRange,
    dispose,
  };
}
