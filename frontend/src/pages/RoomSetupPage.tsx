import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Armchair, Save, Crosshair, Plus, Minus, RotateCcw, AlertCircle } from 'lucide-react';
import { CrowdApiError, getApiErrorMessage, getSessionStats, updateSessionCalibration, updateSessionLayout } from '../api/crowdApi';

interface RoomSetupPageProps {
  t: any;
  sessionId?: string | null;
}

interface RoomSeat {
  id: string;
  row: number;
  block: string;
  column: number;
  status: string;
}

interface ClassroomSnapshot {
  status?: string;
  room?: Record<string, any>;
  layout?: Record<string, any>;
  seats?: Record<string, any>;
}

const DEFAULT_CLASSROOM: ClassroomSnapshot = {};

function seatId(row: number, block: string, column: number): string {
  return `r${row}-${block}-c${column}`;
}

function disabledKey(value: { row: number; block: string; column: number }): string {
  return `${value.row}:${value.block}:${value.column}`;
}

function buildSeats(layout: Record<string, any>, disabled: Set<string>, liveSeats: any[] = []): RoomSeat[] {
  if (liveSeats.length > 0) {
    return liveSeats.map((seat) => ({
      id: String(seat.seat_id),
      row: Number(seat.row),
      block: String(seat.block),
      column: Number(seat.column),
      status: String(seat.status || (seat.enabled === false ? 'disabled' : 'vacant')),
    }));
  }
  const rows = Number(layout.rows) || 0;
  const blockColumns = layout.block_columns && typeof layout.block_columns === 'object' ? layout.block_columns : {};
  const blocks = Array.isArray(layout.blocks) ? layout.blocks.map(String) : Object.keys(blockColumns);
  const seats: RoomSeat[] = [];
  for (let row = 1; row <= rows; row += 1) {
    blocks.forEach((block) => {
      const columns = Number(blockColumns[block]) || 0;
      for (let column = 1; column <= columns; column += 1) {
        const key = disabledKey({ row, block, column });
        seats.push({ id: seatId(row, block, column), row, block, column, status: disabled.has(key) ? 'disabled' : 'vacant' });
      }
    });
  }
  return seats;
}

export const RoomSetupPage: React.FC<RoomSetupPageProps> = ({ t, sessionId }) => {
  const [tab, setTab] = useState<'layout' | 'calibration'>('layout');
  const [classroom, setClassroom] = useState<ClassroomSnapshot>(DEFAULT_CLASSROOM);
  const [rows, setRows] = useState(0);
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [calibrationPoints, setCalibrationPoints] = useState<Array<[number, number]>>([]);
  const [floorWidthM, setFloorWidthM] = useState(8);
  const [floorDepthM, setFloorDepthM] = useState(8);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const applySnapshot = useCallback((snapshot: ClassroomSnapshot) => {
    setClassroom(snapshot);
    const layout = snapshot.layout || {};
    setRows(Number(layout.rows) || 0);
    const disabledValues = Array.isArray(layout.disabled_seats) ? layout.disabled_seats : [];
    setDisabled(new Set(disabledValues.map((value: any) => disabledKey({
      row: Number(value.row), block: String(value.block), column: Number(value.column),
    }))));
    const calibration = snapshot.room?.calibration;
    if (calibration && Array.isArray(calibration.floor_points_px)) {
      setCalibrationPoints(calibration.floor_points_px as Array<[number, number]>);
      const world = Array.isArray(calibration.floor_points_m) ? calibration.floor_points_m : [];
      const width = Math.max(...world.map((point: [number, number]) => Number(point[0]) || 0), 0);
      const depth = Math.max(...world.map((point: [number, number]) => Number(point[1]) || 0), 0);
      if (width > 0) setFloorWidthM(width);
      if (depth > 0) setFloorDepthM(depth);
    }
  }, []);

  const loadSnapshot = useCallback(async () => {
    if (!sessionId) {
      setClassroom(DEFAULT_CLASSROOM);
      setRows(0);
      setDisabled(new Set());
      setCalibrationPoints([]);
      return;
    }
    setLoading(true);
    setErrorMessage(null);
    try {
      const response = await getSessionStats(sessionId);
      applySnapshot((response.analytics?.classroom || {}) as ClassroomSnapshot);
    } catch (error) {
      if (!(error instanceof CrowdApiError && error.status === 404)) {
        setErrorMessage(getApiErrorMessage(error, 'Unable to load classroom configuration.'));
      }
    } finally {
      setLoading(false);
    }
  }, [applySnapshot, sessionId]);

  useEffect(() => { void loadSnapshot(); }, [loadSnapshot]);

  const layout = useMemo(() => classroom.layout || {}, [classroom.layout]);
  const room = useMemo(() => classroom.room || {}, [classroom.room]);
  const seats = useMemo(
    () => buildSeats(layout, disabled, Array.isArray(classroom.seats?.seats) ? classroom.seats.seats : []),
    [classroom.seats, disabled, layout],
  );
  const blocks = Array.isArray(layout.blocks) ? layout.blocks.map(String) : Object.keys(layout.block_columns || {});
  const enabledSeatCount = seats.filter((seat) => seat.status !== 'disabled').length;
  const totalSeatCount = seats.length || Number(layout.capacity?.total_seats) || 0;
  const referenceResolution = useMemo(
    () => Array.isArray(layout.reference_resolution) ? layout.reference_resolution : [640, 480],
    [layout.reference_resolution],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#071120';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.22)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= canvas.width; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
    for (let y = 0; y <= canvas.height; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
    if (calibrationPoints.length >= 2) {
      ctx.beginPath();
      calibrationPoints.forEach(([x, y], index) => {
        const px = (x / Number(referenceResolution[0])) * canvas.width;
        const py = (y / Number(referenceResolution[1])) * canvas.height;
        if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      if (calibrationPoints.length === 4) ctx.closePath();
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    calibrationPoints.forEach(([x, y], index) => {
      const px = (x / Number(referenceResolution[0])) * canvas.width;
      const py = (y / Number(referenceResolution[1])) * canvas.height;
      ctx.fillStyle = '#facc15';
      ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#020617';
      ctx.font = 'bold 12px ui-monospace';
      ctx.fillText(String(index + 1), px - 4, py + 4);
    });
  }, [calibrationPoints, referenceResolution]);

  const toggleSeat = (seat: RoomSeat) => {
    if (['occupied', 'pending', 'uncertain'].includes(seat.status)) return;
    const key = disabledKey(seat);
    setDisabled((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const adjustRows = (nextRows: number) => {
    const normalized = Math.max(1, Math.min(24, nextRows));
    setRows(normalized);
    setDisabled((previous) => new Set(Array.from(previous).filter((value) => Number(value.split(':')[0]) <= normalized)));
  };

  const saveLayout = async () => {
    if (!sessionId || !layout.template) return;
    setSaving(true); setMessage(null); setErrorMessage(null);
    try {
      const disabledSeats = Array.from(disabled).map((value) => {
        const [row, block, column] = value.split(':');
        return { row: Number(row), block, column: Number(column) };
      });
      const response = await updateSessionLayout(sessionId, {
        room_profile: room.name,
        template: String(layout.template),
        rows: Math.max(1, rows),
        disabled_seats: disabledSeats,
      });
      applySnapshot(response.classroom as ClassroomSnapshot);
      setMessage('Layout updated for the active session.');
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, 'Unable to save the room layout.'));
    } finally { setSaving(false); }
  };

  const saveCalibration = async () => {
    if (!sessionId || calibrationPoints.length !== 4) return;
    setSaving(true); setMessage(null); setErrorMessage(null);
    try {
      const width = Math.max(0.1, floorWidthM);
      const depth = Math.max(0.1, floorDepthM);
      const response = await updateSessionCalibration(sessionId, {
        floor_points_px: calibrationPoints,
        floor_points_m: [[0, 0], [width, 0], [width, depth], [0, depth]],
        maximum_error_cm: 10,
      });
      applySnapshot(response.classroom as ClassroomSnapshot);
      setMessage('Calibration updated for the active session.');
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, 'Unable to save camera calibration.'));
    } finally { setSaving(false); }
  };

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(Number(referenceResolution[0]), ((event.clientX - rect.left) / rect.width) * Number(referenceResolution[0])));
    const y = Math.max(0, Math.min(Number(referenceResolution[1]), ((event.clientY - rect.top) / rect.height) * Number(referenceResolution[1])));
    setCalibrationPoints((previous) => previous.length >= 4 ? [[x, y]] : [...previous, [x, y]]);
    setMessage(null);
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><h2 className="text-xl font-bold font-mono text-slate-100 flex items-center gap-2">{t.roomTitle}</h2><p className="text-xs text-sky-300/80 font-mono">{t.roomSub}</p></div>
        <div className="flex space-x-2 bg-[#071120] border border-sky-500/40 p-1 rounded-lg text-xs font-mono">
          <button onClick={() => setTab('layout')} className={`px-3 py-1.5 rounded-md font-bold flex items-center gap-1.5 transition-all cursor-pointer ${tab === 'layout' ? 'bg-cyan-400 text-slate-950' : 'text-slate-400 hover:text-cyan-300'}`}><Armchair className="w-3.5 h-3.5" />{t.layoutTab}</button>
          <button onClick={() => setTab('calibration')} className={`px-3 py-1.5 rounded-md font-bold flex items-center gap-1.5 transition-all cursor-pointer ${tab === 'calibration' ? 'bg-cyan-400 text-slate-950' : 'text-slate-400 hover:text-cyan-300'}`}><Crosshair className="w-3.5 h-3.5" />{t.calibTab}</button>
        </div>
      </div>

      {!sessionId && <div className="cyber-card p-4 text-sm text-amber-300 font-mono flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Start the classroom camera from Live Monitor before editing this session.</div>}
      {loading && <div className="text-xs text-sky-300 font-mono">Loading classroom configuration…</div>}
      {errorMessage && <div className="cyber-card p-4 text-sm text-rose-300 font-mono">{errorMessage}</div>}
      {message && <div className="cyber-card p-4 text-sm text-emerald-300 font-mono">{message}</div>}

      {tab === 'layout' && <div className="space-y-6">
        <div className="cyber-card p-5 rounded-xl flex flex-wrap items-center justify-between gap-4"><div className="flex items-center space-x-8 font-mono"><div><label className="text-xs text-sky-300 block mb-1">{t.roomArea}</label><div className="text-sm font-bold text-cyan-300">{typeof room.visible_floor_area_m2 === 'number' ? `${room.visible_floor_area_m2.toFixed(1)} m²` : '--'}</div></div><div><label className="text-xs text-sky-300 block mb-1">{t.seatingPattern}</label><div className="text-sm font-bold text-slate-100">{layout.template || '--'}</div></div><div><label className="text-xs text-sky-300 block mb-1">{t.rowsCount}</label><div className="flex items-center space-x-2"><button disabled={!sessionId || rows <= 1} onClick={() => adjustRows(rows - 1)} className="cyber-btn p-1 rounded cursor-pointer disabled:opacity-40"><Minus className="w-3.5 h-3.5" /></button><span className="font-bold text-slate-100 w-6 text-center">{rows || '--'}</span><button disabled={!sessionId || rows >= 24} onClick={() => adjustRows(rows + 1)} className="cyber-btn p-1 rounded cursor-pointer disabled:opacity-40"><Plus className="w-3.5 h-3.5" /></button></div></div></div><div className="text-right font-mono"><div className="text-xs text-sky-300">{t.configuredSeats}</div><div className="text-xl font-bold text-cyan-400">{totalSeatCount ? `${enabledSeatCount} / ${totalSeatCount}` : '--'}</div></div></div>
        <div className="cyber-card p-6 rounded-xl space-y-6"><div className="w-full py-2 bg-cyan-400/10 border border-cyan-400/40 rounded-lg text-center text-xs font-mono font-bold text-cyan-300 uppercase tracking-widest">{t.frontLectern}</div><div className="space-y-4 max-w-5xl mx-auto py-4 font-mono">{Array.from({ length: rows }).map((_, index) => { const row = index + 1; return <div key={row} className="flex items-center justify-center gap-4 overflow-x-auto"><span className="text-xs text-sky-300 w-12 font-bold shrink-0">Dãy {row}</span>{blocks.map((block) => <div key={block} className="flex gap-2 border-l border-dashed border-sky-500/40 pl-3 first:border-l-0" title={block}>{seats.filter((seat) => seat.row === row && seat.block === block).map((seat) => <button key={seat.id} aria-label={`${seat.id} ${seat.status}`} onClick={() => toggleSeat(seat)} disabled={!sessionId || ['occupied', 'pending', 'uncertain'].includes(seat.status)} className={`w-8 h-8 rounded-full border flex items-center justify-center text-xs transition-transform hover:scale-125 cursor-pointer disabled:cursor-not-allowed ${seat.status === 'occupied' ? 'bg-cyan-400 text-slate-950 border-cyan-300' : seat.status === 'disabled' ? 'bg-rose-500/15 border-rose-500/30 text-rose-400 opacity-60' : seat.status === 'pending' || seat.status === 'uncertain' ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' : 'bg-[#071120] border-sky-500/40 text-sky-300 hover:border-cyan-400'}`}>{seat.status === 'occupied' ? '●' : seat.status === 'disabled' ? '✕' : seat.status === 'pending' || seat.status === 'uncertain' ? '?' : '○'}</button>)}</div>)}</div>; })}{rows === 0 && <div className="text-center text-sm text-slate-400">No active classroom layout is available.</div>}</div><div className="w-full py-2 bg-[#071120] border border-sky-500/30 rounded-lg text-center text-xs font-mono text-sky-400 uppercase tracking-widest">{t.rearDoor}</div><div className="flex justify-end"><button disabled={!sessionId || saving || !layout.template} onClick={() => void saveLayout()} className="cyber-btn bg-cyan-400 text-slate-950 px-4 py-2 rounded-lg font-bold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-40"><Save className="w-4 h-4" />{saving ? 'Saving…' : 'Save layout'}</button></div></div>
      </div>}

      {tab === 'calibration' && <div className="cyber-card p-6 space-y-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-base font-bold font-mono text-slate-100">{t.homographyTitle}</h3><p className="text-xs text-sky-300/80 font-mono">Click four floor corners in reference-frame order: top-left, top-right, bottom-right, bottom-left.</p></div><div className="flex gap-2"><button onClick={() => setCalibrationPoints([])} className="cyber-btn px-3 py-2 rounded-lg text-xs flex items-center gap-1.5"><RotateCcw className="w-3.5 h-3.5" />Clear</button><button disabled={!sessionId || saving || calibrationPoints.length !== 4} onClick={() => void saveCalibration()} className="cyber-btn bg-cyan-400 text-slate-950 px-4 py-2 rounded-lg font-bold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-40"><Save className="w-4 h-4" />{saving ? 'Saving…' : t.saveCalibBtn}</button></div></div><div className="relative bg-[#071120] border border-sky-500/40 rounded-xl overflow-hidden aspect-video"><canvas ref={canvasRef} width={800} height={450} onClick={handleCanvasClick} className="w-full h-full object-contain cursor-crosshair" /></div><div className="flex flex-wrap items-end gap-4 text-xs font-mono"><label className="text-sky-300">Floor width (m)<input type="number" min="0.1" step="0.1" value={floorWidthM} onChange={(event) => setFloorWidthM(Number(event.target.value))} className="mt-1 block w-28 bg-[#071120] border border-sky-500/40 text-cyan-300 font-bold text-center px-2 py-1 rounded" /></label><label className="text-sky-300">Floor depth (m)<input type="number" min="0.1" step="0.1" value={floorDepthM} onChange={(event) => setFloorDepthM(Number(event.target.value))} className="mt-1 block w-28 bg-[#071120] border border-sky-500/40 text-cyan-300 font-bold text-center px-2 py-1 rounded" /></label><span className="text-sky-300">{calibrationPoints.length}/4 points · reference {referenceResolution[0]}×{referenceResolution[1]}</span></div></div>}
    </div>
  );
};
