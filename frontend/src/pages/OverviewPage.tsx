import React, { lazy, Suspense } from 'react';
import { Users, Percent, Map, Armchair, ArrowUpRight, ArrowDownRight, TrendingUp, Hexagon } from 'lucide-react';
import type { AnalyticsData } from '../types/analytics';

const OverviewRadarChart = lazy(() => import('./OverviewRadarChart'));

interface OverviewPageProps {
  analytics: AnalyticsData;
  roomCalibrated: boolean;
  roomName?: string;
  t: any;
}

export const OverviewPage: React.FC<OverviewPageProps> = ({ analytics, roomCalibrated, roomName = 'Classroom', t }) => {
  const occupancyPct = analytics.occupancy_rate == null ? null : Math.round(analytics.occupancy_rate * 100);
  const hexagonData = [
    { subject: 'Density', value: Math.min(100, (analytics.density_per_m2 ?? 0) * 200) },
    { subject: 'Occupancy', value: occupancyPct ?? 0 },
    { subject: 'Flow Rate', value: Math.min(100, analytics.flow_in * 3) },
    { subject: 'Seats Used', value: analytics.total_seats > 0 && analytics.seats_occupied != null ? Math.round((analytics.seats_occupied / analytics.total_seats) * 100) : 0 },
    { subject: 'Motion Index', value: Math.min(100, analytics.moving_count * 20) },
    { subject: 'AI Coverage', value: analytics.visual_presentation.coverage_pct },
  ];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Banner */}
      <div className="cyber-card p-6 rounded-xl flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold font-mono text-slate-100 flex items-center gap-2">
              {t.overviewTitle}
            </h2>
            <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-cyan-400/20 text-cyan-300 border border-cyan-400/40 font-mono font-bold">
              {roomName} // LIVE
            </span>
          </div>
          <p className="text-xs text-sky-300/80 mt-1 font-mono">{t.overviewSub}</p>
        </div>
        <div className="text-right font-mono">
          <div className="text-xs text-sky-400">{t.totalRoomArea}</div>
          <div className="text-2xl font-bold text-cyan-300">{analytics.room_area_m2 != null ? `${analytics.room_area_m2.toFixed(1)} m²` : '--'}</div>
        </div>
      </div>

      {/* Primary KPI Hierarchy Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Card 1: PEOPLE */}
            <div className="cyber-card p-4 space-y-2 cursor-pointer">
              <div className="flex items-center justify-between text-sky-400 text-xs font-mono font-bold uppercase tracking-wider">
                <span>{t.peopleCount}</span>
                <Users className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="text-4xl font-mono font-bold text-cyan-300">{analytics.total_crowd}</div>
              <div className="text-xs text-emerald-400 flex items-center gap-1 font-mono">
                <ArrowUpRight className="w-3.5 h-3.5" />
                <span>+2 / 5min</span>
              </div>
            </div>

            {/* Card 2: OCCUPANCY */}
            <div className="cyber-card p-4 space-y-2 cursor-pointer">
              <div className="flex items-center justify-between text-sky-400 text-xs font-mono font-bold uppercase tracking-wider">
                <span>{t.occupancyRate}</span>
                <Percent className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="text-4xl font-mono font-bold text-slate-100">
                {occupancyPct == null ? '--' : `${occupancyPct}%`}
              </div>
              <div className="text-xs text-sky-300/80 font-mono">{analytics.room_capacity != null ? t.highCapacity : 'Formal capacity not configured'}</div>
            </div>

            {/* Card 3: DENSITY */}
            <div className="cyber-card p-4 space-y-2 cursor-pointer">
              <div className="flex items-center justify-between text-sky-400 text-xs font-mono font-bold uppercase tracking-wider">
                <span>{t.densityPerM2}</span>
                <Map className="w-4 h-4 text-cyan-400" />
              </div>
              {roomCalibrated ? (
                <div>
                  <div className="text-3xl font-mono font-bold text-slate-100">
                    {analytics.density_per_m2} <span className="text-sm text-sky-300 font-sans">/m²</span>
                  </div>
                  <div className="text-xs text-sky-300/80 font-mono">{t.calibratedArea}</div>
                </div>
              ) : (
                <div>
                  <div className="text-lg font-bold text-amber-400">---</div>
                  <div className="text-xs text-amber-400">Room calibration required</div>
                </div>
              )}
            </div>

            {/* Card 4: SEATS */}
            <div className="cyber-card p-4 space-y-2 cursor-pointer">
              <div className="flex items-center justify-between text-sky-400 text-xs font-mono font-bold uppercase tracking-wider">
                <span>{t.seatsOccupied}</span>
                <Armchair className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="text-3xl font-mono font-bold text-slate-100">
                {analytics.total_seats > 0 && analytics.seats_occupied != null
                  ? <>{analytics.seats_occupied} <span className="text-lg text-sky-300">/ {analytics.total_seats}</span></>
                  : '--'}
              </div>
              <div className="text-xs text-sky-300/80 font-mono">
                {analytics.total_seats > 0 && analytics.seats_occupied != null ? `${analytics.total_seats - analytics.seats_occupied} ${t.vacantSeats}` : '--'}
              </div>
            </div>

            {/* Card 5: MOVING */}
            <div className="cyber-card p-4 space-y-2 cursor-pointer">
              <div className="flex items-center justify-between text-sky-400 text-xs font-mono font-bold uppercase tracking-wider">
                <span>{t.movingCount}</span>
                <TrendingUp className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="text-3xl font-mono font-bold text-amber-400">{analytics.moving_count}</div>
              <div className="text-xs text-sky-300/80 font-mono">{analytics.stationary_count} {t.stationaryCount}</div>
            </div>

            {/* Card 6: AI COVERAGE */}
            <div className="cyber-card p-4 space-y-2 cursor-pointer">
              <div className="flex items-center justify-between text-sky-400 text-xs font-mono font-bold uppercase tracking-wider">
                <span>{t.aiCoverage}</span>
                <Hexagon className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="text-3xl font-mono font-bold text-emerald-400">
                {analytics.visual_presentation.coverage_pct}%
              </div>
              <div className="text-xs text-sky-300/80 font-mono">{t.classifierActive}</div>
            </div>
          </div>

          {/* Room Flow Rate Slanted Equalizer Panel */}
          <div className="cyber-card p-5 space-y-4">
            <h3 className="text-base font-bold font-mono text-slate-100 flex items-center gap-2">
              {t.flowTitle}
            </h3>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="bg-[#071120] p-4 rounded-xl border border-sky-500/30">
                <div className="text-xs text-sky-300 font-mono flex items-center justify-center gap-1">
                  <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" /> {t.inRate}
                </div>
                <div className="text-3xl font-mono font-bold text-emerald-400 mt-1">+{analytics.flow_in}</div>
              </div>

              <div className="bg-[#071120] p-4 rounded-xl border border-sky-500/30">
                <div className="text-xs text-sky-300 font-mono flex items-center justify-center gap-1">
                  <ArrowDownRight className="w-3.5 h-3.5 text-rose-400" /> {t.outRate}
                </div>
                <div className="text-3xl font-mono font-bold text-rose-400 mt-1">-{analytics.flow_out}</div>
              </div>

              <div className="bg-[#071120] p-4 rounded-xl border border-sky-500/30">
                <div className="text-xs text-sky-300 font-mono">{t.netFlow}</div>
                <div className="text-3xl font-mono font-bold text-cyan-400 mt-1">{analytics.net_flow > 0 ? '+' : ''}{analytics.net_flow}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Hexagon Spider Radar Chart */}
        <div className="cyber-card p-5 space-y-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-sky-500/30 pb-3">
              <h3 className="text-base font-bold font-mono text-slate-100 flex items-center gap-2">
                <Hexagon className="w-5 h-5 text-cyan-400 animate-spin-slow" />
                {t.hexagonTitle}
              </h3>
              <span className="text-[10px] font-mono text-cyan-300 bg-cyan-400/15 border border-cyan-400/30 px-2 py-0.5 rounded">
                6-AXIS
              </span>
            </div>
            <p className="text-xs text-sky-300/80 font-mono mt-2">
              {t.hexagonSub}
            </p>
          </div>

          <div className="h-64 w-full my-auto">
            <Suspense fallback={<div className="h-full flex items-center justify-center text-xs font-mono text-cyan-300">Loading chart...</div>}>
              <OverviewRadarChart data={hexagonData} />
            </Suspense>
          </div>

          <div className="p-3 bg-[#071120] border border-sky-500/30 rounded-xl text-center text-xs font-mono text-cyan-300">
            {t.equilibriumScore} <strong className="text-emerald-400 text-sm">{analytics.total_crowd > 0 ? 'LIVE' : '--'}</strong>
          </div>
        </div>
      </div>
    </div>
  );
};
