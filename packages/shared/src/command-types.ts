import type { TimeRange } from './annotation-types.js';
import type { AnnotationSetType, EditType } from './pipeline-types.js';

// --- Semantic Targeting ---

export type TargetFilter = {
  minDuration?: number;
  maxDuration?: number;
  category?: string;
  confidence?: { below?: number; above?: number };
};

export type AnnotationTarget =
  | { by: 'index'; annotationType: AnnotationSetType; index: number }
  | { by: 'id'; annotationId: string }
  | { by: 'time'; annotationType: AnnotationSetType; time: number }
  | { by: 'timeRange'; annotationType: AnnotationSetType; range: TimeRange }
  | { by: 'selected' }
  | { by: 'query'; annotationType: AnnotationSetType; filter: TargetFilter };

// --- Commands ---

export type AnnotationCommand =
  | { action: 'select'; target: AnnotationTarget }
  | { action: 'create'; annotationType: AnnotationSetType; timeRange: TimeRange; fields: Record<string, unknown> }
  | { action: 'resize'; target: AnnotationTarget; timeRange: TimeRange }
  | { action: 'delete'; target: AnnotationTarget }
  | { action: 'split'; target: AnnotationTarget; splitTime: number }
  | { action: 'merge'; targets: [AnnotationTarget, AnnotationTarget] }
  | { action: 'classify'; target: AnnotationTarget; fields: Record<string, unknown> }
  | { action: 'confirm'; target: AnnotationTarget }
  | { action: 'bulk'; commands: AnnotationCommand[] };

// --- Results ---

export type CommandResult =
  | { ok: true; changed: { type: AnnotationSetType; indices: number[] }; description: string }
  | { ok: false; error: string; suggestedFix?: string };

// --- Task Constraints ---

export interface TaskConstraints {
  editableTypes: AnnotationSetType[];
  allowedCategories?: string[];
  lockedTimeRanges?: TimeRange[];
  allowedOperations?: EditType[];
}
