import React from 'react';
import { Cpu, Radio, Gauge, Layers, CheckCircle2 } from 'lucide-react';
import type { LiveStreamTelemetry } from '@/types/analytics';
import type { ApiAvailability } from '@/api/contracts';
import { Badge } from '@/components/ui/badge';

interface SystemPageProps {
  telemetry: LiveStreamTelemetry;
  t: any;
  isLive?: boolean;
  apiStatus: ApiAvailability;
}

export const SystemPage: React.FC<SystemPageProps> = ({ telemetry, t, isLive = false, apiStatus }) => {
  const statusLabel = apiStatus === 'offline'
    ? t.serviceOffline
    : apiStatus === 'not_ready'
      ? t.serviceNotReady
      : apiStatus === 'checking'
        ? t.serviceChecking
        : isLive
          ? t.monitoringActive
          : t.systemReady;
  const statusVariant = apiStatus === 'offline'
    ? 'destructive'
    : apiStatus === 'not_ready' || apiStatus === 'checking'
      ? 'warning'
      : 'success';

  return (
    <div className="p-6 sm:p-10 max-w-4xl mx-auto space-y-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border-default pb-6">
        <div>
          <h1 className="text-3xl sm:text-4xl font-semibold text-text-primary tracking-tight">
            {t.systemDiagnostics}
          </h1>
          <p className="text-sm text-text-muted mt-1">{t.realtimeTelemetry}</p>
        </div>

        {/* Status Pill */}
          <Badge variant={statusVariant} className="px-3.5 py-1.5 self-start sm:self-auto">
            <CheckCircle2 className="w-4 h-4" />
            <span>{statusLabel}</span>
        </Badge>
      </div>

      {/* Diagnostics Category Rows */}
      <div className="space-y-12">
        {/* Category: System Status */}
        <section>
          <h2 className="text-base font-semibold text-text-primary mb-3 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-text-muted" />
            <span>{t.systemStatus}</span>
          </h2>
          <div className="border-t border-border-default divide-y divide-border-default text-xs">
            <div className="flex justify-between items-center py-3.5 px-2 hover:bg-surface-secondary/40 transition-colors">
              <span className="text-text-muted">{t.coreService}</span>
              <span className="font-mono font-semibold text-success flex items-center gap-2">
                {apiStatus === 'ready' ? t.online : statusLabel}
                <span className={`w-1.5 h-1.5 rounded-full ${apiStatus === 'ready' ? 'bg-success animate-pulse' : 'bg-warning'}`} />
              </span>
            </div>
            <div className="flex justify-between items-center py-3.5 px-2 hover:bg-surface-secondary/40 transition-colors">
              <span className="text-text-muted">{t.uptime}</span>
              <span className="font-mono text-text-primary">
                {apiStatus === 'offline' || apiStatus === 'not_ready'
                  ? statusLabel
                  : isLive
                    ? 'Active Session'
                    : 'Ready'}
              </span>
            </div>
          </div>
        </section>

        {/* Category: Connection */}
        <section>
          <h2 className="text-base font-semibold text-text-primary mb-3 flex items-center gap-2">
            <Radio className="w-4 h-4 text-text-muted" />
            <span>{t.connection}</span>
          </h2>
          <div className="border-t border-border-default divide-y divide-border-default text-xs font-mono">
            <div className="flex justify-between items-center py-3.5 px-2 hover:bg-surface-secondary/40 transition-colors">
              <span className="text-text-muted font-sans">{t.latencyP50}</span>
              <span className="text-text-primary">
                {isLive && telemetry.latency_p50_ms != null ? `${telemetry.latency_p50_ms} ms` : '—'}
              </span>
            </div>
            <div className="flex justify-between items-center py-3.5 px-2 hover:bg-surface-secondary/40 transition-colors">
              <span className="text-text-muted font-sans">{t.latencyP95}</span>
              <span className="text-warning font-semibold">
                {isLive && telemetry.latency_p95_ms != null ? `${telemetry.latency_p95_ms} ms` : '—'}
              </span>
            </div>
          </div>
        </section>

        {/* Category: Processing */}
        <section>
          <h2 className="text-base font-semibold text-text-primary mb-3 flex items-center gap-2">
            <Gauge className="w-4 h-4 text-text-muted" />
            <span>{t.processing}</span>
          </h2>
          <div className="border-t border-border-default divide-y divide-border-default text-xs font-mono">
            <div className="flex justify-between items-center py-3.5 px-2 hover:bg-surface-secondary/40 transition-colors">
              <span className="text-text-muted font-sans">{t.processingRate}</span>
              <span className="text-text-primary font-semibold">
                {isLive && telemetry.processing_fps != null
                  ? `${telemetry.processing_fps.toFixed(1)} FPS`
                  : '—'}
              </span>
            </div>
            <div className="flex justify-between items-center py-3.5 px-2 hover:bg-surface-secondary/40 transition-colors">
              <span className="text-text-muted font-sans">{t.updateRate}</span>
              <span className="text-text-primary font-semibold">
                {isLive && telemetry.ai_update_rate_hz != null
                  ? `${telemetry.ai_update_rate_hz.toFixed(1)} Hz`
                  : '—'}
              </span>
            </div>
          </div>
        </section>

        {/* Category: Pipeline */}
        <section>
          <h2 className="text-base font-semibold text-text-primary mb-3 flex items-center gap-2">
            <Layers className="w-4 h-4 text-text-muted" />
            <span>{t.pipeline}</span>
          </h2>
          <div className="border-t border-border-default divide-y divide-border-default text-xs font-mono">
            <div className="flex justify-between items-center py-3.5 px-2 hover:bg-surface-secondary/40 transition-colors">
              <span className="text-text-muted font-sans">{t.cameraInput}</span>
              <span className="text-text-primary">
                {isLive && telemetry.camera_fps != null ? `${telemetry.camera_fps} FPS` : '—'}
              </span>
            </div>
            <div className="flex justify-between items-center py-3.5 px-2 hover:bg-surface-secondary/40 transition-colors">
              <span className="text-text-muted font-sans">{t.detectorModel}</span>
              <span className="text-primary font-semibold">
                {telemetry.detector_model || '—'}
              </span>
            </div>
            <div className="flex justify-between items-center py-3.5 px-2 hover:bg-surface-secondary/40 transition-colors">
              <span className="text-text-muted font-sans">{t.trackerEngine}</span>
              <span className="text-primary font-semibold">
                {telemetry.tracker_type || '—'}
              </span>
            </div>
            <div className="flex justify-between items-center py-3.5 px-2 hover:bg-surface-secondary/40 transition-colors">
              <span className="text-text-muted font-sans">{t.pendingFrames}</span>
              <span className="text-text-primary font-semibold">
                {isLive && telemetry.pending_frames != null ? telemetry.pending_frames : '—'}
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
