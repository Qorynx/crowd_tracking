import React, { useEffect, useRef, useState } from 'react';
import { FileVideo, Upload, CheckCircle2, AlertCircle, Download } from 'lucide-react';
import {
  CrowdApiError,
  getApiErrorMessage,
  getVideoAnalysisJob,
  resolveApiResourceUrl,
  startVideoAnalysis,
} from '@/api/crowdApi';
import type { VideoAnalysisJobStatus, VideoAnalysisResponse } from '@/api/contracts';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const MAX_VIDEO_BYTES = 64 * 1024 * 1024;
const SUPPORTED_VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm']);
const SUPPORTED_VIDEO_LABEL = 'MP4, MOV, AVI, MKV, or WebM';
const ACTIVE_VIDEO_JOB_STORAGE_KEY = 'crowd-active-video-analysis-job';
const VIDEO_JOB_POLL_INTERVAL_MS = 1_500;

function createVideoJobId(): string {
  return globalThis.crypto.randomUUID().replaceAll('-', '');
}

interface VideoPageProps {
  isLive?: boolean;
}

export const VideoPage: React.FC<VideoPageProps> = ({ isLive = false }) => {
  const [file, setFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<VideoAnalysisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(() => (
    typeof window === 'undefined' ? null : window.sessionStorage.getItem(ACTIVE_VIDEO_JOB_STORAGE_KEY)
  ));
  const [jobStatus, setJobStatus] = useState<VideoAnalysisJobStatus | null>(null);
  const submittingRef = useRef(false);
  const annotatedVideoUrl = result?.artifacts.annotated_video_url
    ? resolveApiResourceUrl(result.artifacts.annotated_video_url)
    : null;

  useEffect(() => {
    if (!jobId) return undefined;

    let stopped = false;
    let pollTimer: number | undefined;
    let requestController: AbortController | null = null;
    setAnalyzing(true);

    const finishJob = () => {
      window.sessionStorage.removeItem(ACTIVE_VIDEO_JOB_STORAGE_KEY);
      setJobId(null);
      setAnalyzing(false);
    };

    const schedulePoll = (delay = VIDEO_JOB_POLL_INTERVAL_MS) => {
      if (!stopped) pollTimer = window.setTimeout(poll, delay);
    };

    const poll = async () => {
      requestController = new AbortController();
      try {
        const status = await getVideoAnalysisJob(jobId, requestController.signal);
        if (stopped) return;
        setJobStatus(status);
        setError(null);

        if (status.status === 'completed') {
          if (status.result) {
            setResult(status.result);
          } else {
            setError('Analysis completed without a result payload.');
          }
          finishJob();
          return;
        }
        if (status.status === 'failed') {
          setError(status.error?.message || 'Video analysis failed.');
          finishJob();
          return;
        }
        schedulePoll();
      } catch (pollError: unknown) {
        if (stopped) return;
        if (pollError instanceof CrowdApiError && pollError.status === 404) {
          setError('The previous video job is no longer available. Please submit the clip again.');
          finishJob();
          return;
        }
        // A temporary network/proxy error must not create a duplicate GPU job.
        // Keep the job id and reconnect to the same backend task.
        setError('Status connection was interrupted. Retrying the same analysis job…');
        schedulePoll(2_500);
      }
    };

    void poll();
    return () => {
      stopped = true;
      requestController?.abort();
      if (pollTimer !== undefined) window.clearTimeout(pollTimer);
    };
  }, [jobId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    const extension = `.${selected.name.split('.').pop()?.toLowerCase() || ''}`;
    if (!SUPPORTED_VIDEO_EXTENSIONS.has(extension)) {
      setFile(null);
      setResult(null);
      setError('Unsupported video type. Use MP4, MOV, AVI, MKV, or WebM.');
      return;
    }
    if (selected.size > MAX_VIDEO_BYTES) {
      setFile(null);
      setResult(null);
      setError('Video exceeds the 64 MB demo limit.');
      return;
    }
    setFile(selected);
    setError(null);
    setResult(null);
  };

  const handleUpload = async () => {
    if (!file || analyzing || isLive || submittingRef.current) return;
    submittingRef.current = true;
    const requestedJobId = createVideoJobId();
    window.sessionStorage.setItem(ACTIVE_VIDEO_JOB_STORAGE_KEY, requestedJobId);
    setAnalyzing(true);
    setJobStatus({
      job_id: requestedJobId,
      status: 'queued',
      progress: 0,
      stage: 'uploading',
      message: 'Uploading video to the analysis service.',
      result: null,
      error: null,
    });
    setError(null);

    try {
      const accepted = await startVideoAnalysis(file, 'default', requestedJobId);
      window.sessionStorage.setItem(ACTIVE_VIDEO_JOB_STORAGE_KEY, accepted.job_id);
      setJobStatus({
        job_id: accepted.job_id,
        status: accepted.status,
        progress: 0,
        stage: 'queued',
        message: 'Upload complete. Video is queued for processing.',
        result: null,
        error: null,
      });
      setJobId(accepted.job_id);
    } catch (err: unknown) {
      const acceptanceIsUnknown = err instanceof CrowdApiError && [0, 408, 499].includes(err.status);
      if (acceptanceIsUnknown) {
        setError('Upload response was interrupted. Checking the same job instead of submitting the video again…');
        setJobStatus({
          job_id: requestedJobId,
          status: 'queued',
          progress: 0,
          stage: 'reconnecting',
          message: 'Checking whether the backend accepted this upload.',
          result: null,
          error: null,
        });
        setJobId(requestedJobId);
      } else {
        window.sessionStorage.removeItem(ACTIVE_VIDEO_JOB_STORAGE_KEY);
        setError(getApiErrorMessage(err, 'Video analysis failed or demo GPU busy.'));
        setAnalyzing(false);
        setJobStatus(null);
      }
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <div className="p-6 sm:p-10 max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="border-b border-border-default pb-6">
        <h1 className="text-3xl sm:text-4xl font-semibold text-text-primary tracking-tight">
          Video Analysis
        </h1>
        <p className="text-sm text-text-muted mt-1">
          Upload a recorded clip ({SUPPORTED_VIDEO_LABEL}; max 60 seconds / 64 MB) for offline processing.
        </p>
      </div>

      {/* Main Upload Area */}
      <div className="bg-surface-primary border border-border-default rounded-lg p-8 space-y-6 text-center">
        <div className="border-2 border-dashed border-border-strong hover:border-primary bg-surface-secondary/50 rounded-lg p-10 transition-colors flex flex-col items-center justify-center space-y-3 cursor-pointer relative">
          <input
            type="file"
            accept=".mp4,.mov,.avi,.mkv,.webm,video/*"
            onChange={handleFileChange}
            disabled={isLive || analyzing}
            className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
          />
          <div className="w-14 h-14 rounded-full bg-surface-elevated border border-border-default flex items-center justify-center text-text-muted">
            <FileVideo className="w-7 h-7 text-primary" />
          </div>
          <div>
            <div className="text-sm font-semibold text-text-primary">
              {file ? file.name : 'Click or Drag & Drop Video File'}
            </div>
            <div className="text-xs text-text-muted mt-1 font-mono">
              {file ? `${(file.size / (1024 * 1024)).toFixed(2)} MB` : `${SUPPORTED_VIDEO_LABEL} up to 64 MB`}
            </div>
          </div>
        </div>

        {isLive && (
          <div className="bg-warning/10 border border-warning/30 text-warning p-3 rounded text-xs">
            Stop the active live session before starting video analysis; both paths share the one-GPU demo quota.
          </div>
        )}

        {file && (
          <Button
            variant="default"
            size="lg"
            onClick={handleUpload}
            disabled={analyzing || isLive}
            className="gap-2"
          >
            {analyzing ? (
              <>
                <span className="w-4 h-4 rounded-full border-2 border-[#0A0F18] border-t-transparent animate-spin" />
                Processing Video...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" /> Start Video Analysis
              </>
            )}
          </Button>
        )}

        {analyzing && jobStatus && (
          <div className="max-w-xl mx-auto rounded-lg border border-border-default bg-surface-secondary p-4 text-left space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-text-primary">
                  {jobStatus.stage.replaceAll('_', ' ')}
                </div>
                <p className="mt-1 text-xs text-text-muted">{jobStatus.message}</p>
              </div>
              <span className="font-mono text-xs text-primary">
                {Math.round(Math.max(0, Math.min(1, jobStatus.progress)) * 100)}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-elevated" aria-label="Video analysis progress">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{ width: `${Math.max(2, Math.round(jobStatus.progress * 100))}%` }}
              />
            </div>
            <p className="text-[11px] text-text-muted">
              You can leave this page and return later. The backend will continue this same job without rerunning inference.
            </p>
          </div>
        )}

        {error && (
          <div className="bg-danger/10 border border-danger/30 text-danger p-3 rounded text-xs flex items-center justify-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {result && (
          <div className="space-y-5 text-left">
            {annotatedVideoUrl ? (
              <section className="bg-surface-container-lowest border border-border-strong rounded-lg overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-border-default bg-surface-secondary">
                  <div>
                    <h2 className="font-semibold text-text-primary">Annotated inference video</h2>
                    <p className="text-xs text-text-muted mt-0.5">
                      Bounding boxes and tracking labels are rendered by the backend for every processed frame.
                    </p>
                  </div>
                  <a
                    href={annotatedVideoUrl}
                    download={result.artifacts.annotated_video_filename || 'annotated.mp4'}
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    <Download className="w-4 h-4" /> Download MP4
                  </a>
                </div>
                <video
                  controls
                  playsInline
                  preload="metadata"
                  className="block w-full max-h-[520px] bg-black"
                  src={annotatedVideoUrl}
                >
                  Your browser cannot play this annotated video. Use the download button instead.
                </video>
                {typeof result.artifacts.expires_in_seconds === 'number' && (
                  <p className="px-5 py-3 text-[11px] text-text-muted border-t border-border-default">
                    Result is kept for approximately {Math.ceil(result.artifacts.expires_in_seconds / 60)} minutes.
                  </p>
                )}
              </section>
            ) : (
              <div className="bg-warning/10 border border-warning/30 text-warning p-3 rounded text-xs">
                Analysis completed, but the annotated video file is unavailable. Run the analysis again after the backend is updated.
              </div>
            )}

            <div className="bg-surface-secondary border border-border-default p-5 rounded-lg text-xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold text-sm text-text-primary">
                <CheckCircle2 className="w-4 h-4 text-success" />
                <span>Analysis Completed Successfully</span>
              </div>
              <Badge variant="success">Complete</Badge>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded border border-border-default bg-surface-primary p-3">
                <div className="text-[10px] uppercase tracking-wider text-text-muted">Frames</div>
                <div className="mt-1 font-mono text-sm text-text-primary">
                  {result.input.frames_processed ?? '—'}
                </div>
              </div>
              <div className="rounded border border-border-default bg-surface-primary p-3">
                <div className="text-[10px] uppercase tracking-wider text-text-muted">Duration</div>
                <div className="mt-1 font-mono text-sm text-text-primary">
                  {typeof result.input.duration_seconds === 'number'
                    ? `${result.input.duration_seconds.toFixed(1)} s`
                    : '—'}
                </div>
              </div>
              <div className="rounded border border-border-default bg-surface-primary p-3">
                <div className="text-[10px] uppercase tracking-wider text-text-muted">Processed</div>
                <div className="mt-1 font-mono text-sm text-text-primary">
                  {typeof result.performance.average_processing_fps === 'number'
                    ? `${result.performance.average_processing_fps.toFixed(1)} FPS`
                    : '—'}
                </div>
              </div>
              <div className="rounded border border-border-default bg-surface-primary p-3">
                <div className="text-[10px] uppercase tracking-wider text-text-muted">Mode</div>
                <div className="mt-1 font-mono text-sm text-text-primary truncate" title={result.mode}>
                  {result.mode}
                </div>
              </div>
            </div>
            <p className="text-xs text-text-muted">
              Final frame: {result.analytics?.crowd?.current_count ?? result.analytics?.identity?.active_person_count ?? '—'} tracked people.
            </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
