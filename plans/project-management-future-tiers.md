# Project Management — Future Tier Features

Companion to the Tier 1 implementation (project detail page, members, guidelines, dashboard).
These features are deferred to later phases but documented here for planning continuity.

---

## Tier 2 — Phase 5 (Multi-User + QC)

### Pipeline Configuration Per Project
- Admin UI to enable/disable specific pipeline stages per project
- Model selection per stage (e.g., whisper-large-v3 vs whisper-medium for transcription)
- Processing priority (high/normal/low) for queue ordering
- Custom stage parameters (e.g., VAD sensitivity threshold, transcription language)
- Schema: add `settings JSONB` column to projects (extensible, avoids schema churn)
- Type: `ProjectSettings` in `@annotation/shared` with typed sub-objects per concern

### QC Settings
- Review required toggle per task type (`verify_states`, `verify_intents`, `tag_backchannels`)
- Minimum inter-annotator agreement threshold (Cohen's kappa for categories, boundary IoU for temporal)
- Double-annotation sampling rate (e.g., 20% of tasks get assigned to 2 annotators)
- Rejection auto-reassignment (auto-reassign rejected tasks to original or different annotator)
- Configurable via project settings UI, stored in `settings` JSONB

### Task Assignment Configuration
- Auto vs manual assignment mode
- Annotator capacity limits (max concurrent tasks per annotator)
- Deadline enforcement (due dates on tasks, overdue alerts)
- Skill-based routing (annotator proficiency tags, match to task type)
- Workload balancing algorithm (round-robin, least-loaded, etc.)

### Invitation System
- Email invites for users who haven't signed up yet
- `project_invitations` table: `id, projectId, email, role, invitedBy, status (pending/accepted/expired), createdAt, expiresAt`
- Invite link flow: generate unique token, email via Supabase/SendGrid, accept on signup
- Pending invites UI in member management tab
- Auto-add to project when invited user signs up (webhook or login-time check)

### Guidelines Versioning
- `project_guidelines_versions` table: `id, projectId, version, content, updatedBy, createdAt`
- Diff view between versions (lightweight text diff)
- Annotator "seen" tracking: `guidelines_seen` table tracks which version each annotator last acknowledged
- Banner in task view when guidelines have been updated since last seen
- Rollback capability (restore previous version as current)

---

## Tier 3 — Phase 6+ (Polish + Scale)

### Label Taxonomy Editor
- Custom category definitions per project
- Extend beyond default state categories (speaking/listening) and intent types
- Tree-structured taxonomy with parent/child relationships
- Color assignments per category (for timeline rendering)
- Import/export taxonomy definitions (JSON format)
- Schema: `project_taxonomies` table or nested in `settings` JSONB
- Validation: task submission checks annotations against project taxonomy

### Export Presets
- Named export configurations per project
- Output format selection: Sidechain JSON, COCO-temporal, custom CSV, raw JSONB dump
- Field selection: which annotation types to include
- Time format: seconds, milliseconds, timecode (HH:MM:SS.mmm)
- Destination: S3 path, direct download, webhook POST
- Filter: by video status, date range, annotation approval status
- Scheduled exports (cron-style, e.g., nightly export of newly approved annotations)

### Project Templates
- Clone settings, guidelines, taxonomy, QC config from one project to another
- Template library (save project config as reusable template)
- Onboarding flow: "Start from template" option in project creation

### Project Archiving
- Project lifecycle: active → paused → completed → archived
- Archived projects become read-only (no new uploads, edits, or tasks)
- Data retention policies per project (how long to keep S3 data)
- S3 lifecycle rules: move archived project data to Intelligent-Tiering / Glacier
- Bulk operations: archive all completed projects older than N days

### Analytics Dashboard
- Processing throughput: videos processed per day/week, stage completion times
- Cost tracking: estimated Modal compute cost per project (based on stage GPU usage)
- Annotator productivity: tasks/hour, edit count distributions, time-spent histograms
- Quality metrics: rejection rate per annotator, inter-annotator agreement trends
- Bottleneck identification: which stage is the slowest, which task type has most rejections
- Exportable reports (CSV/PDF)

### Audit Log UI
- Browse `annotation_edits` within project scope
- Filter by: user, edit type, date range, video, annotation type
- Timeline visualization of edit activity
- Undo/revert individual edits from the audit log (admin only)
- Export audit trail for compliance/research documentation

---

## Priority Ranking (Within Tier 2)

If building Tier 2 incrementally, this is the recommended order:

1. **Task assignment config** — direct prerequisite for Phase 5 multi-user workflows
2. **QC settings** — enables supervisor review gates
3. **Pipeline configuration** — less urgent since stages are relatively stable
4. **Invitation system** — needed for onboarding external annotators
5. **Guidelines versioning** — nice-to-have, basic guidelines (Tier 1) is sufficient for a while

---

## Schema Evolution Notes

The recommended approach for Tier 2 settings is a single `settings JSONB` column on `projects` with a typed interface:

```typescript
interface ProjectSettings {
  pipeline?: {
    enabledStages?: PipelineStage[];
    stageConfig?: Partial<Record<PipelineStage, Record<string, unknown>>>;
    processingPriority?: 'high' | 'normal' | 'low';
  };
  qc?: {
    reviewRequired?: Partial<Record<TaskType, boolean>>;
    minAgreementThreshold?: number;
    doubleAnnotationRate?: number;
    autoReassignRejected?: boolean;
  };
  taskAssignment?: {
    mode?: 'manual' | 'auto';
    maxConcurrentPerAnnotator?: number;
    defaultDeadlineDays?: number;
  };
}
```

This avoids a migration for every new setting and keeps the schema stable while the feature set iterates.
