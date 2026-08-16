import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';

export interface OverviewRadarPoint {
  subject: string;
  value: number;
}

interface OverviewRadarChartProps {
  data: OverviewRadarPoint[];
}

export default function OverviewRadarChart({ data }: OverviewRadarChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <RadarChart cx="50%" cy="50%" outerRadius="75%" data={data}>
        <PolarGrid stroke="rgba(56, 189, 248, 0.3)" />
        <PolarAngleAxis dataKey="subject" stroke="#38bdf8" fontSize={11} tickLine={false} />
        <PolarRadiusAxis angle={30} domain={[0, 100]} stroke="#64748b" fontSize={10} />
        <Radar name="Crowd Analytics" dataKey="value" stroke="#f59e0b" strokeWidth={2} fill="#00f0ff" fillOpacity={0.35} />
      </RadarChart>
    </ResponsiveContainer>
  );
}
