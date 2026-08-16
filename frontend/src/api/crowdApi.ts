import type {
  ApiErrorEnvelope,
  FrameResponse,
  HealthResponse,
  ReadyResponse,
  SessionEnvelope,
  SessionCalibrationRequest,
  SessionConfigurationResponse,
  SessionLayoutRequest,
  SessionStatsResponse,
  VideoAnalysisResponse,
  WebRTCOfferResponse,
  WarmupStatusResponse,
} from './contracts';

const getBaseUrl = () => {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL.replace(/\/$/, '');
  }
  if (typeof window !== 'undefined') {
    return window.location.origin.replace(/\/$/, '');
  }
  return '';
};

const API_BASE = `${getBaseUrl()}/api/v1`;
const DEFAULT_TIMEOUT_MS = 15_000;

export class CrowdApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly payload: unknown;

  constructor(status: number, code: string, message: string, payload?: unknown) {
    super(message);
    this.name = 'CrowdApiError';
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof CrowdApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return await response.text();
  return await response.json();
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const externalSignal = init.signal;
  const abortExternalRequest = () => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', abortExternalRequest, { once: true });
    }
  }

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      cache: init.cache ?? 'no-store',
    });
    const payload = await parseResponseBody(response);
    if (!response.ok) {
      const errorPayload = payload as ApiErrorEnvelope | undefined;
      const detail = errorPayload?.detail;
      throw new CrowdApiError(
        response.status,
        detail?.code || `http_${response.status}`,
        detail?.message || `Request failed with HTTP ${response.status}.`,
        payload,
      );
    }
    return payload as T;
  } catch (error) {
    if (error instanceof CrowdApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new CrowdApiError(
        timedOut ? 408 : 499,
        timedOut ? 'request_timeout' : 'request_aborted',
        timedOut ? 'The API request timed out.' : 'The API request was cancelled.',
      );
    }
    throw new CrowdApiError(0, 'network_error', 'The API could not be reached.', error);
  } finally {
    globalThis.clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', abortExternalRequest);
  }
}

export function createSession(mode = 'default', cameraId?: string): Promise<SessionEnvelope> {
  return requestJson<SessionEnvelope>('/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, camera_id: cameraId }),
  });
}

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return requestJson<HealthResponse>('/health', { signal });
}

export function getReadiness(signal?: AbortSignal): Promise<ReadyResponse> {
  return requestJson<ReadyResponse>('/ready', { signal });
}

export function startWarmup(mode = 'default'): Promise<WarmupStatusResponse> {
  return requestJson<WarmupStatusResponse>('/warmup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  }, 15_000);
}

export function getWarmupStatus(mode = 'default', signal?: AbortSignal): Promise<WarmupStatusResponse> {
  return requestJson<WarmupStatusResponse>(`/warmup?mode=${encodeURIComponent(mode)}`, { signal }, 10_000);
}

export function getSessionStats(sessionId: string, signal?: AbortSignal): Promise<SessionStatsResponse> {
  return requestJson<SessionStatsResponse>(`/sessions/${encodeURIComponent(sessionId)}/stats`, { signal });
}

export function submitFrame(
  sessionId: string,
  imageBlob: Blob,
  afterSequence?: number,
  signal?: AbortSignal,
): Promise<FrameResponse> {
  const query = afterSequence == null ? '' : `?after_sequence=${encodeURIComponent(afterSequence)}`;
  const formData = new FormData();
  formData.append('file', imageBlob, 'frame.jpg');
  return requestJson<FrameResponse>(`/sessions/${encodeURIComponent(sessionId)}/frame${query}`, {
    method: 'POST',
    body: formData,
    signal,
  });
}

export function resetSession(sessionId: string): Promise<SessionEnvelope> {
  return requestJson<SessionEnvelope>(`/sessions/${encodeURIComponent(sessionId)}/reset`, {
    method: 'POST',
  });
}

export function deleteSession(sessionId: string): Promise<void> {
  return requestJson<void>(`/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
}

export function updateSessionLayout(
  sessionId: string,
  sessionLayout: SessionLayoutRequest['session_layout'],
  signal?: AbortSignal,
): Promise<SessionConfigurationResponse> {
  return requestJson<SessionConfigurationResponse>(`/sessions/${encodeURIComponent(sessionId)}/layout`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_layout: sessionLayout } satisfies SessionLayoutRequest),
    signal,
  });
}

export function updateSessionCalibration(
  sessionId: string,
  calibration: SessionCalibrationRequest['calibration'],
  signal?: AbortSignal,
): Promise<SessionConfigurationResponse> {
  return requestJson<SessionConfigurationResponse>(`/sessions/${encodeURIComponent(sessionId)}/calibration`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ calibration } satisfies SessionCalibrationRequest),
    signal,
  });
}

export function createWebRTCOffer(
  sdp: string,
  type: 'offer' = 'offer',
  mode: 'default' | 'classroom_demo' = 'default',
  cameraId?: string,
  signal?: AbortSignal,
): Promise<WebRTCOfferResponse> {
  return requestJson<WebRTCOfferResponse>('/webrtc/offer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sdp, type, mode, camera_id: cameraId }),
    signal,
  });
}

export function analyzeVideo(file: File, mode = 'default', signal?: AbortSignal): Promise<VideoAnalysisResponse> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('mode', mode);
  return requestJson<VideoAnalysisResponse>('/video/analyze', {
    method: 'POST',
    body: formData,
    signal,
  });
}
