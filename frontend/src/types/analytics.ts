export type PageType = 'overview' | 'live' | 'analytics' | 'room' | 'system' | 'video';

export type LabelMode = 'minimal' | 'debug';

export interface OverlayOptions {
  boxes: boolean;
  ids: boolean;
  attributes: boolean;
  motion: boolean;
  zones: boolean;
  seats: boolean;
  trajectory: boolean;
}

export interface PersonDetection {
  id: string;
  tracker_id?: string;
  bbox: [number, number, number, number]; // [x1, y1, x2, y2]
  label?: string;
  attribute?: 'male' | 'female' | 'unknown';
  confidence?: number;
  motion?: 'moving' | 'stationary';
}

export interface ZoneData {
  name: string;
  peopleCount: number;
  density: number; // people/m2
  avgDwellTime: string; // e.g. "14m 02s"
  percentage: number;
}

export interface SeatData {
  id: string;
  row: number;
  col: number;
  section: 'left' | 'center' | 'right';
  status: 'vacant' | 'occupied' | 'disabled';
  personId?: string;
}

export interface SessionInfo {
  id: string;
  mode: string;
  created_at: string;
  camera_id: string | null;
  last_used_at?: string;
  expires_in_seconds?: number | null;
  status?: string;
}

export interface LiveStreamTelemetry {
  received_frames?: number;
  processed_frames?: number;
  replaced_frames?: number;
  pending_frames?: number;
  camera_fps?: number;
  current_fps?: number;
  ai_update_rate_hz?: number;
  processing_fps?: number;
  latency_p50_ms?: number;
  latency_p95_ms?: number;
  detector_model?: string;
  tracker_type?: string;
  detector_ready?: boolean;
  tracker_ready?: boolean;
  attributes_ready?: boolean;
}

export interface AnalyticsData {
  total_crowd: number;
  occupancy_rate: number | null; // e.g., 0.81 for 81%, null when no formal capacity
  density_per_m2: number | null; // e.g. 0.41 or null if uncalibrated
  seats_occupied: number | null;
  total_seats: number;
  moving_count: number;
  stationary_count: number;
  flow_in: number;
  flow_out: number;
  net_flow: number;
  flow_in_per_minute: number;
  flow_out_per_minute: number;
  net_flow_per_minute: number;
  visual_presentation: {
    female_presenting: number;
    male_presenting: number;
    unknown: number;
    coverage_pct: number;
  };
  space_distribution: {
    front_pct: number;
    middle_pct: number;
    back_pct: number;
  };
  zones: ZoneData[];
  spatial?: Record<string, any>;
  classroom?: Record<string, any>;
  crowd?: Record<string, any>;
  trajectory?: Record<string, any>;
  crossing?: Record<string, any>;
  history?: Record<string, any>;
  room_area_m2?: number | null;
  room_capacity?: number | null;
  occupancy_calibrated?: boolean;
  seat_occupancy_calibrated?: boolean;
}
