import React from 'react';
import type { AnalyticsData } from '../types/analytics';
import type { ApiAvailability } from '@/api/contracts';

interface OverviewPageProps {
  analytics: AnalyticsData;
  roomCalibrated: boolean;
  roomName?: string;
  isLive: boolean;
  apiStatus: ApiAvailability;
  t: any;
}

export const OverviewPage: React.FC<OverviewPageProps> = ({
  analytics,
  roomCalibrated,
  roomName = 'Classroom A',
  isLive,
  apiStatus,
  t,
}) => {
  const occupancyPct = analytics.occupancy_rate == null ? null : Math.round(analytics.occupancy_rate * 100);
  const hasSeats = analytics.total_seats > 0 && analytics.seats_occupied != null;
  const statusLabel = isLive
    ? t.monitoringActive
    : apiStatus === 'offline'
      ? t.serviceOffline
      : apiStatus === 'not_ready'
        ? t.serviceNotReady
        : apiStatus === 'checking'
          ? t.serviceChecking
          : t.monitoringStandby;
  const statusDescription = isLive
    ? t.allSensorsActive
    : apiStatus === 'offline' || apiStatus === 'not_ready'
      ? t.serviceOffline
      : t.cameraStandbySub;
  const statusColor = isLive
    ? 'bg-success'
    : apiStatus === 'offline'
      ? 'bg-danger'
      : apiStatus === 'not_ready' || apiStatus === 'checking'
        ? 'bg-warning'
        : 'bg-text-muted';

  return (
    <div className="p-6 sm:p-10 max-w-7xl mx-auto space-y-10">
      {/* Top Title Banner */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between border-b border-border-default pb-6 gap-4">
        <div>
          <h2 className="text-3xl sm:text-4xl font-semibold text-text-primary tracking-tight">
            {t.overviewTitle}
          </h2>
          <p className="text-sm text-text-muted mt-1">
            {roomName} · {t.overviewSub}
          </p>
        </div>
        <div className="text-left sm:text-right">
          <span className="font-mono text-xs text-text-muted uppercase tracking-widest">
            {t.lastUpdated}
          </span>
        </div>
      </div>

      {/* Main Grid: Left Primary Metric Zone (8 cols) + Right Room Flow & Status (4 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
        {/* Left Column: Dominant Hero Metrics */}
        <div className="lg:col-span-8 flex flex-col space-y-10">
          {/* Hero: Current Room People Count */}
          <div>
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
              {t.currentRoom}
            </h3>
            <div className="text-7xl sm:text-9xl font-semibold text-text-primary tracking-tighter leading-none mb-3">
              {analytics.total_crowd}
            </div>
            <div className="text-base sm:text-lg text-text-muted">
              {t.peopleCurrentlyInRoom}
            </div>
          </div>

          {/* Moving / Stationary Row */}
          <div className="flex items-center gap-12 border-b border-border-default pb-8">
            <div>
              <div className="text-sm text-text-muted mb-1">{t.moving}</div>
              <div className="text-2xl sm:text-3xl font-semibold text-primary tracking-tight">
                {analytics.moving_count}
              </div>
            </div>
            <div>
              <div className="text-sm text-text-muted mb-1">{t.stationary}</div>
              <div className="text-2xl sm:text-3xl font-semibold text-text-primary tracking-tight">
                {analytics.stationary_count}
              </div>
            </div>
          </div>

          {/* Secondary 3-Column Metrics: Occupancy, Density, Seats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {/* Occupancy */}
            <div>
              <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                {t.occupancy}
              </div>
              <div className="text-2xl sm:text-3xl font-semibold text-text-primary tracking-tight">
                {occupancyPct != null ? `${occupancyPct}%` : '—'}
              </div>
              <div className="text-xs text-text-muted mt-1">
                {analytics.room_capacity != null
                  ? `${analytics.room_capacity} max capacity`
                  : t.notConfigured}
              </div>
            </div>

            {/* Density */}
            <div>
              <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                {t.density}
              </div>
              <div className="text-2xl sm:text-3xl font-semibold text-text-primary tracking-tight">
                {roomCalibrated && analytics.density_per_m2 != null ? (
                  <>
                    {analytics.density_per_m2.toFixed(2)}{' '}
                    <span className="text-sm font-normal text-text-muted">/m²</span>
                  </>
                ) : (
                  '—'
                )}
              </div>
              <div className="text-xs text-text-muted mt-1">
                {roomCalibrated ? t.calibratedArea : t.calibrationRequired}
              </div>
            </div>

            {/* Seats */}
            <div>
              <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                {t.seats}
              </div>
              <div className="text-2xl sm:text-3xl font-semibold text-text-primary tracking-tight">
                {hasSeats ? (
                  <>
                    {analytics.seats_occupied}{' '}
                    <span className="text-sm font-normal text-text-muted">
                      / {analytics.total_seats}
                    </span>
                  </>
                ) : (
                  '—'
                )}
              </div>
              <div className="text-xs text-text-muted mt-1">
                {hasSeats
                  ? `${analytics.total_seats - (analytics.seats_occupied || 0)} ${t.vacantSeats}`
                  : t.notConfigured}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Room Flow & Status */}
        <div className="lg:col-span-4 lg:border-l lg:border-border-default lg:pl-12 flex flex-col space-y-10">
          {/* Room Flow */}
          <div>
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-6">
              {t.roomFlow}
            </h3>
            <div className="space-y-5">
              {/* IN */}
              <div className="flex justify-between items-baseline border-b border-border-default pb-4">
                <div>
                  <span className="text-xl font-semibold text-text-primary block">
                    {t.in}
                  </span>
                  <span className="text-xs text-text-muted">
                    {analytics.flow_in} {t.total}
                  </span>
                </div>
                <span className="font-mono text-base font-semibold text-success">
                  +{analytics.flow_in_per_minute.toFixed(1)}{t.perMin}
                </span>
              </div>

              {/* OUT */}
              <div className="flex justify-between items-baseline border-b border-border-default pb-4">
                <div>
                  <span className="text-xl font-semibold text-text-muted block">
                    {t.out}
                  </span>
                  <span className="text-xs text-text-muted">
                    {analytics.flow_out} {t.total}
                  </span>
                </div>
                <span className="font-mono text-base font-semibold text-warning">
                  {analytics.flow_out_per_minute.toFixed(1)}{t.perMin}
                </span>
              </div>

              {/* NET FLOW */}
              <div className="flex justify-between items-baseline pt-1">
                <span className="text-xs font-semibold text-text-primary uppercase tracking-wider">
                  {t.netFlow}
                </span>
                <span className="font-mono text-base font-semibold text-primary">
                  {analytics.net_flow_per_minute > 0 ? '+' : ''}
                  {analytics.net_flow_per_minute.toFixed(1)}{t.perMin}
                </span>
              </div>
            </div>
          </div>

          {/* Room Status */}
          <div className="pt-4 border-t border-border-default lg:border-t-0 lg:pt-0">
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
              {t.roomStatus}
            </h3>
            <p className="text-sm font-medium text-text-primary flex items-center gap-2 mb-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
              {statusLabel}
            </p>
            <p className="font-mono text-xs text-text-muted leading-relaxed">
              {statusDescription}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
