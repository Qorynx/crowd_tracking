import React from 'react';
import { Camera, Zap, Cpu, Clock } from 'lucide-react';
import type { LiveStreamTelemetry } from '../../types/analytics';

interface FooterProps {
  telemetry: LiveStreamTelemetry;
  isLive?: boolean;
}

export const Footer: React.FC<FooterProps> = ({ telemetry, isLive = false }) => {
  return (
    <footer className="hidden md:flex h-10 bg-[#0b172a]/95 backdrop-blur-md border-t border-sky-500/40 px-4 items-center justify-between text-xs text-slate-300 font-mono sticky bottom-0 z-40 shadow-lg">
      <div className="flex items-center space-x-6">
        <div className="flex items-center space-x-2">
          <Camera className="w-3.5 h-3.5 text-cyan-400" />
          <span>CAM: <strong className="text-slate-100">{isLive && telemetry.camera_fps != null ? `${telemetry.camera_fps} FPS` : '--'}</strong></span>
        </div>

        <div className="flex items-center space-x-2">
          <Zap className="w-3.5 h-3.5 text-cyan-400" />
          <span>AI RATE: <strong className="text-cyan-400 font-bold">{isLive && telemetry.ai_update_rate_hz != null ? `${telemetry.ai_update_rate_hz.toFixed(1)} Hz` : '--'}</strong></span>
        </div>

        <div className="flex items-center space-x-2">
          <Cpu className="w-3.5 h-3.5 text-slate-400" />
          <span>MODEL PROC: <strong className="text-slate-100">{isLive && telemetry.processing_fps != null ? `${telemetry.processing_fps.toFixed(1)} FPS` : '--'}</strong></span>
        </div>

        <div className="flex items-center space-x-2">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          <span>LATENCY P95: <strong className="text-slate-100">{isLive && telemetry.latency_p95_ms != null ? `${telemetry.latency_p95_ms.toFixed(1)} ms` : '--'}</strong></span>
        </div>
      </div>
    </footer>
  );
};
