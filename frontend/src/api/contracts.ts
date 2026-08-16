export type AnalyticsPayload = Record<string, any>;
export type ApiAvailability = 'checking' | 'ready' | 'not_ready' | 'offline';

export interface SessionMetadata {
  id: string;
  mode: string;
  camera_id: string | null;
  created_at: string;
  last_used_at: string;
  expires_in_seconds: number | null;
  status: string;
}

export interface SessionEnvelope {
  status: 'created' | 'active' | 'reset';
  session: SessionMetadata;
}

export interface FrameMetadata {
  sequence: number;
  submitted_monotonic_seconds: number;
  completed_monotonic_seconds: number;
}

export interface OverlayTrack {
  track_id: number;
  person_id: number | null;
  label?: string;
  bbox: [number, number, number, number];
  gender?: string;
  source?: string;
  confidence?: number;
  motion?: {
    direction?: string;
    speed_reference_px_per_second?: number;
    stationary?: boolean;
    dwell_seconds?: number;
    [key: string]: any;
  };
  trajectory?: Array<[number, number]>;
}

export interface OverlayZone {
  name: string;
  polygon: Array<[number, number]>;
  current_count?: number;
}

export interface OverlaySeat {
  seat_id: string;
  status: string;
  polygon: Array<[number, number]>;
}

export interface FrameOverlay {
  coordinate_space?: string;
  frame_size?: [number, number];
  tracks?: OverlayTrack[];
  zones?: OverlayZone[];
  seats?: OverlaySeat[];
  [key: string]: any;
}

export interface SessionStatsResponse {
  status: 'ready' | 'waiting_for_frame';
  session: SessionMetadata;
  frame: FrameMetadata | null;
  analytics: AnalyticsPayload | null;
  live_stream: Record<string, any>;
}

export interface SessionLayoutRequest {
  session_layout: {
    room_profile?: string;
    template: string;
    rows: number;
    disabled_seats: Array<{ row: number; block: string; column: number }>;
  };
}

export interface SessionCalibrationRequest {
  calibration: {
    floor_points_px: Array<[number, number]>;
    floor_points_m: Array<[number, number]>;
    maximum_error_cm?: number;
  };
}

export interface SessionConfigurationResponse {
  status: 'updated';
  session: SessionMetadata;
  classroom: Record<string, any>;
}

export interface FrameResponse {
  status: 'accepted';
  sequence: number;
  result_sequence: number | null;
  analytics: AnalyticsPayload | null;
  overlay: FrameOverlay | null;
}

export interface HealthResponse {
  status: 'ok';
  service: string;
  sessions: Record<string, any>;
}

export interface ReadyResponse {
  status: 'ready' | 'not_ready';
  service: string;
  ready: boolean;
  model_initialization?: string;
  modes: Record<string, any>;
  missing_model_assets: Array<Record<string, any>>;
  [key: string]: any;
}

export interface WarmupStatusResponse {
  status: 'idle' | 'warming' | 'tracking_ready' | 'ready' | 'failed' | 'blocked' | 'in_use';
  mode: string;
  progress: number;
  stage: string;
  message: string;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  elapsed_seconds: number | null;
  cached: boolean;
  active_sessions: number;
  detector_ready: boolean;
  tracker_ready: boolean;
  attributes_ready: boolean;
}

export interface VideoAnalysisResponse {
  status: 'completed';
  mode: string;
  input: Record<string, any>;
  performance: Record<string, any>;
  analytics: AnalyticsPayload;
  artifacts: Record<string, any>;
}

export interface WebRTCOfferResponse {
  session_id: string;
  sdp: string;
  type: 'answer';
  mode: 'default' | 'classroom_demo';
  ice_mode: 'non_trickle';
  expires_in_seconds: number | null;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
}

export interface ApiErrorEnvelope {
  detail: ApiErrorDetail;
}
