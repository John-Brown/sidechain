/**
 * Theme-aware colors for canvas drawing (draw-functions.ts, mesh-overlay.ts,
 * the timeline overview). Canvas code must take every color from here.
 * Values mirror the Deco Parchment tokens in app.css and the --hue-* data
 * palette in viewer.css; keep the three in sync.
 */
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

	// Diarization speakers (canvas): bg = tint, border = solid hue (left bar + label)
	speaker0: { bg: string; border: string };
	speaker1: { bg: string; border: string };
	speakerDefault: { bg: string; border: string };

	// Mesh overlay
	meshWireframe: string;
	/** 8-step warm ramp, near → far: ink-blue → sage → ochre → brick. */
	meshDepth: string[];
	meshIris: string;

	// Review / task / overview (canvas)
	/** Locked-range hatch stroke (neutral ink, not an error color). */
	lockHatch: string;
	/** Low-confidence tick marks (overview, queue). */
	lowConfMarker: string;
	/** Current-window outline in the timeline overview. */
	overviewWindow: string;
	/** Current-window fill in the timeline overview (the accent-bg wash: Day 5%, Night 10%). */
	overviewWindowBg: string;
}

export const PALETTE_LIGHT: ViewerPalette = {
	bg: '#f5f0e8',
	surface: '#faf7f2',
	surface2: '#ede7db',
	border: '#c9bfb0',
	text: '#2a2520',
	textDim: '#6b5f54',
	accent: '#1a6b5a',
	playhead: '#b5391f',

	gridMajor: '#9a8e82',
	gridMinor: '#c9bfb0',
	centerLine: 'rgba(201, 191, 176, 0.6)',
	rulerLabel: '#6b5f54',

	vadFill: 'rgba(107, 95, 84, 0.4)',
	vadThreshold: '#a3322a',
	waveformL: 'rgba(61, 88, 115, 0.7)',
	waveformR: 'rgba(154, 69, 38, 0.7)',
	waveformMono: 'rgba(61, 88, 115, 0.6)',
	waveformCenter: '#c9bfb0',
	mouthEnergy: '#4f6b2e',
	headPitch: '#87601a',
	headYaw: '#3d5873',
	headRoll: '#71406a',

	speaker0: { bg: 'rgba(61, 88, 115, 0.1)', border: '#3d5873' },
	speaker1: { bg: 'rgba(154, 69, 38, 0.1)', border: '#9a4526' },
	speakerDefault: { bg: 'rgba(107, 95, 84, 0.1)', border: '#6b5f54' },

	meshWireframe: 'rgba(184, 134, 11, 0.85)',
	meshDepth: [
		'#3d5873', // ink-blue
		'#4a6670',
		'#57735f',
		'#687d4a', // sage
		'#857f36',
		'#a07a24', // ochre
		'#ad5a22',
		'#b5391f', // brick
	],
	meshIris: '#71406a',

	lockHatch: 'rgba(42, 37, 32, 0.07)',
	lowConfMarker: '#2a2520',
	overviewWindow: '#1a6b5a',
	overviewWindowBg: 'rgba(26, 107, 90, 0.05)',
};

export const PALETTE_DARK: ViewerPalette = {
	bg: '#1c1814',
	surface: '#242019',
	surface2: '#2e2821',
	border: '#4a4034',
	text: '#f0e9dd',
	textDim: '#b5a795',
	accent: '#3fa78d',
	playhead: '#f07a5a',

	gridMajor: '#7f7264',
	gridMinor: '#4a4034',
	centerLine: 'rgba(74, 64, 52, 0.7)',
	rulerLabel: '#b5a795',

	vadFill: 'rgba(181, 167, 149, 0.45)',
	vadThreshold: '#ec8373',
	waveformL: 'rgba(143, 176, 207, 0.7)',
	waveformR: 'rgba(227, 145, 112, 0.7)',
	waveformMono: 'rgba(143, 176, 207, 0.6)',
	waveformCenter: '#4a4034',
	mouthEnergy: '#a9c47f',
	headPitch: '#dcb060',
	headYaw: '#8fb0cf',
	headRoll: '#c99bc0',

	speaker0: { bg: 'rgba(143, 176, 207, 0.16)', border: '#8fb0cf' },
	speaker1: { bg: 'rgba(227, 145, 112, 0.16)', border: '#e39170' },
	speakerDefault: { bg: 'rgba(181, 167, 149, 0.16)', border: '#b5a795' },

	meshWireframe: 'rgba(212, 160, 42, 0.85)',
	meshDepth: [
		'#8fb0cf', // ink-blue
		'#98b8b8',
		'#a2c09c',
		'#b4c786', // sage
		'#cabd6c',
		'#dcb060', // ochre
		'#e69560',
		'#f07a5a', // brick
	],
	meshIris: '#c99bc0',

	lockHatch: 'rgba(240, 233, 221, 0.1)',
	lowConfMarker: '#f0e9dd',
	overviewWindow: '#3fa78d',
	overviewWindowBg: 'rgba(63, 167, 141, 0.1)',
};
