import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Camera,
  Play,
  Pause,
  RefreshCw,
  AlertCircle,
  UserCheck,
  ChevronDown,
  Layers,
  Crop,
  Badge as BadgeIcon,
  Users,
  ArrowDownUp,
  ArrowDown,
  ArrowUp,
  Grid,
  Armchair,
} from 'lucide-react';
import type { LabelMode, OverlayOptions, AnalyticsData } from '@/types/analytics';
import type {
  ApiErrorDetail,
  FrameOverlay,
  OverlaySeat,
  OverlayTrack,
  OverlayZone,
  SessionStatsResponse,
  WebRTCOfferResponse,
} from '@/api/contracts';
import {
  CrowdApiError,
  createSession,
  createWebRTCSessionSocket,
  deleteSession,
  getApiErrorMessage,
  getWebRTCIceConfig,
  getWarmupStatus,
  resetSession,
  startWarmup,
  submitFrame,
} from '@/api/crowdApi';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface LivePageProps {
  analytics: AnalyticsData;
  onAnalyticsUpdate: (stats: any) => void;
  onTelemetryUpdate?: (telemetry: Record<string, any>) => void;
  t: any;
  isVisible?: boolean;
  onStreamingChange?: (active: boolean) => void;
  onSessionChange?: (sessionId: string | null) => void;
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

type TransportMode = 'http' | 'webrtc' | 'websocket';
type CameraFacing = 'user' | 'environment';

const EMPTY_OVERLAY: OverlayRenderData = {
  frameSize: null,
  tracks: [],
  zones: [],
  seats: [],
};

const LIVE_MODE = 'classroom_demo' as const;
const CAMERA_PERMISSION_TIMEOUT_MS = 20_000;
const ICE_GATHERING_TIMEOUT_MS = 10_000;
const WEBRTC_CONNECTION_TIMEOUT_MS = 60_000;
const FRAME_SOCKET_MIN_CADENCE_MS = 200;
const FRAME_SOCKET_MAX_BUFFERED_BYTES = 256_000;

type WebRTCLifecycleEvent =
  | { event: 'answer'; answer: WebRTCOfferResponse }
  | { event: 'metadata'; data: SessionStatsResponse }
  | { event: 'transport'; transport: 'websocket_frames'; reason?: string }
  | { event: 'error'; error: ApiErrorDetail };

const longTermPersonLabel = (track: OverlayTrack): string | null => {
  const backendLabel = track.person_label?.trim();
  if (backendLabel) return backendLabel;
  if (!Number.isInteger(track.person_id) || (track.person_id ?? -1) < 0) return null;
  return `P${String(track.person_id).padStart(4, '0')}`;
};

type WarmupSnapshot = Awaited<ReturnType<typeof getWarmupStatus>>;

const trackerReadyFromStatus = (status: WarmupSnapshot): boolean =>
  status.tracker_ready ?? ['tracking_ready', 'ready', 'in_use'].includes(status.status);

const detectorReadyFromStatus = (status: WarmupSnapshot): boolean =>
  status.detector_ready ?? ['tracking_ready', 'ready', 'in_use'].includes(status.status);

const attributesReadyFromStatus = (status: WarmupSnapshot): boolean =>
  status.attributes_ready ?? status.status === 'ready';

type CameraRequestError = Error & { code?: string };

async function requestCameraWithTimeout(constraints: MediaStreamConstraints): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    const error: CameraRequestError = new Error(
      'Camera is unavailable in this browser context. Open the app on HTTPS or localhost and allow camera access.'
    );
    error.code = 'camera_unavailable';
    throw error;
  }
  let timedOut = false;
  let timeoutId: number | null = null;
  const cameraPromise = navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
    if (timedOut) {
      stream.getTracks().forEach((track) => track.stop());
      const error: CameraRequestError = new Error(
        'Camera permission request timed out. Check browser camera permission and close any hidden prompt.'
      );
      error.code = 'camera_permission_timeout';
      throw error;
    }
    return stream;
  });
  const timeoutPromise = new Promise<MediaStream>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      timedOut = true;
      const error: CameraRequestError = new Error(
        'Camera permission request timed out. Check browser camera permission and close any hidden prompt.'
      );
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

export const LivePage: React.FC<LivePageProps> = ({
  analytics,
  onAnalyticsUpdate,
  onTelemetryUpdate,
  t,
  isVisible = true,
  onStreamingChange,
  onSessionChange,
}) => {
  const [labelMode, setLabelMode] = useState<LabelMode>('minimal');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isCameraLive, setIsCameraLive] = useState(false);
  const [activeTransport, setActiveTransport] = useState<TransportMode | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<CameraFacing>('user');
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
    attributes: false,
    motion: false,
    zones: false,
    seats: false,
    trajectory: false,
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<any>(null);
  const webRtcPeerRef = useRef<RTCPeerConnection | null>(null);
  const metadataSocketRef = useRef<WebSocket | null>(null);
  const frameAbortControllerRef = useRef<AbortController | null>(null);
  const warmupAbortControllerRef = useRef<AbortController | null>(null);
  const isStartingRef = useRef(false);
  const lastFrameTimeRef = useRef<number>(performance.now());
  const cameraFpsRef = useRef<number | null>(null);
  const cadenceMsRef = useRef(150);
  const lastResultSequenceRef = useRef<number | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const isSendingRef = useRef<boolean>(false);
  const transportFallbackPromiseRef = useRef<Promise<boolean> | null>(null);
  const frameSocketFallbackRef = useRef<WebSocket | null>(null);
  const onStreamingChangeRef = useRef(onStreamingChange);
  const onSessionChangeRef = useRef(onSessionChange);

  onStreamingChangeRef.current = onStreamingChange;
  onSessionChangeRef.current = onSessionChange;

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

  const applyMetadataStats = (response: SessionStatsResponse) => {
    const resultSequence = response.frame?.sequence;
    if (
      resultSequence == null ||
      (lastResultSequenceRef.current != null && resultSequence <= lastResultSequenceRef.current)
    ) {
      return;
    }
    lastResultSequenceRef.current = resultSequence;
    const analyticsPayload = response.analytics;
    const overlay = (analyticsPayload?.overlay ?? {}) as FrameOverlay;
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
      const endToEnd = liveStreamTelemetry.end_to_end_ms;
      if (endToEnd && typeof endToEnd.last === 'number') {
        setLatencyMs(Math.round(endToEnd.last));
      }
      const cadenceMs = liveStreamTelemetry.configured_cadence_ms;
      if (typeof cadenceMs === 'number' && cadenceMs > 0) {
        cadenceMsRef.current = cadenceMs;
        setAiUpdateRateHz(1_000 / cadenceMs);
      }
      onTelemetryUpdate?.({
        live_stream: liveStreamTelemetry,
        runtime: analyticsPayload?.runtime,
        camera_fps: cameraFpsRef.current,
      });
    }
    if (analyticsPayload) onAnalyticsUpdate(analyticsPayload);
  };

  const waitForIceGathering = async (peer: RTCPeerConnection): Promise<void> => {
    if (peer.iceGatheringState === 'complete') return;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        peer.removeEventListener('icegatheringstatechange', onStateChange);
        window.clearTimeout(timeoutId);
        if (error) reject(error);
        else resolve();
      };
      const onStateChange = () => {
        if (peer.iceGatheringState === 'complete') finish();
      };
      const timeoutId = window.setTimeout(
        () => finish(new Error('ICE gathering timed out before all candidates were available.')),
        ICE_GATHERING_TIMEOUT_MS
      );
      peer.addEventListener('icegatheringstatechange', onStateChange);
      onStateChange();
    });
  };

  const cleanupWebRTCSession = async () => {
    const sessionToClose = activeSessionIdRef.current;
    activeSessionIdRef.current = null;
    metadataSocketRef.current?.close();
    metadataSocketRef.current = null;
    frameSocketFallbackRef.current = null;
    webRtcPeerRef.current?.close();
    webRtcPeerRef.current = null;
    setSessionId(null);
    onSessionChangeRef.current?.(null);
    setIsStreaming(false);
    setActiveTransport(null);
    onStreamingChangeRef.current?.(false);
    if (sessionToClose) {
      try {
        await deleteSession(sessionToClose);
      } catch (error) {
        if (!(error instanceof CrowdApiError && error.status === 404)) {
        }
      }
    }
  };

  const startHttpSession = async (mediaStream: MediaStream): Promise<boolean> => {
    const sessionRes = await createSession(LIVE_MODE);
    const newSessionId = sessionRes.session.id;
    if (
      streamRef.current !== mediaStream ||
      !mediaStream.getVideoTracks().some((track) => track.readyState === 'live')
    ) {
      void deleteSession(newSessionId).catch(() => undefined);
      return false;
    }
    activeSessionIdRef.current = newSessionId;
    lastResultSequenceRef.current = null;
    cadenceMsRef.current = 150;
    setOverlayData(EMPTY_OVERLAY);
    setSessionId(newSessionId);
    onSessionChangeRef.current?.(newSessionId);
    setActiveTransport('http');
    setErrorMessage(null);
    setIsStreaming(true);
    onStreamingChangeRef.current?.(true);
    startFrameLoop();
    return true;
  };

  const activateTransportFallback = (mediaStream: MediaStream, reason: unknown): Promise<boolean> => {
    if (
      frameSocketFallbackRef.current &&
      frameSocketFallbackRef.current === metadataSocketRef.current &&
      frameSocketFallbackRef.current.readyState === WebSocket.OPEN
    ) {
      return Promise.resolve(true);
    }
    if (transportFallbackPromiseRef.current) return transportFallbackPromiseRef.current;

    const fallbackPromise = (async () => {
      if (streamRef.current !== mediaStream) return false;
      const lifecycleSocket = metadataSocketRef.current;
      if (
        lifecycleSocket?.readyState === WebSocket.OPEN &&
        activeSessionIdRef.current
      ) {
        try {
          console.warn('[LivePage] WebRTC unavailable; keeping the lifecycle socket for frame fallback:', reason);
          frameSocketFallbackRef.current = lifecycleSocket;
          const failedPeer = webRtcPeerRef.current;
          webRtcPeerRef.current = null;
          if (failedPeer) {
            failedPeer.onconnectionstatechange = null;
            failedPeer.close();
          }
          lifecycleSocket.send(JSON.stringify({ event: 'fallback', transport: 'websocket_frames' }));
          setActiveTransport('websocket');
          setIsStreaming(true);
          onStreamingChangeRef.current?.(true);
          startSocketFrameLoop(lifecycleSocket);
          setErrorMessage('WebRTC media was unavailable. Efficient WebSocket frame transport is active.');
          return true;
        } catch (socketFallbackError) {
          frameSocketFallbackRef.current = null;
          console.warn('[LivePage] Existing lifecycle socket could not enter frame fallback:', socketFallbackError);
        }
      }

      console.warn('[LivePage] Lifecycle socket unavailable; enabling bounded HTTP fallback:', reason);
      try {
        await cleanupWebRTCSession();
        if (
          streamRef.current !== mediaStream ||
          !mediaStream.getVideoTracks().some((track) => track.readyState === 'live')
        ) {
          return false;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          await videoRef.current.play();
        }
        const started = await startHttpSession(mediaStream);
        if (started) {
          setErrorMessage('WebRTC and its lifecycle socket were unavailable. HTTP frame fallback is active.');
        }
        return started;
      } catch (fallbackError) {
        if (streamRef.current === mediaStream) {
          setIsStreaming(false);
          setActiveTransport(null);
          onStreamingChangeRef.current?.(false);
          setErrorMessage(
            `Camera remains open, but the AI transport could not start: ${getApiErrorMessage(
              fallbackError,
              'HTTP fallback failed.'
            )}`
          );
        }
        return false;
      }
    })();

    transportFallbackPromiseRef.current = fallbackPromise;
    void fallbackPromise.finally(() => {
      if (transportFallbackPromiseRef.current === fallbackPromise) {
        transportFallbackPromiseRef.current = null;
      }
    });
    return fallbackPromise;
  };

  const waitForPeerConnected = async (peer: RTCPeerConnection): Promise<void> => {
    if (peer.connectionState === 'connected') return;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        peer.removeEventListener('connectionstatechange', onConnectionStateChange);
        if (error) reject(error);
        else resolve();
      };
      const onConnectionStateChange = () => {
        if (peer.connectionState === 'connected') {
          finish();
        } else if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
          finish(new Error(`WebRTC connection ${peer.connectionState} before media became active.`));
        }
      };
      const timeoutId = window.setTimeout(
        () => finish(new Error('WebRTC media connection timed out before reaching connected state.')),
        WEBRTC_CONNECTION_TIMEOUT_MS
      );
      peer.addEventListener('connectionstatechange', onConnectionStateChange);
      onConnectionStateChange();
    });
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
    let iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
    let turnEnabled = false;
    try {
      const iceConfig = await getWebRTCIceConfig();
      if (iceConfig.ice_servers.length > 0) iceServers = iceConfig.ice_servers;
      turnEnabled = iceConfig.turn_enabled;
    } catch (iceConfigError) {
      // Rolling deployments and local backends may not expose the config
      // endpoint yet. Keep a STUN-only attempt before using frame fallback.
      console.warn('[ICE] Dynamic ICE config unavailable; using default STUN:', iceConfigError);
    }
    if (
      streamRef.current !== mediaStream ||
      !mediaStream.getVideoTracks().some((track) => track.readyState === 'live')
    ) {
      throw new Error('Camera stream ended before WebRTC setup began.');
    }
    const peer = new RTCPeerConnection({
      iceServers,
      // A TURN-backed candidate pool reserves relay allocations before they
      // are selected. Disable pre-gathering when TURN exists to save relay
      // quota; one STUN-only pool keeps direct setup responsive.
      iceCandidatePoolSize: turnEnabled ? 0 : 1,
    });
    webRtcPeerRef.current = peer;
    let disconnectedTimer: number | null = null;
    let selectedPairLogged = false;
    peer.onicecandidate = (event) => {
      if (!event.candidate) {
        console.debug('[ICE] gathering complete');
        return;
      }
      console.debug('[ICE candidate]', {
        type: event.candidate.type,
        protocol: event.candidate.protocol,
      });
    };
    peer.oniceconnectionstatechange = () => {
      console.debug('[ICE state]', peer.iceConnectionState);
    };
    mediaStream.getVideoTracks().forEach((track) => {
      peer.addTransceiver(track, { direction: 'sendonly' });
    });
    peer.onconnectionstatechange = () => {
      console.debug('[PC state]', peer.connectionState);
      if (peer.connectionState === 'connected' && !selectedPairLogged) {
        selectedPairLogged = true;
        void peer.getStats().then((stats) => {
          stats.forEach((report) => {
            if (report.type !== 'candidate-pair' || report.state !== 'succeeded' || !report.nominated) return;
            const local = stats.get(report.localCandidateId);
            const remote = stats.get(report.remoteCandidateId);
            console.info('[ICE selected pair]', {
              localType: local?.candidateType,
              localProtocol: local?.protocol,
              remoteType: remote?.candidateType,
              remoteProtocol: remote?.protocol,
            });
          });
        }).catch((error: unknown) => {
          console.debug('[ICE] Selected-pair stats unavailable:', error);
        });
      }
      if (peer.connectionState !== 'disconnected' && disconnectedTimer != null) {
        window.clearTimeout(disconnectedTimer);
        disconnectedTimer = null;
      }
      if (peer.connectionState === 'disconnected' && disconnectedTimer == null) {
        disconnectedTimer = window.setTimeout(() => {
          disconnectedTimer = null;
          if (
            webRtcPeerRef.current === peer &&
            activeSessionIdRef.current &&
            peer.connectionState === 'disconnected'
          ) {
            void activateTransportFallback(mediaStream, new Error('WebRTC connection remained disconnected.'));
          }
        }, 4_000);
      }
      if (
        webRtcPeerRef.current === peer &&
        activeSessionIdRef.current &&
        (peer.connectionState === 'failed' || peer.connectionState === 'closed')
      ) {
        void activateTransportFallback(mediaStream, new Error(`WebRTC connection ${peer.connectionState}.`));
      }
    };
    const offer = await peer.createOffer({ offerToReceiveVideo: false });
    await peer.setLocalDescription(offer);
    await waitForIceGathering(peer);
    const localDescription = peer.localDescription;
    if (!localDescription?.sdp) throw new Error('The browser did not produce a usable WebRTC offer.');
    const socket = createWebRTCSessionSocket();
    metadataSocketRef.current = socket;

    await new Promise<void>((resolve, reject) => {
      let negotiated = false;
      let settled = false;
      const finishWithError = (error: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        reject(error);
      };
      const timeoutId = window.setTimeout(() => {
        socket.close();
        finishWithError(new Error('WebRTC signaling timed out.'));
      }, 20_000);

      socket.onopen = () => {
        socket.send(JSON.stringify({
          sdp: localDescription.sdp,
          type: 'offer',
          mode: LIVE_MODE,
        }));
      };
      socket.onmessage = (event) => {
        let message: WebRTCLifecycleEvent;
        try {
          message = JSON.parse(String(event.data)) as WebRTCLifecycleEvent;
        } catch {
          return;
        }
        if (message.event === 'metadata') {
          applyMetadataStats(message.data);
          return;
        }
        if (message.event === 'transport' && message.transport === 'websocket_frames') {
          void activateTransportFallback(
            mediaStream,
            new Error(message.reason || 'Server selected WebSocket frame transport.')
          );
          return;
        }
        if (message.event === 'error') {
          finishWithError(new Error(message.error.message || 'WebRTC signaling failed.'));
          return;
        }
        if (message.event !== 'answer' || settled) return;
        const answer = message.answer;
        activeSessionIdRef.current = answer.session_id;
        lastResultSequenceRef.current = null;
        setSessionId(answer.session_id);
        onSessionChangeRef.current?.(answer.session_id);
        void peer
          .setRemoteDescription({ type: answer.type, sdp: answer.sdp })
          .then(() => {
            if (settled) return;
            negotiated = true;
            settled = true;
            window.clearTimeout(timeoutId);
            resolve();
          })
          .catch((error: unknown) => {
            finishWithError(error instanceof Error ? error : new Error('Invalid WebRTC answer.'));
          });
      };
      socket.onerror = () => {
        if (!negotiated) finishWithError(new Error('WebRTC signaling connection failed.'));
      };
      socket.onclose = () => {
        if (!negotiated) {
          finishWithError(new Error('WebRTC signaling closed before negotiation completed.'));
          return;
        }
        if (metadataSocketRef.current === socket && activeSessionIdRef.current) {
          metadataSocketRef.current = null;
          frameSocketFallbackRef.current = null;
          void activateTransportFallback(mediaStream, new Error('WebRTC lifecycle socket closed.'));
        }
      };
    });
    await waitForPeerConnected(peer);
    if (
      webRtcPeerRef.current !== peer ||
      streamRef.current !== mediaStream ||
      !activeSessionIdRef.current
    ) {
      throw new Error('WebRTC connection was replaced before media became active.');
    }
    setActiveTransport('webrtc');
    setIsStreaming(true);
    onStreamingChangeRef.current?.(true);
  };

  const startStream = async (requestedFacing: CameraFacing = facingMode, forceRestart = false) => {
    // A camera switch stops the current stream and immediately starts a new
    // one. `isStreaming`/`isCameraLive` can still be stale in this closure
    // while React commits the state updates from stopStream, so that restart
    // must explicitly bypass the normal duplicate-start guard.
    if (isStartingRef.current || (!forceRestart && (isStreaming || isCameraLive))) return;
    isStartingRef.current = true;
    setIsStarting(true);
    setErrorMessage(null);
    try {
      const trackingReadyPromise = waitForTrackingReady();
      setWarmupStatus((previous) =>
        previous
          ? {
              ...previous,
              stage: 'camera_permission',
              message: t.cameraPermission,
            }
          : previous
      );
      let mediaStream: MediaStream;
      try {
        const constraints = {
          video: {
            facingMode: requestedFacing,
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        };
        mediaStream = await requestCameraWithTimeout(constraints);
      } catch (e) {
        if (
          ['camera_permission_timeout', 'camera_unavailable'].includes((e as CameraRequestError)?.code || '')
        ) {
          warmupAbortControllerRef.current?.abort();
          void trackingReadyPromise.catch(() => undefined);
          throw e;
        }
        console.warn('[WEBCAM] Preferred constraints failed, trying basic video:', e);
        mediaStream = await requestCameraWithTimeout({ video: true, audio: false });

        // A generic `{ video: true }` request commonly selects the front
        // camera on mobile. Do not silently report that as a successful
        // back-camera switch when the browser exposes the selected facing.
        const actualFacing = mediaStream.getVideoTracks()[0]?.getSettings().facingMode;
        if (requestedFacing === 'environment' && actualFacing === 'user') {
          mediaStream.getTracks().forEach((track) => track.stop());
          const error: CameraRequestError = new Error(
            'Back camera is unavailable. Check browser camera permissions or device support.'
          );
          error.code = 'camera_unavailable';
          throw error;
        }
      }

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

      setWarmupStatus((previous) =>
        previous
          ? {
              ...previous,
              stage: trackerReadyFromStatus(previous) ? 'session_starting' : 'camera_connected',
              message: trackerReadyFromStatus(previous) ? t.sessionStarting : t.cameraConnected,
            }
          : previous
      );

      await trackingReadyPromise;

      setWarmupStatus((previous) =>
        previous
          ? {
              ...previous,
              stage: 'session_starting',
              message: t.sessionStarting,
            }
          : previous
      );

      try {
        await startWebRTCSession(mediaStream);
      } catch (webRtcError) {
        await activateTransportFallback(mediaStream, webRtcError);
      }
    } catch (err: any) {
      console.error('Camera stream error:', err);
      setErrorMessage(`Camera Error: ${err.message || 'Could not access webcam'}`);
      stopStream();
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

    metadataSocketRef.current?.close();
    metadataSocketRef.current = null;
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
    transportFallbackPromiseRef.current = null;
    frameSocketFallbackRef.current = null;
    frameAbortControllerRef.current?.abort();
    frameAbortControllerRef.current = null;
    lastResultSequenceRef.current = null;
    cadenceMsRef.current = 150;
    latestTracksRef.current = [];
    setOverlayData(EMPTY_OVERLAY);
    setSelectedPerson(null);
    setIsStreaming(false);
    cameraFpsRef.current = null;
    setCameraFps(null);
    setLatencyMs(null);
    setAiUpdateRateHz(null);
    onStreamingChangeRef.current?.(false);

    if (sessionToClose) {
      void deleteSession(sessionToClose).catch((error: unknown) => {
        if (!(error instanceof CrowdApiError && error.status === 404)) {
        }
      });
    }
  }, []);

  const switchCameraFacing = async () => {
    const nextFacing = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextFacing);
    if (isCameraLive) {
      stopStream();
      // Pass the target explicitly: invoking startStream from this render
      // would otherwise reuse the old `facingMode` value and reopen the
      // front camera (or be blocked by the stale live-state guard).
      window.setTimeout(() => {
        void startStream(nextFacing, true);
      }, 300);
    }
  };

  const handleResetSession = async () => {
    if (sessionId) {
      try {
        await resetSession(sessionId);
        latestTracksRef.current = [];
        lastResultSequenceRef.current = null;
        setOverlayData(EMPTY_OVERLAY);
        setSelectedPerson(null);
      } catch (error: unknown) {
        setErrorMessage(getApiErrorMessage(error, 'Unable to reset the session.'));
      }
    }
  };

  const latestTracksRef = useRef<OverlayTrack[]>([]);
  const startSocketFrameLoop = (socket: WebSocket) => {
    if (intervalRef.current) clearTimeout(intervalRef.current);
    lastFrameTimeRef.current = performance.now();
    const effectiveCadenceMs = () => Math.max(FRAME_SOCKET_MIN_CADENCE_MS, cadenceMsRef.current);
    setAiUpdateRateHz(1_000 / effectiveCadenceMs());

    const tick = () => {
      const video = videoRef.current;
      const captureCanvas = captureCanvasRef.current;
      const scheduleNext = () => {
        if (
          frameSocketFallbackRef.current === socket &&
          activeSessionIdRef.current &&
          socket.readyState === WebSocket.OPEN
        ) {
          intervalRef.current = window.setTimeout(tick, effectiveCadenceMs());
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

      const sourceWidth = video.videoWidth || 640;
      const sourceHeight = video.videoHeight || 480;
      const scale = Math.min(1, 640 / sourceWidth);
      const frameWidth = Math.max(1, Math.round(sourceWidth * scale));
      const frameHeight = Math.max(1, Math.round(sourceHeight * scale));
      if (captureCanvas.width !== frameWidth || captureCanvas.height !== frameHeight) {
        captureCanvas.width = frameWidth;
        captureCanvas.height = frameHeight;
      }
      const capCtx = captureCanvas.getContext('2d');
      if (!capCtx) {
        scheduleNext();
        return;
      }
      capCtx.drawImage(video, 0, 0, frameWidth, frameHeight);

      if (
        !isSendingRef.current &&
        socket.readyState === WebSocket.OPEN &&
        socket.bufferedAmount <= FRAME_SOCKET_MAX_BUFFERED_BYTES
      ) {
        isSendingRef.current = true;
        captureCanvas.toBlob(
          (blob) => {
            try {
              if (
                blob &&
                frameSocketFallbackRef.current === socket &&
                socket.readyState === WebSocket.OPEN &&
                socket.bufferedAmount <= FRAME_SOCKET_MAX_BUFFERED_BYTES
              ) {
                socket.send(blob);
              }
            } finally {
              isSendingRef.current = false;
            }
          },
          'image/jpeg',
          0.68
        );
      }
      scheduleNext();
    };

    tick();
  };

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
                frameAbortController.signal
              );
              const roundtripLatency = Math.round(performance.now() - sendTime);
              setLatencyMs(roundtripLatency);

              const resultSequence = res.result_sequence;
              const isNewResult =
                resultSequence != null &&
                (lastResultSequenceRef.current == null || resultSequence > lastResultSequenceRef.current);
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

                const analyticsPayload = res.analytics;
                const liveStreamTelemetry = analyticsPayload?.runtime?.live_stream;
                if (liveStreamTelemetry) {
                  const cadenceMs = liveStreamTelemetry.configured_cadence_ms;
                  if (typeof cadenceMs === 'number' && cadenceMs > 0) {
                    cadenceMsRef.current = cadenceMs;
                    setAiUpdateRateHz(1_000 / cadenceMs);
                  }
                  onTelemetryUpdate?.({
                    ...liveStreamTelemetry,
                    runtime: analyticsPayload?.runtime,
                    camera_fps: cameraFpsRef.current,
                  });
                }
                if (analyticsPayload) onAnalyticsUpdate(analyticsPayload);
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
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.font = '500 11px Inter, sans-serif';

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
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };

    if (overlays.zones) {
      overlayData.zones.forEach((zone, index) => {
        const color = ['#38bdf8', '#8ed5ff', '#ffc176', '#22c55e'][index % 4];
        drawPolygon(zone.polygon, color, `${color}15`);
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
        const color =
          seat.status === 'occupied'
            ? '#22c55e'
            : seat.status === 'disabled'
            ? '#33445c'
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
      const personLabel = longTermPersonLabel(track);
      const isSelected = personLabel != null && selectedPerson?.id === personLabel;
      const boxColor = isSelected ? '#ffc176' : '#38bdf8';

      if (overlays.trajectory && track.trajectory && track.trajectory.length > 1) {
        ctx.beginPath();
        track.trajectory.forEach(([x, y], index) => {
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = `${boxColor}88`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      if (overlays.boxes) {
        ctx.strokeStyle = boxColor;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x1, y1, Math.max(0, x2 - x1), Math.max(0, y2 - y1));
      }

      const labels: string[] = [];
      if (overlays.ids && personLabel) labels.push(personLabel);
      if (labelMode === 'debug') labels.push(`T${track.track_id}`);
      if (overlays.attributes && track.gender) labels.push(track.gender);
      if (labelMode === 'debug' && track.source) labels.push(track.source);
      if (labelMode === 'debug' && typeof track.confidence === 'number') {
        labels.push(`${(track.confidence * 100).toFixed(0)}%`);
      }
      if (overlays.motion && track.motion?.direction) {
        labels.push(track.motion.direction);
      }

      if (labels.length > 0) {
        const label = labels.join(' · ');
        const textWidth = ctx.measureText(label).width;
        const labelHeight = 16;
        const labelY = Math.max(labelHeight, y1);

        ctx.fillStyle = boxColor;
        ctx.fillRect(x1, labelY - labelHeight, textWidth + 8, labelHeight);

        ctx.fillStyle = '#0a0f18';
        ctx.fillText(label, x1 + 4, labelY - 4);
      }
    });
  }, [labelMode, overlayData, overlays, selectedPerson]);

  useEffect(() => {
    if (isVisible) drawOverlay();
  }, [drawOverlay, isVisible]);

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
    const matchedTrack =
      tracks.find((tr) => {
        const b = tr.bbox || [0, 0, 0, 0];
        const x1 = b[0],
          y1 = b[1],
          x2 = b[2],
          y2 = b[3];
        return clickX >= x1 && clickX <= x2 && clickY >= y1 && clickY <= y2;
      }) || tracks[0];

    if (matchedTrack) {
      const tId = matchedTrack.track_id;
      const personLabel = longTermPersonLabel(matchedTrack);
      if (!personLabel) {
        setSelectedPerson(null);
        return;
      }
      const gender = matchedTrack.gender
        ? matchedTrack.gender.toLowerCase().includes('female')
          ? 'Female-presenting'
          : 'Male-presenting'
        : 'Unclassified';
      const confStr =
        typeof matchedTrack.confidence === 'number'
          ? `${(matchedTrack.confidence * 100).toFixed(1)}%`
          : 'Unclassified';

      setSelectedPerson({
        id: personLabel,
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
    {
      label:
        warmupStatus && attributesReadyFromStatus(warmupStatus)
          ? t.attributesReady
          : t.attributesLoading,
      ready: warmupStatus ? attributesReadyFromStatus(warmupStatus) : false,
    },
  ];
  const crowdCapacity = analytics.room_capacity ?? (analytics.total_seats > 0 ? analytics.total_seats : null);

  return (
    <div className="p-4 sm:p-8 flex flex-col lg:flex-row gap-8 lg:gap-10 h-full max-w-7xl mx-auto">
      {/* Left Column: Camera Feed Area (~70-75% of desktop width) */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Video Header Controls */}
        <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
          <div className="flex min-w-0 shrink-0 items-center gap-2">
            <Camera className="w-4 h-4 text-text-muted" />
            <span className="font-mono text-xs text-text-muted uppercase tracking-wider truncate">
              CAM_01_{facingMode === 'user' ? 'FRONT' : 'BACK'}
            </span>
          </div>

          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1 sm:gap-3">
            {/* Switch Camera — kept first and labeled on mobile so it cannot
                be pushed off-screen by the overlay controls. */}
            <Button
              variant="ghost"
              size="sm"
              onClick={switchCameraFacing}
              title={t.switchCam}
              aria-label={t.switchCam}
              className="shrink-0 gap-1 px-2 sm:w-8 sm:px-0"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="sm:hidden">
                {facingMode === 'user' ? 'Cam sau' : 'Cam trước'}
              </span>
            </Button>

            {/* Boxes toggle button */}
            <Button
              variant={overlays.boxes ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => toggleOverlay('boxes')}
              className="gap-1.5 px-2 font-medium sm:px-3"
            >
              <Crop className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.boxes}</span>
            </Button>

            {/* IDs toggle button */}
            <Button
              variant={overlays.ids ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => toggleOverlay('ids')}
              className="gap-1.5 px-2 font-medium sm:px-3"
            >
              <BadgeIcon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.ids}</span>
            </Button>

            {/* Overlays Radix Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1 px-2 font-medium sm:px-3">
                  <Layers className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{t.overlays}</span>
                  <ChevronDown className="hidden w-3.5 h-3.5 sm:inline" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Spatial</DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={overlays.zones}
                  onCheckedChange={() => toggleOverlay('zones')}
                >
                  {t.zones}
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={overlays.seats}
                  onCheckedChange={() => toggleOverlay('seats')}
                >
                  {t.seats}
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={overlays.motion}
                  onCheckedChange={() => toggleOverlay('motion')}
                >
                  {t.motion}
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={overlays.trajectory}
                  onCheckedChange={() => toggleOverlay('trajectory')}
                >
                  {t.trajectory}
                </DropdownMenuCheckboxItem>

                <DropdownMenuSeparator />
                <DropdownMenuLabel>Attributes</DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={overlays.attributes}
                  onCheckedChange={() => toggleOverlay('attributes')}
                >
                  {t.attributes}
                </DropdownMenuCheckboxItem>

                <DropdownMenuSeparator />
                <DropdownMenuLabel>Advanced</DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={labelMode === 'debug'}
                  onCheckedChange={(checked) => setLabelMode(checked ? 'debug' : 'minimal')}
                >
                  {t.debugLabels}
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>

          </div>
        </div>

        {errorMessage && (
          <div className="mb-3 bg-danger/15 border border-danger/40 text-danger p-3 rounded text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Video & Canvas Container */}
        <div className="relative w-full aspect-video bg-black border border-border-default rounded-lg overflow-hidden flex items-center justify-center">
          {/* Local hardware video */}
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-contain pointer-events-none z-0"
            autoPlay
            muted
            playsInline
          />

          {/* Transparent Overlay Canvas */}
          <canvas
            ref={canvasRef}
            width={640}
            height={480}
            onClick={handleCanvasClick}
            className="absolute inset-0 w-full h-full object-contain cursor-crosshair z-10"
            title="Click on any person box to view details"
          />

          {/* Standby Camera Card */}
          {!isCameraLive && (
            <div className="absolute inset-0 bg-[#0A0F18]/95 flex flex-col items-center justify-center p-6 text-center space-y-4 z-20">
              <div className="w-14 h-14 rounded-full bg-surface-secondary border border-border-default flex items-center justify-center text-text-muted">
                <Camera className="w-7 h-7" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-text-primary">{t.cameraStandby}</h3>
                <p className="text-xs text-text-muted max-w-sm mt-1">{t.cameraStandbySub}</p>
              </div>

              {isStarting && (
                <div className="w-full max-w-xs rounded-md border border-border-default bg-surface-secondary p-3 text-left space-y-2">
                  <div className="flex items-center justify-between text-xs text-text-primary">
                    <span>{warmupStatus?.message || t.warmupStart}</span>
                    <span className="text-text-muted">{warmupStatus?.stage || 'starting'}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
                    {startupSteps.map((step) => (
                      <span
                        key={step.label}
                        className={step.ready ? 'text-success' : 'text-text-muted'}
                      >
                        {step.ready ? '✓' : '◌'} {step.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <Button
                variant="default"
                size="lg"
                onClick={toggleStreaming}
                disabled={isStarting}
                className="gap-2"
              >
                {isStarting ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 fill-current" />
                )}
                <span>{isStarting ? t.warmingUp : t.startStream}</span>
              </Button>
            </div>
          )}

          {/* Selected Person Inspector Box */}
          {selectedPerson && (
            <div className="absolute top-4 left-4 bg-surface-primary/95 border border-border-strong rounded-lg p-3 text-xs space-y-1 z-30 shadow-xl min-w-[160px]">
              <div className="flex items-center justify-between gap-3 font-semibold text-primary">
                <span className="flex items-center gap-1">
                  <UserCheck className="w-3.5 h-3.5" /> Person {selectedPerson.id}
                </span>
                <button
                  onClick={() => setSelectedPerson(null)}
                  className="text-text-muted hover:text-text-primary cursor-pointer text-xs"
                >
                  ✕
                </button>
              </div>
              {labelMode === 'debug' && (
                <div className="font-mono text-[11px] text-text-muted">
                  Tracker: <strong className="text-text-primary">{selectedPerson.tracker}</strong>
                </div>
              )}
              <div className="font-mono text-[11px] text-text-muted">
                Attribute: <strong className="text-text-primary">{selectedPerson.attr}</strong>
              </div>
              <div className="font-mono text-[11px] text-text-muted">
                Confidence: <strong className="text-primary">{selectedPerson.confidence}</strong>
              </div>
            </div>
          )}

          {/* Floating Stop Button when stream is active */}
          {isCameraLive && (
            <Button
              variant="destructive"
              size="icon"
              onClick={toggleStreaming}
              className="absolute bottom-4 right-4 rounded-full shadow-lg h-10 w-10 z-20"
              title={t.stopStream}
            >
              <Pause className="w-4 h-4 fill-current" />
            </Button>
          )}
        </div>

        {/* Bottom Status Bar */}
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isStreaming ? 'bg-success animate-pulse' : isCameraLive ? 'bg-warning' : 'bg-text-muted'
              }`}
            />
            <span className="font-mono text-xs text-text-muted">
              {isStreaming
                ? t.monitoringActive
                : isCameraLive
                ? t.preparingMonitoring
                : t.cameraStandby}
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs font-mono text-text-muted">
            {activeTransport && (
              <span className="uppercase text-[10px] px-1.5 py-0.5 rounded bg-surface-secondary border border-border-default">
                {activeTransport}
              </span>
            )}
            {cameraFps != null && <span>{cameraFps} FPS</span>}
            {latencyMs != null && <span>{latencyMs} ms</span>}
            {aiUpdateRateHz != null && <span>{aiUpdateRateHz.toFixed(1)} Hz</span>}
            <button
              onClick={handleResetSession}
              disabled={!sessionId}
              className="hover:text-text-primary transition-colors cursor-pointer disabled:opacity-30"
              title={t.resetTracker}
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Right Side Panel Area (320px width on desktop) */}
      <div className="w-full lg:w-[320px] flex flex-col shrink-0 space-y-8 overflow-y-auto">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold text-text-primary tracking-tight">
            {t.liveMetrics}
          </h2>
        </div>

        <div className="flex flex-col gap-8">
          {/* Total People */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-xs font-semibold text-text-muted uppercase tracking-widest">
                {t.totalPeople}
              </span>
              <Users className="w-4 h-4 text-text-muted" />
            </div>
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-5xl font-semibold text-text-primary leading-none tracking-tight">
                {analytics.total_crowd}
              </span>
              <span className="text-xs text-text-muted pb-1">{t.detected}</span>
            </div>
            <div className="font-mono text-xs text-text-muted mb-2">
              {t.moving} {analytics.moving_count} · {t.stationary} {analytics.stationary_count}
            </div>
            <div className="w-full bg-surface-container-high h-1 rounded-full overflow-hidden">
              <div
                className="bg-primary h-full rounded-full transition-all duration-300"
                style={{
                  width: `${crowdCapacity && crowdCapacity > 0
                    ? Math.min(100, Math.max(0, (analytics.total_crowd / crowdCapacity) * 100))
                    : 0}%`,
                }}
              />
            </div>
          </div>

          {/* Traffic Flow */}
          <div>
            <div className="flex justify-between items-center mb-3">
              <span className="text-xs font-semibold text-text-muted uppercase tracking-widest">
                {t.trafficFlow}
              </span>
              <ArrowDownUp className="w-4 h-4 text-text-muted" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col">
                <span className="font-mono text-xs text-success flex items-center gap-1 mb-1">
                  <ArrowDown className="w-3.5 h-3.5" /> {t.in}
                </span>
                <span className="text-2xl font-semibold text-text-primary font-mono">
                  {analytics.flow_in}
                </span>
              </div>
              <div className="flex flex-col border-l border-border-default pl-4">
                <span className="font-mono text-xs text-danger flex items-center gap-1 mb-1">
                  <ArrowUp className="w-3.5 h-3.5" /> {t.out}
                </span>
                <span className="text-2xl font-semibold text-text-primary font-mono">
                  {analytics.flow_out}
                </span>
              </div>
            </div>
          </div>

          {/* Density */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-xs font-semibold text-text-muted uppercase tracking-widest">
                {t.density}
              </span>
              <Grid className="w-4 h-4 text-text-muted" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-text-primary font-mono">
                {analytics.density_per_m2 != null ? analytics.density_per_m2.toFixed(2) : '—'}
              </span>
              <span className="font-mono text-xs text-text-muted">/ m²</span>
            </div>
            <div className="text-xs text-success mt-1">
              {analytics.density_per_m2 != null ? t.normalLevel : t.calibrationRequired}
            </div>
          </div>

          {/* Seat Occupancy */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-xs font-semibold text-text-muted uppercase tracking-widest">
                {t.seatOccupancy}
              </span>
              <Armchair className="w-4 h-4 text-text-muted" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-text-primary font-mono">
                {analytics.seats_occupied != null && analytics.total_seats > 0
                  ? analytics.seats_occupied
                  : '—'}
              </span>
              <span className="font-mono text-xs text-text-muted">
                / {analytics.total_seats || '—'}
              </span>
            </div>
            <div className="w-full bg-surface-container-high h-1 rounded-full mt-3 overflow-hidden flex">
              <div
                className="bg-primary h-full transition-all duration-300"
                style={{
                  width: `${
                    analytics.total_seats > 0 && analytics.seats_occupied != null
                      ? Math.min(100, Math.round((analytics.seats_occupied / analytics.total_seats) * 100))
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
