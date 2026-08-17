import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Armchair,
  Crosshair,
  Save,
  RotateCcw,
  AlertCircle,
  CheckCircle2,
  Minus,
  Plus,
  ChevronRight,
} from 'lucide-react';
import {
  CrowdApiError,
  getApiErrorMessage,
  getSessionStats,
  updateSessionCalibration,
  updateSessionLayout,
} from '@/api/crowdApi';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
const DEFAULT_TEMPLATE = 'lecture_2_4_2';
const TEMPLATE_OPTIONS = [{ value: DEFAULT_TEMPLATE, label: '2-4-2' }];

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
      status: disabled.has(disabledKey({
        row: Number(seat.row),
        block: String(seat.block),
        column: Number(seat.column),
      }))
        ? 'disabled'
        : ['occupied', 'pending', 'uncertain'].includes(String(seat.status))
          ? String(seat.status)
          : 'vacant',
    }));
  }
  const rows = Number(layout.rows) || 4;
  const blockColumns = layout.block_columns && typeof layout.block_columns === 'object'
    ? layout.block_columns
    : { left: 2, center: 4, right: 2 };
  const blocks = Array.isArray(layout.blocks) ? layout.blocks.map(String) : Object.keys(blockColumns);
  const seats: RoomSeat[] = [];
  for (let row = 1; row <= rows; row += 1) {
    blocks.forEach((block) => {
      const columns = Number(blockColumns[block]) || 0;
      for (let column = 1; column <= columns; column += 1) {
        const key = disabledKey({ row, block, column });
        seats.push({
          id: seatId(row, block, column),
          row,
          block,
          column,
          status: disabled.has(key) ? 'disabled' : 'vacant',
        });
      }
    });
  }
  return seats;
}

export const RoomSetupPage: React.FC<RoomSetupPageProps> = ({ t, sessionId }) => {
  const [tab, setTab] = useState<'layout' | 'calibration'>('layout');
  const [classroom, setClassroom] = useState<ClassroomSnapshot>(DEFAULT_CLASSROOM);
  const [rows, setRows] = useState(4);
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [calibrationPoints, setCalibrationPoints] = useState<Array<[number, number]>>([]);
  const [floorWidthM, setFloorWidthM] = useState(8);
  const [floorDepthM, setFloorDepthM] = useState(8);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const applySnapshot = useCallback((snapshot: ClassroomSnapshot) => {
    setClassroom(snapshot);
    const layoutObj = snapshot.layout || {};
    if (layoutObj.rows) setRows(Number(layoutObj.rows) || 4);
    if (layoutObj.template) setTemplate(String(layoutObj.template));
    const disabledValues = Array.isArray(layoutObj.disabled_seats) ? layoutObj.disabled_seats : [];
    setDisabled(
      new Set(
        disabledValues.map((value: any) =>
          disabledKey({
            row: Number(value.row),
            block: String(value.block),
            column: Number(value.column),
          })
        )
      )
    );
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

  const resetDraft = useCallback(() => {
    setClassroom(DEFAULT_CLASSROOM);
    setRows(4);
    setTemplate(DEFAULT_TEMPLATE);
    setDisabled(new Set());
    setCalibrationPoints([]);
    setFloorWidthM(8);
    setFloorDepthM(8);
    setMessage(null);
    setErrorMessage(null);
  }, []);

  const loadSnapshot = useCallback(async (signal?: AbortSignal) => {
    if (!sessionId) {
      resetDraft();
      return;
    }
    resetDraft();
    setErrorMessage(null);
    try {
      const response = await getSessionStats(sessionId, signal);
      const classroomSnapshot = response.analytics?.classroom;
      if (classroomSnapshot && typeof classroomSnapshot === 'object') {
        applySnapshot(classroomSnapshot as ClassroomSnapshot);
      }
    } catch (error) {
      if (signal?.aborted) return;
      if (!(error instanceof CrowdApiError && error.status === 404)) {
        setErrorMessage(getApiErrorMessage(error, 'Unable to load room configuration.'));
      }
    }
  }, [applySnapshot, resetDraft, sessionId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadSnapshot(controller.signal);
    return () => controller.abort();
  }, [loadSnapshot]);

  const layout = useMemo(() => classroom.layout || {}, [classroom.layout]);
  const room = useMemo(() => classroom.room || {}, [classroom.room]);
  const seats = useMemo(
    () => buildSeats(layout, disabled, Array.isArray(classroom.seats?.seats) ? classroom.seats.seats : []),
    [classroom.seats, disabled, layout]
  );
  const blocks = Array.isArray(layout.blocks)
    ? layout.blocks.map(String)
    : Object.keys(layout.block_columns || { left: 2, center: 4, right: 2 });
  const totalSeatCount = seats.length || Number(layout.capacity?.total_seats) || rows * 8;
  const referenceResolution = useMemo(
    () => (Array.isArray(layout.reference_resolution) ? layout.reference_resolution : [640, 480]),
    [layout.reference_resolution]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#071421';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.15)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= canvas.width; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += 60) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
    if (calibrationPoints.length >= 2) {
      ctx.beginPath();
      calibrationPoints.forEach(([x, y], index) => {
        const px = (x / Number(referenceResolution[0])) * canvas.width;
        const py = (y / Number(referenceResolution[1])) * canvas.height;
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      if (calibrationPoints.length === 4) ctx.closePath();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    calibrationPoints.forEach(([x, y], index) => {
      const px = (x / Number(referenceResolution[0])) * canvas.width;
      const py = (y / Number(referenceResolution[1])) * canvas.height;
      ctx.fillStyle = '#ffc176';
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#071421';
      ctx.font = 'bold 10px JetBrains Mono, monospace';
      ctx.fillText(String(index + 1), px - 3.5, py + 3.5);
    });
  }, [calibrationPoints, referenceResolution]);

  const toggleSeat = (seat: RoomSeat) => {
    if (!sessionId || saving || ['occupied', 'pending', 'uncertain'].includes(seat.status)) return;
    const key = disabledKey(seat);
    setDisabled((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const adjustRows = (nextRows: number) => {
    if (!sessionId || saving) return;
    const normalized = Math.max(1, Math.min(24, nextRows));
    setRows(normalized);
    setDisabled(
      (previous) =>
        new Set(Array.from(previous).filter((value) => Number(value.split(':')[0]) <= normalized))
    );
  };

  const saveLayout = async () => {
    if (!sessionId) return;
    setSaving(true);
    setMessage(null);
    setErrorMessage(null);
    try {
      const disabledSeats = Array.from(disabled).map((value) => {
        const [row, block, column] = value.split(':');
        return { row: Number(row), block, column: Number(column) };
      });
      const response = await updateSessionLayout(sessionId, {
        // The API expects the backend template identifier, not the display label.
        template: template || DEFAULT_TEMPLATE,
        rows: Math.max(1, rows),
        disabled_seats: disabledSeats,
      });
      applySnapshot(response.classroom as ClassroomSnapshot);
      setMessage('Layout updated for the active session.');
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, 'Unable to save the room layout.'));
    } finally {
      setSaving(false);
    }
  };

  const saveCalibration = async () => {
    if (!sessionId || calibrationPoints.length !== 4) return;
    setSaving(true);
    setMessage(null);
    setErrorMessage(null);
    try {
      const width = Math.max(0.1, floorWidthM);
      const depth = Math.max(0.1, floorDepthM);
      const response = await updateSessionCalibration(sessionId, {
        floor_points_px: calibrationPoints,
        floor_points_m: [
          [0, 0],
          [width, 0],
          [width, depth],
          [0, depth],
        ],
        maximum_error_cm: 10,
      });
      applySnapshot(response.classroom as ClassroomSnapshot);
      setMessage('Calibration updated for the active session.');
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, 'Unable to save camera calibration.'));
    } finally {
      setSaving(false);
    }
  };

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(
        Number(referenceResolution[0]),
        ((event.clientX - rect.left) / rect.width) * Number(referenceResolution[0])
      )
    );
    const y = Math.max(
      0,
      Math.min(
        Number(referenceResolution[1]),
        ((event.clientY - rect.top) / rect.height) * Number(referenceResolution[1])
      )
    );
    setCalibrationPoints((previous) => (previous.length >= 4 ? [[x, y]] : [...previous, [x, y]]));
    setMessage(null);
  };

  const columnLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

  return (
    <div className="flex flex-col lg:flex-row h-full min-h-[calc(100vh-64px)] overflow-hidden">
      {/* Left Sidebar: Tools & Configuration Panel (320px width) */}
      <div className="w-full lg:w-80 border-b lg:border-b-0 lg:border-r border-border-default bg-app-bg flex flex-col shrink-0">
        {/* Title Header */}
        <div className="p-6 sm:p-8 border-b border-border-default">
          <div className="flex items-center gap-1.5 text-xs text-text-muted mb-2">
            <span>{t.roomTitle}</span>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-text-primary">{t.classroomA}</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-semibold text-text-primary tracking-tight">
            {t.layoutConfiguration}
          </h2>
        </div>

        {/* Configuration controls */}
        <div className="p-6 sm:p-8 flex-1 overflow-y-auto space-y-8">
          {/* Configuration Form */}
          <div>
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">
              {t.configuration}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">
                  {t.seatLayout}
                </label>
                <Select value={template} onValueChange={(val) => setTemplate(val)}>
                  <SelectTrigger disabled={!sessionId || saving}>
                    <SelectValue placeholder="Select template" />
                  </SelectTrigger>
                  <SelectContent>
                    {TEMPLATE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">
                  {t.rows}
                </label>
                <div className="flex items-center space-x-2">
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={!sessionId || saving || rows <= 1}
                    onClick={() => adjustRows(rows - 1)}
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </Button>
                  <span className="font-mono text-sm font-semibold text-text-primary w-10 text-center">
                    {rows}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={!sessionId || saving || rows >= 24}
                    onClick={() => adjustRows(rows + 1)}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">
                  {t.editMode}
                </label>
                <Button
                  variant={tab === 'layout' ? 'secondary' : 'outline'}
                  onClick={() => setTab('layout')}
                  className={`w-full justify-start gap-2.5 ${tab === 'layout' ? 'border-primary text-primary font-semibold' : ''}`}
                >
                  <Armchair className="w-4 h-4" />
                  <span>{t.enableDisableSeats}</span>
                </Button>
              </div>
            </div>
          </div>

          {/* Calibration */}
          <div>
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
              {t.calibration}
            </h3>
            <Button
              variant={tab === 'calibration' ? 'secondary' : 'outline'}
              onClick={() => setTab('calibration')}
              className={`w-full justify-start gap-2.5 ${tab === 'calibration' ? 'border-primary text-primary font-semibold' : ''}`}
            >
              <Crosshair className="w-4 h-4" />
              <span>{t.cameraReference}</span>
            </Button>
          </div>

          {/* Details */}
          <div>
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
              {t.roomDetails}
            </h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between items-center py-1 border-b border-border-default/50">
                <span className="text-text-muted">{t.visibleArea}</span>
                <span className="font-mono text-text-primary font-semibold">
                  {typeof room.visible_floor_area_m2 === 'number'
                    ? `${room.visible_floor_area_m2.toFixed(1)}m²`
                    : '64m²'}
                </span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-border-default/50">
                <span className="text-text-muted">{t.layout}</span>
                <span className="font-mono text-text-primary font-semibold">{template}</span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="text-text-muted">{t.totalSeats}</span>
                <span className="font-mono text-text-primary font-semibold">{totalSeatCount}</span>
              </div>
            </div>
          </div>

          {/* Feedback messages */}
          {!sessionId && (
            <div className="bg-warning/10 border border-warning/30 text-warning p-3 rounded text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Start monitoring on Live Monitor to apply session changes live.</span>
            </div>
          )}

          {errorMessage && (
            <div className="bg-danger/10 border border-danger/30 text-danger p-3 rounded text-xs">
              {errorMessage}
            </div>
          )}

          {message && (
            <div className="bg-success/10 border border-success/30 text-success p-3 rounded text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{message}</span>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="p-6 sm:p-8 border-t border-border-default bg-surface-primary flex flex-col gap-2.5">
          <Button
            variant="default"
            onClick={() => void (tab === 'calibration' ? saveCalibration() : saveLayout())}
            disabled={saving || !sessionId || (tab === 'calibration' && calibrationPoints.length !== 4)}
            className="w-full gap-2"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Saving…' : tab === 'calibration' ? t.saveCalibBtn : t.saveLayout}</span>
          </Button>
          <Button
            variant="outline"
            onClick={() => void loadSnapshot()}
            disabled={saving}
            className="w-full"
          >
            {t.reset}
          </Button>
        </div>
      </div>

      {/* Right Canvas: Floor Plan or Camera Calibration */}
      <div className="flex-1 bg-app-bg relative flex flex-col overflow-hidden min-h-[500px]">
        {tab === 'layout' && (
          <>
            {/* Top legend inside Canvas */}
            <div className="absolute top-6 right-6 z-10 flex gap-4 items-center">
              <div className="flex items-center gap-4 bg-surface-primary/90 backdrop-blur-sm border border-border-default px-3 py-1.5 rounded text-xs">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 border border-border-default bg-transparent rounded-sm" />
                  <span className="text-[11px] text-text-muted uppercase tracking-wider">
                    {t.available}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 border border-primary bg-primary/20 rounded-sm" />
                  <span className="text-[11px] text-primary uppercase tracking-wider font-medium">
                    {t.selected}
                  </span>
                </div>
              </div>
            </div>

            {/* Interactive Grid Area */}
            <div className="flex-1 relative overflow-auto grid-pattern p-8 sm:p-16 flex flex-col items-center justify-center">
              <div className="flex flex-col items-center gap-12 pt-8 pb-16">
                {/* Desks Grid */}
                <div className="flex gap-8 sm:gap-16 relative">
                  {blocks.map((block, blockIndex) => {
                    const blockSeats = seats.filter((seat) => seat.block === block);
                    const blockCols = Math.max(
                      ...blockSeats.map((s) => s.column),
                      blockIndex === 1 ? 4 : 2
                    );
                    return (
                      <div
                        key={block}
                        className="grid gap-3 sm:gap-5"
                        style={{ gridTemplateColumns: `repeat(${blockCols}, minmax(0, 1fr))` }}
                      >
                        {Array.from({ length: rows }).map((_, rIdx) => {
                          const rowNum = rIdx + 1;
                          return Array.from({ length: blockCols }).map((__, cIdx) => {
                            const colNum = cIdx + 1;
                            const seat = blockSeats.find(
                              (s) => s.row === rowNum && s.column === colNum
                            ) || {
                              id: seatId(rowNum, block, colNum),
                              row: rowNum,
                              block,
                              column: colNum,
                              status: 'vacant',
                            };
                            const isDisabled = seat.status === 'disabled';
                            const isOccupied = seat.status === 'occupied';
                            const letterIdx =
                              blockIndex === 0
                                ? cIdx
                                : blockIndex === 1
                                ? 2 + cIdx
                                : 6 + cIdx;
                            const seatLabel = `${rowNum}${columnLetters[letterIdx] || colNum}`;

                            return (
                              <button
                                key={seat.id}
                                onClick={() => toggleSeat(seat)}
                                disabled={!sessionId || saving || ['occupied', 'pending', 'uncertain'].includes(seat.status)}
                                className={`w-11 h-11 sm:w-13 sm:h-13 rounded border font-mono text-xs flex items-center justify-center transition-all cursor-pointer ${
                                  isOccupied
                                    ? 'bg-primary/20 border-primary text-primary font-semibold'
                                    : isDisabled
                                    ? 'bg-surface-container-high/40 border-border-default/40 text-text-muted/40 line-through'
                                    : 'bg-transparent border-border-default text-text-muted hover:border-text-primary hover:text-text-primary'
                                }`}
                                title={`Seat ${seatLabel} - ${seat.status}`}
                              >
                                <span>{seatLabel}</span>
                              </button>
                            );
                          });
                        })}
                      </div>
                    );
                  })}
                </div>

                {/* Teacher Station */}
                <div className="w-56 h-14 bg-transparent border border-border-default rounded flex items-center justify-center">
                  <span className="font-mono text-xs text-text-muted uppercase tracking-widest">
                    {t.teacherStation}
                  </span>
                </div>

                {/* Projection Screen Indicator */}
                <div className="w-72 h-1 bg-border-strong rounded-full" />
              </div>
            </div>
          </>
        )}

        {tab === 'calibration' && (
          <div className="flex-1 p-6 sm:p-10 flex flex-col space-y-6 overflow-auto">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-text-primary">{t.homographyTitle}</h3>
                <p className="text-xs text-text-muted mt-1">
                  Click four floor corners in reference-frame order: top-left, top-right, bottom-right, bottom-left.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCalibrationPoints([])}
                  disabled={!sessionId || saving}
                  className="gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Clear</span>
                </Button>
              </div>
            </div>

            {/* Calibration Canvas */}
            <div className="relative w-full aspect-video bg-surface-container-lowest border border-border-default rounded-lg overflow-hidden flex items-center justify-center">
              <canvas
                ref={canvasRef}
                width={800}
                height={450}
                onClick={sessionId ? handleCanvasClick : undefined}
                className={`w-full h-full object-contain ${sessionId ? 'cursor-crosshair' : 'cursor-not-allowed opacity-60'}`}
              />
            </div>

            {/* Dimension Inputs */}
            <div className="flex flex-wrap items-center gap-6 text-xs font-mono">
              <label className="text-text-muted flex items-center gap-2">
                <span>Floor width (m):</span>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={floorWidthM}
                  onChange={(e) => setFloorWidthM(Number(e.target.value))}
                  disabled={!sessionId || saving}
                  className="w-20 bg-surface-secondary border border-border-default text-primary font-bold text-center px-2 py-1 rounded outline-none"
                />
              </label>

              <label className="text-text-muted flex items-center gap-2">
                <span>Floor depth (m):</span>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={floorDepthM}
                  onChange={(e) => setFloorDepthM(Number(e.target.value))}
                  disabled={!sessionId || saving}
                  className="w-20 bg-surface-secondary border border-border-default text-primary font-bold text-center px-2 py-1 rounded outline-none"
                />
              </label>

              <span className="text-text-muted">
                {calibrationPoints.length}/4 points · reference {referenceResolution[0]}×{referenceResolution[1]}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
