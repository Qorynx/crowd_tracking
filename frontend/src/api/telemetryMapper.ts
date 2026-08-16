import type { LiveStreamTelemetry } from '../types/analytics';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? (value as UnknownRecord) : {};
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Convert the backend telemetry envelope into the frontend view model. */
export function mapLiveStreamTelemetry(payload: UnknownRecord): LiveStreamTelemetry {
  const liveStream = asRecord(payload.live_stream ?? payload);
  const runtime = asRecord(payload.runtime);
  const endToEndTiming = asRecord(liveStream.end_to_end_ms);
  const configuredCadenceMs = asFiniteNumber(liveStream.configured_cadence_ms);
  const aiUpdateRate = asFiniteNumber(payload.ai_update_rate_hz)
    ?? (configuredCadenceMs && configuredCadenceMs > 0 ? 1_000 / configuredCadenceMs : undefined);

  return {
    received_frames: asFiniteNumber(liveStream.frames_received),
    processed_frames: asFiniteNumber(liveStream.frames_processed),
    replaced_frames: asFiniteNumber(liveStream.frames_dropped_replaced),
    pending_frames: asFiniteNumber(liveStream.pending_frames),
    camera_fps: asFiniteNumber(payload.camera_fps),
    ai_update_rate_hz: aiUpdateRate,
    processing_fps: asFiniteNumber(payload.processing_fps) ?? asFiniteNumber(runtime.processing_fps),
    latency_p50_ms: asFiniteNumber(endToEndTiming.p50),
    latency_p95_ms: asFiniteNumber(endToEndTiming.p95),
  };
}
