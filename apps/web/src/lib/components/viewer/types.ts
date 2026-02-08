export interface Viewport {
  scrollLeft: number;
  zoom: number;
  duration: number;
  containerWidth: number;
}

export interface TrackConfig {
  label: string;
  type: 'canvas' | 'dom';
  height: number;
}

export type LoadStatus = 'idle' | 'loading' | 'loaded' | 'error' | 'unavailable';
