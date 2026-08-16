import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, Layers, Play, Pause, Settings, RefreshCw, CheckSquare, Square, AlertCircle, UserCheck, Crosshair } from 'lucide-react';
import type { LabelMode, OverlayOptions, AnalyticsData } from '../types/analytics';
import type { FrameOverlay, OverlaySeat, OverlayTrack, OverlayZone, SessionStatsResponse } from '../api/contracts';
import { CrowdApiError, createSession, createWebRTCOffer, deleteSession, getApiErrorMessage, getSessionStats, getWarmupStatus, resetSession, startWarmup, submitFrame } from '../api/crowdApi';

interface LivePageProps {
  analytics: AnalyticsData;
  onAnalyticsUpdate: (stats: any) => void;
  onTelemetryUpdate?: (telemetry: Record<string, any>) => void;
  t: any;
  onStreamingChange?: (active: boolean) => void;
  onSessionChange?: (sessionId: string | null) => void;
  addSystemLog?: (msg: string) => void;
}

interface FocusedBox {
  id: string;
  tracker: string;
  x: number;
  y: number;
  w: number;
  h: number;
  attr: string;
  confidence: string;
}

interface OverlayRenderData {
  frameSize: [number, number] | null;
  tracks: OverlayTrack[];
  zones: OverlayZone[];
  seats: OverlaySeat[];
}

type TransportMode = 'http' | 'webrtc';

const EMPTY_OVERLAY: OverlayRenderData = {
  frameSize: null,
  tracks: [],
  zones: [],
  seats: [],
};

const LIVE_MODE = 'classroom_demo' as const;
const CAMERA_PERMISSION_TIMEOUT_MS = 20_000;

type WarmupSnapshot = Awaited<ReturnType<typeof getWarmupStatus>>;

// Older API workers returned only {status: "ready"}. Keep the client
// compatible during a rolling restart while preferring the explicit staged
// flags from the current contract.
const trackerReadyFromStatus = (status: WarmupSnapshot): boolean =>
  status.tracker_ready ?? ['tracking_ready', 'ready', 'in_use'].includes(status.status);

const detectorReadyFromStatus = (status: WarmupSnapshot): boolean =>
  status.detector_ready ?? ['tracking_ready', 'ready', 'in_use'].includes(status.status);

const attributesReadyFromStatus = (status: WarmupSnapshot): boolean =>
  status.attributes_ready ?? status.status === 'ready';

type CameraRequestError = Error & { code?: string };

async function requestCameraWithTimeout(constraints: MediaStreamConstraints): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    const error: CameraRequestError = new Error('Camera is unavailable in this browser context. Open the app on HTTPS or localhost and allow camera access.');
    error.code = 'camera_unavailable';
    throw error;
  }
  let timedOut = false;
  let timeoutId: number | null = null;
  const cameraPromise = navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
    if (timedOut) {
      stream.getTracks().forEach((track) => track.stop());
      const error: CameraRequestError = new Error('Camera permission request timed out. Check browser camera permission and close any hidden prompt.');
      error.code = 'camera_permission_timeout';
      throw error;
    }
    return stream;
  });
  const timeoutPromise = new Promise<MediaStream>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      timedOut = true;
      const error: CameraRequestError = new Error('Camera permission request timed out. Check browser camera permission and close any hidden prompt.');
      error.code = 'camera_permission_timeout';
      reject(error);
    }, CAMERA_PERMISSION_TIMEOUT_MS);
  });
  try {
    return await Promise.race([cameraPromise, timeoutPromise]);
  } finally {
    if (timeoutId != null) window.clearTimeout(timeoutId);
  }
}

export const LivePage: React.FC<LivePageProps> = ({ analytics, onAnalyticsUpdate, onTelemetryUpdate, t, onStreamingChange, onSessionChange, addSystemLog }) => {
  const [labelMode, setLabelMode] = useState<LabelMode>('minimal');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isCameraLive, setIsCameraLive] = useState(false);
  const [transport, setTransport] = useState<TransportMode>('http');
  const [activeTransport, setActiveTransport] = useState<TransportMode | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [cameraFps, setCameraFps] = useState<number | null>(null);
  const [aiUpdateRateHz, setAiUpdateRateHz] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [warmupStatus, setWarmupStatus] = useState<Awaited<ReturnType<typeof getWarmupStatus>> | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<FocusedBox | null>(null);
  const [overlayData, setOverlayData] = useState<OverlayRenderData>(EMPTY_OVERLAY);

  const [overlays, setOverlays] = useState<OverlayOptions>({
    boxes: true,
    ids: true,
    attributes: true,
    motion: false,
    zones: true,
    seats: true,
    trajectory: false,
    heatmap: false,
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<any>(null);
  const statsIntervalRef = useRef<number | null>(null);
  const webRtcPeerRef = useRef<RTCPeerConnection | null>(null);
  const frameAbortControllerRef = useRef<AbortController | null>(null);
  const warmupAbortControllerRef = useRef<AbortController | null>(null);
  const isStartingRef = useRef(false);
  const lastFrameTimeRef = useRef<number>(performance.now());
  const cameraFpsRef = useRef<number | null>(null);
  const cadenceMsRef = useRef(150);
  const lastResultSequenceRef = useRef<number | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const isSendingRef = useRef<boolean>(false);
  const onStreamingChangeRef = useRef(onStreamingChange);
  const onSessionChangeRef = useRef(onSessionChange);
  const addSystemLogRef = useRef(addSystemLog);

  onStreamingChangeRef.current = onStreamingChange;
  onSessionChangeRef.current = onSessionChange;
  addSystemLogRef.current = addSystemLog;

  useEffect(() => {
    if (!captureCanvasRef.current) {
      captureCanvasRef.current = document.createElement('canvas');
    }
  }, []);

  const toggleStreaming = async () => {
    if (isStartingRef.current || isStreaming || isCameraLive) {
      stopStream();
    } else {
      await startStream();
    }
  };

  const applyWebRTCStats = (response: SessionStatsResponse) => {
    const resultSequence = response.frame?.sequence;
    if (resultSequence == null || (lastResultSequenceRef.current != null && resultSequence <= lastResultSequenceRef.current)) {
      return;
    }
    lastResultSequenceRef.current = resultSequence;
    const analytics = response.analytics;
    const overlay = (analytics?.overlay ?? {}) as FrameOverlay;
    const currentTracks = overlay.tracks ?? [];
    latestTracksRef.current = currentTracks;
    setOverlayData({
      frameSize: overlay.frame_size ?? null,
      tracks: currentTracks,
      zones: overlay.zones ?? [],
      seats: overlay.seats ?? [],
    });
    const liveStreamTelemetry = response.live_stream;
    if (liveStreamTelemetry) {
      onTelemetryUpdate?.({
        live_stream: liveStreamTelemetry,
        runtime: analytics?.runtime,
        camera_fps: cameraFpsRef.current,
      });
    }
    if (analytics) onAnalyticsUpdate(analytics);
  };

  const startWebRTCStatsPolling = (session: string) => {
    if (statsIntervalRef.current != null) window.clearInterval(statsIntervalRef.current);
    const poll = async () => {
      if (activeSessionIdRef.current !== session) return;
      const startedAt = performance.now();
      try {
        const response = await getSessionStats(session);
        if (activeSessionIdRef.current !== session) return;
        setLatencyMs(Math.round(performance.now() - startedAt));
        applyWebRTCStats(response);
      } catch (error) {
        if (error instanceof CrowdApiError && error.status === 404) {
          stopStream();
          return;
        }
        addSystemLog?.(`[WARN] WebRTC stats polling failed: ${getApiErrorMessage(error, 'Unknown API error')}`);
      }
    };
    void poll();
    statsIntervalRef.current = window.setInterval(() => void poll(), 350);
  };

  const waitForIceGathering = async (peer: RTCPeerConnection): Promise<void> => {
    if (peer.iceGatheringState === 'complete') return;
    await new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        peer.removeEventListener('icegatheringstatechange', onStateChange);
        window.clearTimeout(timeoutId);
        resolve();
      };
      const onStateChange = () => {
        if (peer.iceGatheringState === 'complete') finish();
      };
      const timeoutId = window.setTimeout(finish, 3_000);
      peer.addEventListener('icegatheringstatechange', onStateChange);
    });
  };

  const cleanupWebRTCSession = async () => {
    const sessionToClose = activeSessionIdRef.current;
    activeSessionIdRef.current = null;
    if (statsIntervalRef.current != null) {
      window.clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }
    webRtcPeerRef.current?.close();
    webRtcPeerRef.current = null;
    setSessionId(null);
    onSessionChangeRef.current?.(null);
    setIsStreaming(false);
    setActiveTransport(null);
    if (sessionToClose) {
      try {
        await deleteSession(sessionToClose);
      } catch (error) {
        if (!(error instanceof CrowdApiError && error.status === 404)) {
          addSystemLog?.(`[WARN] WebRTC fallback cleanup failed: ${getApiErrorMessage(error, 'Unknown API error')}`);
        }
      }
    }
  };

  const startHttpSession = async () => {
    const sessionRes = await createSession(LIVE_MODE);
    const newSessionId = sessionRes.session.id;
    activeSessionIdRef.current = newSessionId;
    lastResultSequenceRef.current = null;
    cadenceMsRef.current = 150;
    setOverlayData(EMPTY_OVERLAY);
    setSessionId(newSessionId);
    onSessionChangeRef.current?.(newSessionId);
    setActiveTransport('http');
    setErrorMessage(null);
    setIsStreaming(true);
    onStreamingChange?.(true);
    addSystemLog?.('[WEBCAM] Camera stream launched successfully.');
    addSystemLog?.('[AI] YOLO11n + FastTracker inference loop active over HTTP frames.');
    startFrameLoop();
  };

  const waitForTrackingReady = async (): Promise<void> => {
    const controller = new AbortController();
    warmupAbortControllerRef.current = controller;
    try {
      let status = await startWarmup(LIVE_MODE);
      setWarmupStatus(status);
      while (status.status === 'warming' || !trackerReadyFromStatus(status)) {
        if (status.status === 'failed' || status.status === 'blocked') {
          throw new Error(status.error || status.message || 'Model warmup could not be completed.');
        }
        await new Promise<void>((resolve, reject) => {
          const timeoutId = window.setTimeout(resolve, 450);
          const onAbort = () => {
            window.clearTimeout(timeoutId);
            reject(new DOMException('Warmup cancelled.', 'AbortError'));
          };
          controller.signal.addEventListener('abort', onAbort, { once: true });
          window.setTimeout(() => controller.signal.removeEventListener('abort', onAbort), 500);
        });
        status = await getWarmupStatus(LIVE_MODE, controller.signal);
        setWarmupStatus(status);
      }
      if (!trackerReadyFromStatus(status) || !['tracking_ready', 'ready', 'in_use'].includes(status.status)) {
        throw new Error(status.error || status.message || 'Model warmup could not be completed.');
      }
    } finally {
      if (warmupAbortControllerRef.current === controller) {
        warmupAbortControllerRef.current = null;
      }
    }
  };

  const startWebRTCSession = async (mediaStream: MediaStream) => {
    if (!('RTCPeerConnection' in window)) {
      throw new Error('WebRTC is not supported by this browser.');
    }
    const peer = new RTCPeerConnection();
    webRtcPeerRef.current = peer;
    mediaStream.getTracks().forEach((track) => peer.addTrack(track, mediaStream));
    peer.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteStream && videoRef.current) {
        videoRef.current.srcObject = remoteStream;
        void videoRef.current.play().catch(() => undefined);
      }
    };
    peer.onconnectionstatechange = () => {
      if (
        activeSessionIdRef.current
        && (peer.connectionState === 'failed' || peer.connectionState === 'closed')
      ) {
        stopStream();
      }
    };
    const offer = await peer.createOffer({ offerToReceiveVideo: true });
    await peer.setLocalDescription(offer);
    await waitForIceGathering(peer);
    const localDescription = peer.localDescription;
    if (!localDescription?.sdp) throw new Error('The browser did not produce a usable WebRTC offer.');
    const answer = await createWebRTCOffer(localDescription.sdp, 'offer', LIVE_MODE);
    activeSessionIdRef.current = answer.session_id;
    lastResultSequenceRef.current = null;
    setSessionId(answer.session_id);
    onSessionChangeRef.current?.(answer.session_id);
    await peer.setRemoteDescription({ type: answer.type, sdp: answer.sdp });
    setActiveTransport('webrtc');
    setIsStreaming(true);
    onStreamingChange?.(true);
    addSystemLog?.('[WEBCAM] WebRTC media stream connected.');
    addSystemLog?.('[AI] YOLO11n + FastTracker annotated media track active.');
    startWebRTCStatsPolling(answer.session_id);
  };

  const startStream = async () => {
    if (isStartingRef.current || isStreaming || isCameraLive) return;
    isStartingRef.current = true;
    setIsStarting(true);
    setErrorMessage(null);
    try {
      const trackingReadyPromise = waitForTrackingReady();
      setWarmupStatus((previous) => previous ? {
        ...previous,
        stage: 'camera_permission',
        message: t.cameraPermission,
      } : previous);
      addSystemLog?.('[AI] Detector/tracker warmup started in background.');
      addSystemLog?.('[CAMERA] Requesting webcam permission in parallel.');
      let mediaStream: MediaStream;
      try {
        const constraints = {
          video: { facingMode, width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        };
        mediaStream = await requestCameraWithTimeout(constraints);
      } catch (e) {
        if (['camera_permission_timeout', 'camera_unavailable'].includes((e as CameraRequestError)?.code || '')) {
          // The browser cannot cancel an in-flight getUserMedia prompt. Abort
          // the polling side and consume its eventual rejection so a denied
          // camera does not leave an unhandled warm-up promise behind.
          warmupAbortControllerRef.current?.abort();
          void trackingReadyPromise.catch(() => undefined);
          throw e;
        }
        console.warn('[WEBCAM] Preferred constraints failed, trying basic video:', e);
        mediaStream = await requestCameraWithTimeout({ video: true, audio: false });
      }

      // Stop can be pressed while the browser permission prompt is open. Do
      // not resurrect a stream after that cancellation has already cleared
      // the startup ref.
      if (!isStartingRef.current) {
        mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = mediaStream;
      setIsCameraLive(true);

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play();
      }

      setWarmupStatus((previous) => previous ? {
        ...previous,
        stage: trackerReadyFromStatus(previous) ? 'session_starting' : 'camera_connected',
        message: trackerReadyFromStatus(previous) ? t.sessionStarting : t.cameraConnected,
      } : previous);
      addSystemLog?.('[CAMERA] Webcam connected; waiting only for tracking readiness.');

      await trackingReadyPromise;

      setWarmupStatus((previous) => previous ? {
        ...previous,
        stage: 'session_starting',
        message: t.sessionStarting,
      } : previous);
      addSystemLog?.('[AI] Tracking ready. Creating live API session while attributes continue warming.');

      if (transport === 'webrtc') {
        try {
          await startWebRTCSession(mediaStream);
        } catch (webrtcError) {
          await cleanupWebRTCSession();
          if (videoRef.current) {
            videoRef.current.srcObject = mediaStream;
            await videoRef.current.play();
          }
          addSystemLog?.(`[WARN] WebRTC unavailable: ${getApiErrorMessage(webrtcError, 'Unknown WebRTC error')}`);
          addSystemLog?.('[INFO] Falling back to HTTP frame transport.');
          await startHttpSession();
        }
      } else {
        await startHttpSession();
      }
    } catch (err: any) {
      console.error('Camera stream error:', err);
      setErrorMessage(`Camera Error: ${err.message || 'Could not access webcam'}`);
      stopStream();
      addSystemLog?.(`[ERROR] Failed to launch camera stream: ${err.message}`);
    } finally {
      isStartingRef.current = false;
      setIsStarting(false);
    }
  };

  const stopStream = useCallback(() => {
    warmupAbortControllerRef.current?.abort();
    warmupAbortControllerRef.current = null;
    isStartingRef.current = false;
    setIsStarting(false);
    const sessionToClose = activeSessionIdRef.current;
    activeSessionIdRef.current = null;
    setSessionId(null);
    onSessionChangeRef.current?.(null);

    if (statsIntervalRef.current != null) {
      window.clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }
    webRtcPeerRef.current?.close();
    webRtcPeerRef.current = null;
    setActiveTransport(null);
    setIsCameraLive(false);

    if (intervalRef.current) {
      clearTimeout(intervalRef.current);
      intervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    isSendingRef.current = false;
    frameAbortControllerRef.current?.abort();
    frameAbortControllerRef.current = null;
    lastResultSequenceRef.current = null;
    cadenceMsRef.current = 150;
    latestTracksRef.current = [];
    seenTracksRef.current.clear();
    setOverlayData(EMPTY_OVERLAY);
    setSelectedPerson(null);
    setIsStreaming(false);
    cameraFpsRef.current = null;
    setCameraFps(null);
    setLatencyMs(null);
    setAiUpdateRateHz(null);
    onStreamingChangeRef.current?.(false);
    addSystemLogRef.current?.('[STREAM] Camera stream stopped by user.');

    if (sessionToClose) {
      void deleteSession(sessionToClose).catch((error: unknown) => {
        if (!(error instanceof CrowdApiError && error.status === 404)) {
          addSystemLogRef.current?.(`[WARN] Session cleanup failed: ${getApiErrorMessage(error, 'Unknown API error')}`);
        }
      });
    }
  }, []);

  const switchCameraFacing = async () => {
    const nextFacing = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextFacing);
    if (isCameraLive) {
      stopStream();
      setTimeout(startStream, 300);
    }
  };

  const handleResetSession = async () => {
    if (sessionId) {
      try {
        await resetSession(sessionId);
        seenTracksRef.current.clear();
        latestTracksRef.current = [];
        lastResultSequenceRef.current = null;
        setOverlayData(EMPTY_OVERLAY);
        setSelectedPerson(null);
        addSystemLog?.(`[SYSTEM] AI Tracker state & track memory reset successfully.`);
      } catch (error: unknown) {
        setErrorMessage(getApiErrorMessage(error, 'Unable to reset the AI session.'));
      }
    }
  };

  const latestTracksRef = useRef<OverlayTrack[]>([]);
  const seenTracksRef = useRef<Map<number, string>>(new Map());
  const startFrameLoop = () => {
    if (intervalRef.current) clearTimeout(intervalRef.current);
    lastFrameTimeRef.current = performance.now();

    const tick = () => {
      const video = videoRef.current;
      const captureCanvas = captureCanvasRef.current;
      const scheduleNext = () => {
        if (activeSessionIdRef.current) {
          intervalRef.current = window.setTimeout(tick, cadenceMsRef.current);
        }
      };

      if (!video || !captureCanvas || video.paused || video.ended) {
        scheduleNext();
        return;
      }

      const now = performance.now();
      const delta = now - lastFrameTimeRef.current;
      lastFrameTimeRef.current = now;
      if (delta > 0) {
        const nextCameraFps = Math.round(1000 / delta);
        cameraFpsRef.current = nextCameraFps;
        setCameraFps(nextCameraFps);
      }

      captureCanvas.width = video.videoWidth || 640;
      captureCanvas.height = video.videoHeight || 480;
      const capCtx = captureCanvas.getContext('2d');
      if (!capCtx) {
        scheduleNext();
        return;
      }
      capCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);

      const currentSessionId = activeSessionIdRef.current;
      if (currentSessionId && !isSendingRef.current) {
        isSendingRef.current = true;
        const frameAbortController = new AbortController();
        frameAbortControllerRef.current = frameAbortController;
        captureCanvas.toBlob(
          async (blob) => {
            if (!blob) {
              isSendingRef.current = false;
              if (frameAbortControllerRef.current === frameAbortController) {
                frameAbortControllerRef.current = null;
              }
              return;
            }
            const sendTime = performance.now();

            try {
              const res = await submitFrame(
                currentSessionId,
                blob,
                lastResultSequenceRef.current ?? undefined,
                frameAbortController.signal,
              );
              const roundtripLatency = Math.round(performance.now() - sendTime);
              setLatencyMs(roundtripLatency);

              const resultSequence = res.result_sequence;
              const isNewResult = resultSequence != null
                && (lastResultSequenceRef.current == null || resultSequence > lastResultSequenceRef.current);
              if (isNewResult && resultSequence != null) {
                lastResultSequenceRef.current = resultSequence;
                const overlay = (res.overlay ?? {}) as FrameOverlay;
                const currentTracks = overlay.tracks ?? [];
                latestTracksRef.current = currentTracks;
                setOverlayData({
                  frameSize: overlay.frame_size ?? [captureCanvas.width, captureCanvas.height],
                  tracks: currentTracks,
                  zones: overlay.zones ?? [],
                  seats: overlay.seats ?? [],
                });

                if (currentTracks && currentTracks.length > 0) {
                  currentTracks.forEach((tr) => {
                    const trackId = tr.track_id;
                    const personId = tr.person_id != null ? `P0${tr.person_id}` : `P0${trackId}`;
                    const gender = tr.gender ? (tr.gender.toLowerCase().includes('female') ? 'Female-presenting' : 'Male-presenting') : 'Unclassified';
                    const confidence = tr.confidence;
                    const hasConf = typeof confidence === 'number' && confidence > 0;
                    const confStr = hasConf ? `${(confidence * 100).toFixed(1)}%` : 'Classifying...';
                    const stateKey = `${trackId}-${gender}-${confStr}`;

                    if (!seenTracksRef.current.has(trackId)) {
                      seenTracksRef.current.set(trackId, stateKey);
                      addSystemLog?.(`[TRACKER] New Person Tracked: #${personId} (Track ID: T${trackId}).`);
                      if (hasConf) {
                        addSystemLog?.(`[AI CLASSIFICATION] Person #${personId} (T${trackId}) classified: ${gender} (Conf: ${confStr} | YuNet Net).`);
                      } else {
                        addSystemLog?.(`[AI CLASSIFICATION] Person #${personId} (T${trackId}) initial track acquired (YuNet classifying...).`);
                      }
                    } else if (seenTracksRef.current.get(trackId) !== stateKey) {
                      seenTracksRef.current.set(trackId, stateKey);
                      addSystemLog?.(`[AI UPDATE] Person #${personId} (T${trackId}) identity updated: ${gender} (${confStr}).`);
                    }
                  });
                }

                const analytics = res.analytics;
                const liveStreamTelemetry = analytics?.runtime?.live_stream;
                if (liveStreamTelemetry) {
                  const cadenceMs = liveStreamTelemetry.configured_cadence_ms;
                  if (typeof cadenceMs === 'number' && cadenceMs > 0) {
                    cadenceMsRef.current = cadenceMs;
                    setAiUpdateRateHz(1_000 / cadenceMs);
                  }
                  onTelemetryUpdate?.({
                    ...liveStreamTelemetry,
                    runtime: analytics?.runtime,
                    camera_fps: cameraFpsRef.current,
                  });
                }
                if (analytics) onAnalyticsUpdate(analytics);
              }
            } catch (err) {
              if (err instanceof CrowdApiError && err.status === 404) {
                stopStream();
              }
              const message = getApiErrorMessage(err, 'Frame submission failed.');
              setErrorMessage(message);
              console.warn('[LivePage] Frame submit warning:', message);
            } finally {
              isSendingRef.current = false;
              if (frameAbortControllerRef.current === frameAbortController) {
                frameAbortControllerRef.current = null;
              }
            }
          },
          'image/jpeg',
          0.8
        );
      }
      scheduleNext();
    };

    tick();
  };

  const drawOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const [frameWidth, frameHeight] = overlayData.frameSize ?? [640, 480];
    if (canvas.width !== frameWidth || canvas.height !== frameHeight) {
      canvas.width = frameWidth;
      canvas.height = frameHeight;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (activeTransport === 'webrtc') return;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.font = `${Math.max(11, Math.round(canvas.width / 70))}px ui-monospace, SFMono-Regular, Menlo, monospace`;

    const drawPolygon = (polygon: Array<[number, number]>, stroke: string, fill?: string) => {
      if (polygon.length < 2) return;
      ctx.beginPath();
      polygon.forEach(([x, y], index) => {
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(1, canvas.width / 480);
      ctx.stroke();
    };

    if (overlays.zones) {
      overlayData.zones.forEach((zone, index) => {
        const color = ['#22d3ee', '#38bdf8', '#a78bfa', '#f59e0b'][index % 4];
        drawPolygon(zone.polygon, color, `${color}18`);
        const anchor = zone.polygon[0];
        if (anchor) {
          const label = `${zone.name}: ${zone.current_count ?? 0}`;
          ctx.fillStyle = color;
          ctx.fillText(label, anchor[0] + 4, anchor[1] + 16);
        }
      });
    }

    if (overlays.seats) {
      overlayData.seats.forEach((seat) => {
        const color = seat.status === 'occupied'
          ? '#4ade80'
          : seat.status === 'disabled'
          ? '#64748b'
          : seat.status === 'pending' || seat.status === 'uncertain'
          ? '#f59e0b'
          : '#38bdf8';
        drawPolygon(seat.polygon, color);
      });
    }

    overlayData.tracks.forEach((track) => {
      const [rawX1, rawY1, rawX2, rawY2] = track.bbox;
      const x1 = Math.max(0, Math.min(canvas.width, rawX1));
      const y1 = Math.max(0, Math.min(canvas.height, rawY1));
      const x2 = Math.max(0, Math.min(canvas.width, rawX2));
      const y2 = Math.max(0, Math.min(canvas.height, rawY2));
      const gender = track.gender?.toLowerCase() ?? 'unknown';
      const color = gender.includes('female') ? '#f9a8d4' : gender.includes('male') ? '#60a5fa' : '#22d3ee';
      const personLabel = track.person_id != null ? `P0${track.person_id}` : `T${track.track_id}`;
      const isSelected = selectedPerson?.id === personLabel;

      if (overlays.trajectory && track.trajectory && track.trajectory.length > 1) {
        ctx.beginPath();
        track.trajectory.forEach(([x, y], index) => {
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = `${color}99`;
        ctx.lineWidth = Math.max(1, canvas.width / 640);
        ctx.stroke();
      }

      if (overlays.boxes) {
        ctx.strokeStyle = isSelected ? '#facc15' : color;
        ctx.lineWidth = isSelected ? Math.max(2, canvas.width / 240) : Math.max(1, canvas.width / 320);
        ctx.strokeRect(x1, y1, Math.max(0, x2 - x1), Math.max(0, y2 - y1));
      }

      const labels: string[] = [];
      if (overlays.ids) labels.push(personLabel, `T${track.track_id}`);
      if (overlays.attributes && track.gender) labels.push(track.gender);
      if (labelMode === 'debug' && track.source) labels.push(track.source);
      if (labelMode === 'debug' && typeof track.confidence === 'number') labels.push(`${(track.confidence * 100).toFixed(0)}%`);
      if (overlays.motion && track.motion?.direction) {
        const speed = typeof track.motion.speed_reference_px_per_second === 'number'
          ? ` ${track.motion.speed_reference_px_per_second.toFixed(0)}rpx/s`
          : '';
        labels.push(`${track.motion.direction}${speed}`);
      }
      if (labels.length > 0) {
        const label = labels.join(' | ');
        const textWidth = ctx.measureText(label).width;
        const labelHeight = Math.max(17, canvas.height / 28);
        const labelY = Math.max(labelHeight, y1);
        ctx.fillStyle = `${color}dd`;
        ctx.fillRect(x1, labelY - labelHeight, textWidth + 8, labelHeight);
        ctx.fillStyle = '#020617';
        ctx.fillText(label, x1 + 4, labelY - 5);
      }
    });
  }, [activeTransport, labelMode, overlayData, overlays, selectedPerson]);

  useEffect(() => {
    drawOverlay();
  }, [drawOverlay]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const frameWidth = canvas.width || 640;
    const frameHeight = canvas.height || 480;
    const frameAspect = frameWidth / frameHeight;
    const boxAspect = rect.width / rect.height;
    const contentWidth = boxAspect > frameAspect ? rect.height * frameAspect : rect.width;
    const contentHeight = boxAspect > frameAspect ? rect.height : rect.width / frameAspect;
    const contentLeft = rect.left + (rect.width - contentWidth) / 2;
    const contentTop = rect.top + (rect.height - contentHeight) / 2;
    const clickX = ((e.clientX - contentLeft) / contentWidth) * frameWidth;
    const clickY = ((e.clientY - contentTop) / contentHeight) * frameHeight;

    const tracks = latestTracksRef.current;
    const matchedTrack = tracks.find((tr) => {
      const b = tr.bbox || [0, 0, 0, 0];
      const x1 = b[0], y1 = b[1], x2 = b[2], y2 = b[3];
      return clickX >= x1 && clickX <= x2 && clickY >= y1 && clickY <= y2;
    }) || tracks[0];

    if (matchedTrack) {
      const tId = matchedTrack.track_id;
      const pId = matchedTrack.person_id != null ? `P0${matchedTrack.person_id}` : `P0${tId}`;
      const gender = matchedTrack.gender ? (matchedTrack.gender.toLowerCase().includes('female') ? 'Female-presenting' : 'Male-presenting') : 'Unclassified';
      const confStr = typeof matchedTrack.confidence === 'number' ? `${(matchedTrack.confidence * 100).toFixed(1)}%` : 'Unclassified';

      setSelectedPerson({
        id: pId,
        tracker: `T${tId}`,
        x: clickX,
        y: clickY,
        w: Math.max(0, (matchedTrack.bbox?.[2] ?? 0) - (matchedTrack.bbox?.[0] ?? 0)),
        h: Math.max(0, (matchedTrack.bbox?.[3] ?? 0) - (matchedTrack.bbox?.[1] ?? 0)),
        attr: gender,
        confidence: confStr,
      });
    } else {
      setSelectedPerson(null);
    }
  };

  useEffect(() => {
    return () => {
      stopStream();
    };
  }, [stopStream]);

  const toggleOverlay = (key: keyof OverlayOptions) => {
    setOverlays((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const startupSteps = [
    { label: t.cameraConnected, ready: isCameraLive },
    { label: t.detectorReady, ready: warmupStatus ? detectorReadyFromStatus(warmupStatus) : false },
    { label: t.trackerReady, ready: warmupStatus ? trackerReadyFromStatus(warmupStatus) : false },
    { label: warmupStatus && attributesReadyFromStatus(warmupStatus) ? t.attributesReady : t.attributesLoading, ready: warmupStatus ? attributesReadyFromStatus(warmupStatus) : false },
  ];

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 max-w-7xl mx-auto pb-20 md:pb-6">
      {/* Live Monitor Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg sm:text-xl font-bold font-mono text-slate-100 flex items-center gap-2">
            <span>{t.liveTitle}</span>
            <span
              className={`text-[10px] sm:text-xs border px-2 py-0.5 rounded font-mono font-bold ${
                isStreaming
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              {isStreaming ? '● LIVE AI STREAM' : 'OFFLINE'}
            </span>
          </h2>
          <p className="text-[11px] sm:text-xs text-sky-300/80 font-mono">{t.liveSub}</p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={switchCameraFacing}
            className="cyber-btn text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1 font-mono cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
            <span>{t.switchCam} ({facingMode === 'user' ? 'Front' : 'Back'})</span>
          </button>

          <button
            onClick={handleResetSession}
            className="cyber-btn text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1 font-mono cursor-pointer"
          >
            <span>{t.resetTracker}</span>
          </button>

          <div className="flex items-center space-x-1 bg-[#071120] border border-sky-500/40 p-1 rounded-lg text-xs font-mono">
            {(['minimal', 'analytics', 'debug'] as LabelMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setLabelMode(mode)}
                className={`px-2 py-0.5 sm:py-1 rounded capitalize transition-all cursor-pointer ${
                  labelMode === mode
                    ? 'bg-cyan-400 text-slate-950 font-bold shadow-sm'
                    : 'text-slate-400 hover:text-cyan-300'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          <div className="flex items-center space-x-1 bg-[#071120] border border-sky-500/40 p-1 rounded-lg text-xs font-mono">
            {(['http', 'webrtc'] as TransportMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setTransport(mode)}
                disabled={isStreaming}
                className={`px-2 py-0.5 sm:py-1 rounded uppercase transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
                  transport === mode
                    ? 'bg-cyan-400 text-slate-950 font-bold shadow-sm'
                    : 'text-slate-400 hover:text-cyan-300'
                }`}
              >
                {mode === 'http' ? 'HTTP Frame' : 'WebRTC'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {errorMessage && (
        <div className="bg-rose-500/15 border border-rose-500/40 text-rose-300 p-3 rounded-lg text-xs font-mono font-bold flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Main Live Monitor Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Column: Live Video + Circle Vector Hologram Radar Ring */}
        <div className="lg:col-span-3 space-y-4">
          <div className="cyber-card relative bg-[#071120] border border-sky-500/50 rounded-2xl overflow-hidden shadow-2xl aspect-video flex items-center justify-center">
            {/* Raw HTML5 Video Element (Hardware Accelerated Camera Feed) */}
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-contain pointer-events-none z-0 opacity-100"
              autoPlay
              muted
              playsInline
            />

            {/* AI Annotated Frame Canvas Overlay */}
            <canvas
              ref={canvasRef}
              width={640}
              height={480}
              onClick={handleCanvasClick}
              className="absolute inset-0 w-full h-full object-contain cursor-crosshair z-10"
              title="Click on any person box to focus details"
            />

            {/* Circle Vector Hologram Radar Ring Overlay */}
            <div className="absolute top-4 right-4 w-28 h-28 pointer-events-none z-20 opacity-60">
              <div className="w-full h-full border-2 border-dashed border-cyan-400 rounded-full radar-ring flex items-center justify-center">
                <div className="w-16 h-16 border border-cyan-400/50 rounded-full flex items-center justify-center">
                  <Crosshair className="w-6 h-6 text-cyan-400 animate-ping" />
                </div>
              </div>
            </div>

            {/* Standby Camera Card */}
            {!isCameraLive && (
              <div className="absolute inset-0 bg-[#071120]/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center space-y-4 z-20">
                <div className="w-16 h-16 rounded-2xl bg-cyan-400/10 border border-cyan-400/30 flex items-center justify-center text-cyan-400 shadow-xl shadow-cyan-500/20">
                  <Camera className="w-8 h-8 animate-pulse" />
                </div>
                <div>
                  <h3 className="text-lg font-bold font-mono text-slate-100">{t.standbyTitle}</h3>
                  <p className="text-xs text-sky-300/70 max-w-sm mt-1">{t.standbySub}</p>
                </div>

                {isStarting && (
                  <div className="w-full max-w-sm rounded-xl border border-cyan-400/30 bg-cyan-400/5 p-3 text-left space-y-2" role="status" aria-live="polite" aria-busy="true">
                    <div className="flex items-center justify-between gap-3 text-[11px] font-mono text-cyan-200">
                      <span>{warmupStatus?.message || t.warmupStart}</span>
                      <span className="shrink-0 text-sky-300/70">{warmupStatus?.stage || 'starting'}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                      {startupSteps.map((step) => (
                        <span key={step.label} className={step.ready ? 'text-emerald-300' : 'text-slate-500'}>
                          {step.ready ? '✓' : '◌'} {step.label}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  onClick={toggleStreaming}
                  disabled={isStarting}
                  aria-busy={isStarting}
                  className="cyber-btn px-6 py-2.5 rounded-xl font-bold font-mono flex items-center space-x-2 text-cyan-300 hover:text-white transition-all transform hover:scale-105 active:scale-95 cursor-pointer shadow-lg shadow-cyan-500/20 disabled:cursor-wait disabled:opacity-50 disabled:hover:scale-100"
                >
                  {isStarting ? <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" /> : <Play className="w-4 h-4 fill-current text-cyan-400" />}
                  <span>{isStarting ? t.warmingUp : t.startStream}</span>
                </button>
              </div>
            )}

            {isCameraLive && !isStreaming && (
              <div className="absolute top-4 left-4 right-4 bg-[#0b172a]/90 backdrop-blur-md p-3 rounded-xl border border-cyan-400/40 shadow-2xl text-xs font-mono z-20 space-y-2" role="status" aria-live="polite">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-emerald-300 font-bold">
                    <Camera className="w-4 h-4" /> {t.cameraConnected}
                  </span>
                  <span className="text-cyan-300">{warmupStatus?.message || t.warmupStart}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px]">
                  <span className={warmupStatus && detectorReadyFromStatus(warmupStatus) ? 'text-emerald-300' : 'text-slate-500'}>{warmupStatus && detectorReadyFromStatus(warmupStatus) ? '✓' : '○'} {t.detectorReady}</span>
                  <span className={warmupStatus && trackerReadyFromStatus(warmupStatus) ? 'text-emerald-300' : 'text-slate-500'}>{warmupStatus && trackerReadyFromStatus(warmupStatus) ? '✓' : '○'} {t.trackerReady}</span>
                  <span className={warmupStatus && attributesReadyFromStatus(warmupStatus) ? 'text-emerald-300' : 'text-amber-300'}>{warmupStatus && attributesReadyFromStatus(warmupStatus) ? '✓' : '◌'} {warmupStatus && attributesReadyFromStatus(warmupStatus) ? t.attributesReady : t.attributesLoading}</span>
                </div>
              </div>
            )}

            {/* Person Details Selection Card */}
            {selectedPerson && (
              <div className="absolute top-4 left-4 bg-[#0b172a]/90 backdrop-blur-md p-3 rounded-xl border border-cyan-400/50 shadow-2xl text-xs font-mono space-y-1 z-30 min-w-[180px]">
                <div className="flex items-center justify-between gap-4 font-bold text-cyan-300">
                  <span className="flex items-center gap-1">
                    <UserCheck className="w-3.5 h-3.5" /> Person {selectedPerson.id}
                  </span>
                  <button onClick={() => setSelectedPerson(null)} className="text-slate-400 hover:text-white cursor-pointer">✕</button>
                </div>
                <div>Tracker ID: <strong className="text-slate-200">{selectedPerson.tracker}</strong></div>
                <div>Attribute: <strong className="text-emerald-400">{selectedPerson.attr}</strong></div>
                <div>Confidence: <strong className="text-cyan-400">{selectedPerson.confidence}</strong></div>
              </div>
            )}

            {isStreaming && (
              <div className="absolute top-4 left-4 flex items-center space-x-2 bg-[#0b172a]/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-sky-500/40 text-xs text-slate-200 font-mono z-20">
                <Camera className="w-4 h-4 text-cyan-400" />
                <span className="font-bold">{t.liveWebcamBadge}</span>
              </div>
            )}

            {isCameraLive && (
              <button
                onClick={toggleStreaming}
                className="absolute bottom-4 right-4 bg-rose-500 hover:bg-rose-400 text-white p-2.5 rounded-full shadow-lg transition-transform hover:scale-105 cursor-pointer z-20"
                title={t.stopStream}
              >
                <Pause className="w-5 h-5 fill-current" />
              </button>
            )}
          </div>

          {/* Real-time Telemetry Bar */}
          <div className="cyber-card p-3 rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-sky-300">
            <div className="flex flex-wrap items-center gap-2 sm:gap-4">
              <span>
                Transport: <strong className="text-cyan-400">{activeTransport ? activeTransport.toUpperCase() : '--'}</strong>
              </span>
              <span className="text-slate-600 hidden xs:inline">|</span>
              <span>
                Camera: <strong className="text-slate-100">{cameraFps != null ? `${cameraFps} FPS` : '--'}</strong>
              </span>
              <span className="text-slate-600 hidden xs:inline">|</span>
              <span>
                AI Cadence: <strong className="text-cyan-400 font-bold">
                  {aiUpdateRateHz != null ? `${aiUpdateRateHz.toFixed(1)} Hz` : '--'}
                </strong>
              </span>
              <span className="text-slate-600 hidden xs:inline">|</span>
              <span>
                Backend Latency: <strong className="text-slate-100">{latencyMs != null ? `${latencyMs} ms` : '--'}</strong>
              </span>
            </div>
            <span className={`font-mono font-bold ${isStreaming ? 'text-emerald-400' : isCameraLive ? 'text-amber-300' : 'text-slate-500'}`}>
              {isStreaming ? '● Model Connected' : isCameraLive ? '◌ AI Initializing' : '○ Standby'}
            </span>
          </div>
        </div>

        {/* Right Column: Live Model Realtime KPI Summary */}
        <div className="space-y-6">
          <div className="cyber-card p-4 space-y-3">
            <h3 className="text-sm font-bold font-mono text-slate-100 border-b border-sky-500/30 pb-2">
              {t.modelStats}
            </h3>

            <div className="flex justify-between items-center text-xs font-mono">
              <span className="text-sky-300">{t.detectedCrowd}</span>
              <span className="text-xl font-bold text-cyan-400">{analytics.total_crowd}</span>
            </div>

            <div className="flex justify-between items-center text-xs font-mono">
              <span className="text-sky-300">{t.femaleMale}</span>
              <span className="text-sm font-bold text-slate-200">
                {analytics.visual_presentation.female_presenting} F / {analytics.visual_presentation.male_presenting} M
              </span>
            </div>

            <div className="flex justify-between items-center text-xs font-mono">
              <span className="text-sky-300">{t.unclassifiedUnknown}</span>
              <span className="text-sm font-bold text-amber-400">
                {analytics.visual_presentation.unknown}
              </span>
            </div>

            <div className="flex justify-between items-center text-xs font-mono">
              <span className="text-sky-300">{t.coveragePct}</span>
              <span className="text-sm font-bold text-emerald-400">
                {analytics.visual_presentation.coverage_pct}%
              </span>
            </div>

            <div className="flex justify-between items-center text-xs font-mono border-t border-sky-500/30 pt-2">
              <span className="text-sky-300">{t.seatsOccupiedCount}</span>
              <span className="text-sm font-bold text-slate-100">
                {analytics.total_seats > 0 && analytics.seats_occupied != null ? `${analytics.seats_occupied} / ${analytics.total_seats}` : '--'}
              </span>
            </div>
          </div>

          {/* Overlay Checkboxes */}
          <div className="cyber-card p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-sky-500/30 pb-2">
              <h3 className="text-sm font-bold font-mono text-slate-100 flex items-center gap-2">
                <Layers className="w-4 h-4 text-cyan-400" />
                {t.overlayControls}
              </h3>
              <Settings className="w-4 h-4 text-slate-500" />
            </div>

            <div className="space-y-2 text-xs font-mono">
              {([
                { key: 'boxes', label: t.boxes },
                { key: 'ids', label: t.ids },
                { key: 'attributes', label: t.attributes },
                { key: 'motion', label: t.motion },
                { key: 'zones', label: t.zones },
                { key: 'seats', label: t.seats },
                { key: 'trajectory', label: 'Trajectory' },
              ] as { key: keyof OverlayOptions; label: string }[]).map((item) => {
                const isChecked = overlays[item.key];
                return (
                  <button
                    key={item.key}
                    onClick={() => toggleOverlay(item.key)}
                    className="w-full flex items-center space-x-2 text-slate-300 hover:text-cyan-300 p-1 rounded hover:bg-sky-500/10 transition-colors text-left cursor-pointer"
                  >
                    {isChecked ? (
                      <CheckSquare className="w-4 h-4 text-cyan-400 shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-500 shrink-0" />
                    )}
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
