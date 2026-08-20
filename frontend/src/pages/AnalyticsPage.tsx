import React, { useMemo } from 'react';
import { Clock, HelpCircle, Grid3X3 } from 'lucide-react';
import type { AnalyticsData, ZoneData } from '@/types/analytics';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';

interface AnalyticsPageProps {
  analytics: AnalyticsData;
  t: any;
  isLive?: boolean;
}

export const AnalyticsPage: React.FC<AnalyticsPageProps> = ({ analytics, t, isLive = false }) => {
  const spatialData = analytics.spatial || {};
  const zones = analytics.zones;
  const heatmap = spatialData.heatmap || {};
  const heatmapValues = Array.isArray(heatmap.values) ? (heatmap.values as number[][]) : [];
  const heatmapMax = Math.max(...heatmapValues.flat().map((value) => Number(value) || 0), 0);
  const heatmapGridSize = Array.isArray(heatmap.grid_size) ? heatmap.grid_size.map(Number) : [];
  const zoneRows = useMemo<ZoneData[]>(
    () =>
      zones.map((zone) => ({
        ...zone,
        peopleCount: Number(zone.peopleCount) || 0,
        density: Number.isFinite(zone.density) ? zone.density : null,
      })),
    [zones]
  );

  return (
    <div className="p-6 sm:p-8 max-w-7xl mx-auto space-y-8">
      {!isLive && (
        <div
          className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-text-secondary"
          role="status"
          aria-live="polite"
        >
          {t.analyticsStandby}
        </div>
      )}

      <Tabs defaultValue="spatial" className="w-full">
        {/* Sub-header Navigation with Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between border-b border-border-default pb-0 gap-4">
          <TabsList className="border-b-0">
            <TabsTrigger value="spatial">{t.spatialZonesTab}</TabsTrigger>
            <TabsTrigger value="attributes">{t.visualAttributesTab}</TabsTrigger>
          </TabsList>

          <div className="font-mono text-xs text-text-muted flex items-center gap-1.5 pb-3">
            <Clock className="w-3.5 h-3.5" />
            <span>{t.dataSnapshot}</span>
          </div>
        </div>

        {/* Spatial Tab Content */}
        <TabsContent value="spatial" className="space-y-8 mt-8">
          {/* Main Grid: Heatmap (8 cols) + Zone Distribution (4 cols) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left: Density Heatmap Panel (8 cols) */}
            <section className="lg:col-span-8 flex flex-col bg-surface-primary border border-border-default rounded-lg overflow-hidden">
              {/* Header */}
              <header className="flex justify-between items-center p-5 border-b border-border-default bg-surface-elevated/40">
                <div>
                  <h2 className="text-base font-semibold text-text-primary">{t.densityHeatmap}</h2>
                  <p className="text-xs text-text-muted mt-0.5">{t.spatialSub}</p>
                </div>
                <Badge variant="secondary" className="font-mono gap-1">
                  <Grid3X3 className="w-3 h-3" />
                  <span>{t.grid} {heatmapGridSize.length === 2 ? `${heatmapGridSize[0]}×${heatmapGridSize[1]}` : '—'}</span>
                </Badge>
              </header>

              {/* Heatmap Canvas */}
              <div className="flex-1 relative bg-surface-container-lowest min-h-[340px] sm:min-h-[400px] flex items-center justify-center p-6 overflow-hidden">
                {/* Background grid */}
                <div className="absolute inset-0 grid-pattern opacity-20 pointer-events-none" />

                {/* Room Boundary Box */}
                <div className="absolute inset-6 sm:inset-10 border border-border-strong/40 rounded-sm pointer-events-none">
                  {/* Top instruction zone indicator */}
                  <div className="absolute left-4 right-4 top-4 border-b border-dashed border-border-strong/40 pb-2">
                    <span className="font-mono text-[10px] text-text-muted uppercase tracking-widest">
                      {t.frontLectern}
                    </span>
                  </div>

                  {/* Entrance: upper-right corner, aligned vertically with the
                      classroom's right wall rather than at the rear edge. */}
                  <div className="absolute right-[-1px] top-8 flex h-28 w-28 items-center justify-center border-y border-l border-primary/60 bg-surface-container-lowest/95 px-2 text-center">
                    <span className="font-mono text-[10px] text-primary uppercase tracking-widest [writing-mode:vertical-rl]">
                      {t.rightEntrance}
                    </span>
                  </div>
                </div>

                {/* Real Heatmap Matrix Render */}
                {heatmapValues.length > 0 ? (
                  <div className="relative z-10 w-full max-w-lg p-4">
                    <div
                      className="grid gap-1"
                      style={{
                        gridTemplateColumns: `repeat(${heatmapValues[0]?.length || 1}, minmax(0, 1fr))`,
                      }}
                    >
                      {heatmapValues.flatMap((row, rIdx) =>
                        row.map((value, cIdx) => {
                          const intensity =
                            heatmapMax > 0 ? Math.min(1, (Number(value) || 0) / heatmapMax) : 0;
                          return (
                            <div
                              key={`${rIdx}-${cIdx}`}
                              title={`Value: ${Number(value || 0).toFixed(2)}`}
                              className="aspect-square rounded-sm transition-opacity"
                              style={{
                                backgroundColor:
                                  intensity > 0
                                    ? `rgba(56, 189, 248, ${0.15 + intensity * 0.8})`
                                    : 'rgba(30, 41, 59, 0.25)',
                              }}
                            />
                          );
                        })
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="relative z-10 text-center py-16">
                    <p className="text-xs font-mono text-text-muted">
                      Waiting for confirmed tracks to render real spatial density map.
                    </p>
                  </div>
                )}
              </div>

              {/* Heatmap Legend */}
              <footer className="p-3.5 border-t border-border-default bg-surface-secondary flex items-center justify-between">
                <span className="font-mono text-[11px] text-text-muted uppercase tracking-wider">
                  {t.densityInterpolation}
                </span>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-text-muted">{t.low}</span>
                  <div className="w-36 h-2 rounded-full overflow-hidden flex bg-surface-primary border border-border-default/50">
                    <div className="h-full flex-1 bg-primary/30" />
                    <div className="h-full flex-1 bg-primary/70" />
                    <div className="h-full flex-1 bg-tertiary-container" />
                  </div>
                  <span className="font-mono text-xs text-text-muted">{t.high}</span>
                </div>
              </footer>
            </section>

            {/* Right: Zone Distribution Panel (4 cols) */}
            <aside className="lg:col-span-4 bg-surface-secondary border border-border-default rounded-lg p-6 flex flex-col justify-between gap-6">
              <div>
                <header className="mb-6">
                  <h3 className="text-base font-semibold text-text-primary">{t.zoneDistribution}</h3>
                  <p className="text-xs text-text-muted mt-0.5">{t.currentOccupancyByArea}</p>
                </header>

                {zoneRows.length > 0 ? (
                  <div className="space-y-6">
                    {zoneRows.map((zone, index) => {
                      const colors = ['bg-tertiary-container', 'bg-primary', 'bg-secondary'];
                      return (
                        <div key={zone.name}>
                          <div className="flex justify-between items-baseline mb-2 text-xs">
                            <span className="text-text-primary font-medium">{zone.name}</span>
                            <span className="font-mono text-base font-semibold text-text-primary">
                              {zone.peopleCount}
                            </span>
                          </div>
                          <div className="w-full bg-surface-primary h-1.5 rounded-full overflow-hidden">
                            <div
                              className={`${colors[index % colors.length]} h-full rounded-full transition-all duration-300`}
                              style={{ width: `${Math.min(100, Math.max(0, zone.percentage))}%` }}
                            />
                          </div>
                          <div className="mt-1 text-[11px] text-text-muted font-mono">
                            {zone.percentage}% · {zone.density == null ? '—' : `${zone.density.toFixed(2)} /m²`}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-text-muted font-mono leading-relaxed">
                    {t.noConfiguredZones}
                  </p>
                )}
              </div>

              {/* Total Headcount */}
              <div className="pt-6 border-t border-border-default flex justify-between items-baseline">
                <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                  {t.totalHeadcount}
                </span>
                <span className="text-4xl font-semibold text-text-primary font-mono">
                  {analytics.total_crowd}
                </span>
              </div>
            </aside>
          </div>

          {/* Zone Performance Table */}
          {zoneRows.length > 0 && (
            <div className="bg-surface-primary border border-border-default rounded-lg p-5">
              <h3 className="text-sm font-semibold text-text-primary mb-4">
                {t.zoneMetricsTitle}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-surface-secondary text-text-muted uppercase tracking-wider border-b border-border-default">
                    <tr>
                      <th className="px-4 py-3 font-medium">{t.zoneHeader}</th>
                      <th className="px-4 py-3 font-medium">{t.peopleHeader}</th>
                      <th className="px-4 py-3 font-medium">{t.densityHeader}</th>
                      <th className="px-4 py-3 font-medium">{t.dwellHeader}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default text-text-primary">
                    {zoneRows.map((zone) => (
                      <tr key={zone.name} className="hover:bg-surface-secondary/50 transition-colors">
                        <td className="px-4 py-3 font-semibold text-primary">{zone.name}</td>
                        <td className="px-4 py-3">{zone.peopleCount}</td>
                        <td className="px-4 py-3">
                          {zone.density == null ? '—' : `${zone.density.toFixed(2)} /m²`}
                        </td>
                        <td className="px-4 py-3 text-text-muted">{zone.avgDwellTime}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Attributes Tab Content */}
        <TabsContent value="attributes" className="mt-8">
          <div className="bg-surface-primary border border-border-default rounded-lg p-6 max-w-xl space-y-6">
            <div>
              <h3 className="text-base font-semibold text-text-primary">{t.visualTitle}</h3>
              <p className="text-xs text-text-muted mt-1">{t.visualSub}</p>
            </div>

            <div className="space-y-3 font-mono text-xs">
              <div className="flex justify-between items-center bg-surface-secondary p-3.5 rounded border border-border-default">
                <span className="text-text-muted">{t.femaleLabel}</span>
                <span className="text-lg font-semibold text-text-primary">
                  {analytics.visual_presentation.female_presenting}
                </span>
              </div>

              <div className="flex justify-between items-center bg-surface-secondary p-3.5 rounded border border-border-default">
                <span className="text-text-muted">{t.maleLabel}</span>
                <span className="text-lg font-semibold text-text-primary">
                  {analytics.visual_presentation.male_presenting}
                </span>
              </div>

              <div className="flex justify-between items-center bg-surface-secondary p-3.5 rounded border border-border-default">
                <span className="text-text-muted flex items-center gap-1.5">
                  <HelpCircle className="w-3.5 h-3.5" />
                  {t.unknownLabel}
                </span>
                <span className="text-lg font-semibold text-text-muted">
                  {analytics.visual_presentation.unknown}
                </span>
              </div>

              <div className="flex justify-between items-center pt-3 border-t border-border-default text-xs">
                <span className="text-text-muted">{t.coveragePct}</span>
                <span className="text-primary font-semibold">
                  {analytics.visual_presentation.coverage_pct}%
                </span>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};
