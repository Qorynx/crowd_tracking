import React, { useMemo, useState } from 'react';
import { Activity, PieChart, BarChart3, HelpCircle } from 'lucide-react';
import type { AnalyticsData, ZoneData } from '../types/analytics';

interface AnalyticsPageProps {
  analytics: AnalyticsData;
  t: any;
}

const zoneColors = ['bg-cyan-400', 'bg-sky-400', 'bg-purple-400', 'bg-amber-400', 'bg-emerald-400'];

export const AnalyticsPage: React.FC<AnalyticsPageProps> = ({ analytics, t }) => {
  const [subTab, setSubTab] = useState<'spatial' | 'attributes'>('spatial');
  const [hoveredZone, setHoveredZone] = useState<string | null>(null);
  const spatialData = analytics.spatial || {};
  const zones = analytics.zones;
  const heatmap = spatialData.heatmap || {};
  const heatmapValues = Array.isArray(heatmap.values) ? heatmap.values as number[][] : [];
  const heatmapMax = Math.max(...heatmapValues.flat().map((value) => Number(value) || 0), 0);
  const density = analytics.density_per_m2;

  const zoneRows = useMemo<ZoneData[]>(() => zones.map((zone) => ({
    ...zone,
    peopleCount: Number(zone.peopleCount) || 0,
    density: Number.isFinite(zone.density) ? zone.density : 0,
  })), [zones]);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-xl font-bold font-mono text-slate-100 flex items-center gap-2">{t.spatialTitle}</h2><p className="text-xs text-sky-300/80 font-mono">{t.spatialSub}</p></div><div className="flex space-x-2 bg-[#071120] border border-sky-500/40 p-1 rounded-lg text-xs font-mono"><button onClick={() => setSubTab('spatial')} className={`px-3 py-1.5 rounded-md font-bold flex items-center gap-1.5 transition-all cursor-pointer ${subTab === 'spatial' ? 'bg-cyan-400 text-slate-950' : 'text-slate-400 hover:text-cyan-300'}`}><Activity className="w-3.5 h-3.5" />{t.spatialZonesTab}</button><button onClick={() => setSubTab('attributes')} className={`px-3 py-1.5 rounded-md font-bold flex items-center gap-1.5 transition-all cursor-pointer ${subTab === 'attributes' ? 'bg-cyan-400 text-slate-950' : 'text-slate-400 hover:text-cyan-300'}`}><PieChart className="w-3.5 h-3.5" />{t.visualAttributesTab}</button></div></div>

      {subTab === 'spatial' && <div className="space-y-6"><div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="cyber-card p-5 space-y-4"><h3 className="text-base font-bold font-mono text-slate-100 flex items-center gap-2"><Activity className="w-4 h-4 text-cyan-400" />{t.heatmapTitle}</h3><div className="bg-[#071120] border border-sky-500/30 rounded-lg min-h-56 p-3 flex items-center justify-center"><div className="w-full max-w-md"><div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${heatmapValues[0]?.length || 1}, minmax(0, 1fr))` }}>{heatmapValues.length > 0 ? heatmapValues.flatMap((row, rowIndex) => row.map((value, columnIndex) => { const intensity = heatmapMax > 0 ? Math.min(1, (Number(value) || 0) / heatmapMax) : 0; return <div key={`${rowIndex}-${columnIndex}`} title={`${Number(value || 0).toFixed(2)}`} className="aspect-square rounded-sm" style={{ backgroundColor: intensity > 0 ? `rgba(34, 211, 238, ${0.12 + intensity * 0.82})` : 'rgba(30, 41, 59, 0.35)' }} />; })) : <div className="col-span-full py-16 text-center text-xs text-slate-400 font-mono">No heatmap samples yet.</div>}</div><div className="mt-3 text-center text-xs text-cyan-300 font-mono">{heatmapMax > 0 ? `Peak ${Number(heatmap.peak_value || heatmapMax).toFixed(2)} · ${heatmap.grid_size?.join('×') || 'grid'}` : 'Waiting for confirmed tracks'}</div></div></div></div>
        <div className="cyber-card p-5 space-y-4"><h3 className="text-base font-bold font-mono text-slate-100 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-cyan-400" />{t.zoneDistribution}</h3><div className="space-y-3 pt-2">{zoneRows.length > 0 ? zoneRows.map((zone, index) => <div key={zone.name} onMouseEnter={() => setHoveredZone(zone.name)} onMouseLeave={() => setHoveredZone(null)} className={`space-y-1.5 p-2 rounded-lg transition-all cursor-pointer ${hoveredZone === zone.name ? 'bg-sky-500/20 border border-cyan-400/50' : ''}`}><div className="flex justify-between text-xs font-mono font-medium"><span className="text-slate-200">{zone.name}</span><span className="text-cyan-400 font-bold">{zone.percentage}% ({zone.peopleCount} người)</span></div><div className="w-full h-3 bg-[#071120] rounded-full overflow-hidden border border-sky-500/30"><div className={`h-full ${zoneColors[index % zoneColors.length]} rounded-full transition-all duration-300`} style={{ width: `${Math.min(100, Math.max(0, zone.percentage))}%` }} /></div></div>) : <div className="py-12 text-center text-xs text-slate-400 font-mono">No configured zones or confirmed tracks.</div>}</div></div>
      </div><div className="cyber-card p-5 space-y-4"><h3 className="text-base font-bold font-mono text-slate-100">{t.zoneMetricsTitle}</h3><div className="overflow-x-auto"><table className="w-full text-left text-xs font-mono"><thead className="bg-[#071120] text-sky-400 uppercase tracking-wider border-b border-sky-500/30"><tr><th className="px-4 py-3 font-bold">{t.zoneHeader}</th><th className="px-4 py-3 font-bold">{t.peopleHeader}</th><th className="px-4 py-3 font-bold">{t.densityHeader}</th><th className="px-4 py-3 font-bold">{t.dwellHeader}</th></tr></thead><tbody className="divide-y divide-sky-500/20 text-slate-200">{zoneRows.map((zone) => <tr key={zone.name} className="hover:bg-sky-500/10 transition-colors"><td className="px-4 py-3 font-bold text-cyan-400">{zone.name}</td><td className="px-4 py-3 font-bold">{zone.peopleCount}</td><td className="px-4 py-3">{density == null ? '—' : `${zone.density} /m²`}</td><td className="px-4 py-3 text-slate-300">{zone.avgDwellTime}</td></tr>)}</tbody></table>{zoneRows.length === 0 && <div className="text-center py-4 text-xs text-slate-400">No zone data available.</div>}</div></div></div>}

      {subTab === 'attributes' && <div className="cyber-card p-6 space-y-6 max-w-2xl"><div><h3 className="text-lg font-bold font-mono text-slate-100">{t.visualTitle}</h3><p className="text-xs text-sky-300/80 font-mono mt-1">{t.visualSub}</p></div><div className="space-y-4 font-mono"><div className="flex justify-between items-center bg-[#071120] p-3 rounded-lg border border-sky-500/30"><span className="text-sm text-slate-300">{t.femaleLabel}</span><span className="text-xl font-bold text-cyan-400">{analytics.visual_presentation.female_presenting}</span></div><div className="flex justify-between items-center bg-[#071120] p-3 rounded-lg border border-sky-500/30"><span className="text-sm text-slate-300">{t.maleLabel}</span><span className="text-xl font-bold text-cyan-400">{analytics.visual_presentation.male_presenting}</span></div><div className="flex justify-between items-center bg-[#071120] p-3 rounded-lg border border-amber-500/40"><span className="text-sm text-amber-400 flex items-center gap-1.5 font-bold"><HelpCircle className="w-4 h-4" />{t.unknownLabel}</span><span className="text-xl font-bold text-amber-400">{analytics.visual_presentation.unknown}</span></div><div className="flex justify-between items-center pt-2 text-xs text-sky-300"><span>{t.coveragePct}</span><span className="text-emerald-400 font-bold text-sm">{analytics.visual_presentation.coverage_pct}%</span></div></div></div>}
    </div>
  );
};
