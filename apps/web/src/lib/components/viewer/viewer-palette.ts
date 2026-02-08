export interface ViewerPalette {
	// Chrome
	bg: string;
	surface: string;
	surface2: string;
	border: string;
	text: string;
	textDim: string;
	accent: string;
	playhead: string;

	// Grid/reference (canvas)
	gridMajor: string;
	gridMinor: string;
	centerLine: string;
	rulerLabel: string;

	// Data (canvas)
	vadFill: string;
	vadThreshold: string;
	waveformL: string;
	waveformR: string;
	waveformMono: string;
	waveformCenter: string;
	mouthEnergy: string;
	headPitch: string;
	headYaw: string;
	headRoll: string;

	// Diarization speakers (canvas)
	speaker0: { bg: string; border: string };
	speaker1: { bg: string; border: string };
	speakerDefault: { bg: string; border: string };
}

export const PALETTE_DARK: ViewerPalette = {
	bg: '#0f1117',
	surface: '#1a1d27',
	surface2: '#242836',
	border: '#2e3345',
	text: '#e1e4ed',
	textDim: '#8b90a0',
	accent: '#6366f1',
	playhead: '#ef4444',

	gridMajor: '#4a5068',
	gridMinor: '#2e3345',
	centerLine: 'rgba(46, 51, 69, 0.5)',
	rulerLabel: '#8b90a0',

	vadFill: 'rgba(99, 102, 241, 0.6)',
	vadThreshold: 'rgba(239, 68, 68, 0.4)',
	waveformL: 'rgba(34, 211, 238, 0.5)',
	waveformR: 'rgba(244, 114, 182, 0.5)',
	waveformMono: 'rgba(99, 102, 241, 0.5)',
	waveformCenter: '#2e3345',
	mouthEnergy: 'rgba(52, 211, 153, 0.8)',
	headPitch: 'rgba(245, 158, 11, 0.8)',
	headYaw: 'rgba(99, 102, 241, 0.8)',
	headRoll: 'rgba(52, 211, 153, 0.8)',

	speaker0: { bg: 'rgba(34, 211, 238, 0.3)', border: 'rgba(34, 211, 238, 0.6)' },
	speaker1: { bg: 'rgba(244, 114, 182, 0.3)', border: 'rgba(244, 114, 182, 0.6)' },
	speakerDefault: { bg: 'rgba(100, 116, 139, 0.2)', border: 'rgba(100, 116, 139, 0.4)' },
};

export const PALETTE_LIGHT: ViewerPalette = {
	bg: '#ffffff',
	surface: '#f4f5f7',
	surface2: '#ebedf0',
	border: '#d4d8e0',
	text: '#1a1a2e',
	textDim: '#64748b',
	accent: '#6366f1',
	playhead: '#ef4444',

	gridMajor: '#94a3b8',
	gridMinor: '#cbd5e1',
	centerLine: 'rgba(148, 163, 184, 0.4)',
	rulerLabel: '#64748b',

	vadFill: 'rgba(79, 70, 229, 0.45)',
	vadThreshold: 'rgba(220, 38, 38, 0.3)',
	waveformL: 'rgba(8, 145, 178, 0.55)',
	waveformR: 'rgba(219, 39, 119, 0.5)',
	waveformMono: 'rgba(79, 70, 229, 0.45)',
	waveformCenter: 'rgba(148, 163, 184, 0.4)',
	mouthEnergy: 'rgba(5, 150, 105, 0.85)',
	headPitch: 'rgba(217, 119, 6, 0.85)',
	headYaw: 'rgba(79, 70, 229, 0.85)',
	headRoll: 'rgba(5, 150, 105, 0.85)',

	speaker0: { bg: 'rgba(8, 145, 178, 0.15)', border: 'rgba(8, 145, 178, 0.5)' },
	speaker1: { bg: 'rgba(219, 39, 119, 0.12)', border: 'rgba(219, 39, 119, 0.45)' },
	speakerDefault: { bg: 'rgba(71, 85, 105, 0.08)', border: 'rgba(71, 85, 105, 0.3)' },
};
