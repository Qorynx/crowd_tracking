import React from 'react';
import { Cpu, Zap, HardDrive, Clock } from 'lucide-react';
import type { LiveStreamTelemetry } from '../types/analytics';

interface SystemPageProps {
  telemetry: LiveStreamTelemetry;
  t: any;
  isLive?: boolean;
}

export const SystemPage: React.FC<SystemPageProps> = ({ telemetry, t, isLive = false }) => {
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold font-mono text-slate-100 flex items-center gap-2">
            {t.systemTitle}
          </h2>
          <p className="text-xs text-sky-300/80 font-mono">{t.systemSub}</p>
        </div>
      </div>

      {/* Grid Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 font-mono">
        {/* Card 1: Pipeline */}
        <div className="cyber-card p-5 space-y-4">
          <h3 className="text-xs font-bold text-sky-400 uppercase tracking-wider flex items-center gap-2">
            <Cpu className="w-4 h-4 text-cyan-400" />
            {t.pipelineTitle}
          </h3>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between border-b border-sky-500/30 pb-1.5">
              <span className="text-sky-300">{t.detectorLabel}</span>
              <span className="text-cyan-400 font-bold">{isLive ? telemetry.detector_model || '--' : '--'}</span>
            </div>
            <div className="flex justify-between border-b border-sky-500/30 pb-1.5">
              <span className="text-sky-300">{t.trackerLabel}</span>
              <span className="text-slate-100 font-bold">{isLive ? telemetry.tracker_type || '--' : '--'}</span>
            </div>
          </div>
        </div>

        {/* Card 2: Distinct 3 FPS Metrics */}
        <div className="cyber-card p-5 space-y-4">
          <h3 className="text-xs font-bold text-sky-400 uppercase tracking-wider flex items-center gap-2">
            <Zap className="w-4 h-4 text-cyan-400" />
            {t.fps3TierTitle}
          </h3>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between border-b border-sky-500/30 pb-1.5">
              <span className="text-sky-300">{t.cameraFpsLabel}</span>
              <span className="text-slate-100 font-bold">{isLive && telemetry.camera_fps != null ? `${telemetry.camera_fps} FPS` : '--'}</span>
            </div>
            <div className="flex justify-between border-b border-sky-500/30 pb-1.5">
              <span className="text-sky-300">{t.aiHzLabel}</span>
              <span className="text-cyan-400 font-bold">
                {isLive && telemetry.ai_update_rate_hz != null ? `${telemetry.ai_update_rate_hz.toFixed(1)} Hz` : '--'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sky-300">{t.modelFpsLabel}</span>
              <span className="text-slate-100 font-bold">
                {isLive && telemetry.processing_fps != null ? `${telemetry.processing_fps.toFixed(1)} FPS` : '--'}
              </span>
            </div>
          </div>
        </div>

        {/* Card 3: Latencies */}
        <div className="cyber-card p-5 space-y-4">
          <h3 className="text-xs font-bold text-sky-400 uppercase tracking-wider flex items-center gap-2">
            <Clock className="w-4 h-4 text-cyan-400" />
            {t.latenciesTitle}
          </h3>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between border-b border-sky-500/30 pb-1.5">
              <span className="text-sky-300">{t.latencyP50}</span>
              <span className="text-slate-100">{isLive && telemetry.latency_p50_ms != null ? `${telemetry.latency_p50_ms.toFixed(1)} ms` : '--'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sky-300">{t.latencyP95}</span>
              <span className="text-cyan-400 font-bold">{isLive && telemetry.latency_p95_ms != null ? `${telemetry.latency_p95_ms.toFixed(1)} ms` : '--'}</span>
            </div>
          </div>
        </div>

        {/* Card 4: Queue State */}
        <div className="cyber-card p-5 space-y-4">
          <h3 className="text-xs font-bold text-sky-400 uppercase tracking-wider flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-cyan-400" />
            {t.bufferQueueTitle}
          </h3>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between border-b border-sky-500/30 pb-1.5">
              <span className="text-sky-300">{t.receivedFrames}</span>
              <span className="text-slate-100">{telemetry.received_frames ?? '--'}</span>
            </div>
            <div className="flex justify-between border-b border-sky-500/30 pb-1.5">
              <span className="text-sky-300">{t.processedFrames}</span>
              <span className="text-slate-100">{telemetry.processed_frames ?? '--'}</span>
            </div>
            <div className="flex justify-between border-b border-sky-500/30 pb-1.5">
              <span className="text-sky-300">{t.replacedFrames}</span>
              <span className="text-slate-400">{telemetry.replaced_frames ?? '--'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sky-300">{t.pendingFrames}</span>
              <span className="text-emerald-400 font-bold">{telemetry.pending_frames ?? '--'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
