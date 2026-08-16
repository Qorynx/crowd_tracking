import type { AnalyticsData, ZoneData } from '../types/analytics';

type UnknownRecord = Record<string, any>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? (value as UnknownRecord) : {};
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function firstFinite(...values: unknown[]): number | undefined {
  return values.map(asFiniteNumber).find((value): value is number => value !== undefined);
}

function formatDwellTime(seconds: number | undefined): string {
  if (seconds === undefined || seconds <= 0) return '0m 00s';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  if (minutes >= 60) {
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${remainingSeconds}s`;
  }
  return `${minutes}m ${remainingSeconds.toString().padStart(2, '0')}s`;
}

function zoneNameMatches(name: string, target: string): boolean {
  return name.trim().toLowerCase() === target;
}

/** Map the backend analytics payload to the dashboard's stable view model. */
export function mapAnalyticsPayload(rawStats: UnknownRecord, previous: AnalyticsData): AnalyticsData {
  const crowd = asRecord(rawStats.crowd);
  const crossing = asRecord(rawStats.crossing);
  const history = asRecord(rawStats.history);
  const historyFlow = asRecord(history.flow);
  const flowWindows = Array.isArray(historyFlow.windows) ? historyFlow.windows.map(asRecord) : [];
  const preferredFlowWindow = flowWindows.find((window) => Number(window.window_seconds) === 60)
    ?? flowWindows[0]
    ?? {};
  const trajectory = asRecord(rawStats.trajectory);
  const attributes = asRecord(rawStats.attributes);
  const visual = asRecord(attributes.visual_presentation);
  const labels = asRecord(visual.labels);
  const spatial = asRecord(rawStats.spatial ?? rawStats.space);
  const distribution = asRecord(spatial.distribution);
  const zoneCounts = asRecord(distribution.primary_zone_counts);
  const classroom = asRecord(rawStats.classroom);
  const room = asRecord(classroom.room);
  const seats = asRecord(classroom.seats);
  const layout = asRecord(classroom.layout);
  const layoutCapacity = asRecord(layout.capacity);

  const totalCrowd = firstFinite(crowd.current_count) ?? previous.total_crowd;
  // Seat capacity is not the same as formal room capacity. Keep occupancy
  // uncalibrated when the backend has not configured a room maximum.
  const maximumCapacity = firstFinite(room.maximum_capacity);
  const occupancyRate = firstFinite(room.occupancy_rate)
    ?? (maximumCapacity !== undefined && maximumCapacity > 0 ? totalCrowd / maximumCapacity : null);
  const density = firstFinite(
    room.physical_density_calibrated ? room.people_per_m2 : undefined,
    spatial.density?.people_per_m2,
  );

  const seatTotal = firstFinite(seats.enabled_seats, layoutCapacity.enabled_seats);
  const seatOccupied = firstFinite(seats.occupied_seats);
  const hasClassroomSnapshot = Object.keys(classroom).length > 0;
  const hasSpatialSnapshot = Object.keys(spatial).length > 0;
  const flowIn = firstFinite(crossing.in) ?? previous.flow_in;
  const flowOut = firstFinite(crossing.out) ?? previous.flow_out;
  const flowInPerMinute = firstFinite(preferredFlowWindow.in_per_minute) ?? previous.flow_in_per_minute;
  const flowOutPerMinute = firstFinite(preferredFlowWindow.out_per_minute) ?? previous.flow_out_per_minute;
  const netFlowPerMinute = firstFinite(preferredFlowWindow.net_per_minute) ?? (flowInPerMinute - flowOutPerMinute);
  const visualLabels = {
    female: firstFinite(labels.female),
    male: firstFinite(labels.male),
    unknown: firstFinite(labels.unknown),
  };
  const hasVisualLabels = Object.values(visualLabels).some((value) => value !== undefined);
  const knownCoverage = firstFinite(visual.coverage);

  const rawZones = asRecord(spatial.zones);
  const zones: ZoneData[] = Object.entries(rawZones).map(([name, value]) => {
    const zone = asRecord(value);
    const dwellSeconds = firstFinite(
      zone.mean_session_dwell_seconds,
      zone.mean_active_dwell_seconds,
      zone.total_dwell_seconds,
    );
    return {
      name,
      peopleCount: firstFinite(zone.current_count) ?? 0,
      density: firstFinite(zone.density_people_per_m2) ?? 0,
      avgDwellTime: formatDwellTime(dwellSeconds),
      percentage: totalCrowd > 0 ? Math.round(((firstFinite(zone.current_count) ?? 0) / totalCrowd) * 100) : 0,
    };
  });

  const percentageFor = (target: string, previousValue: number): number => {
    const entry = Object.entries(zoneCounts).find(([name]) => zoneNameMatches(name, target));
    const count = entry ? asFiniteNumber(entry[1]) : undefined;
    return count === undefined || totalCrowd <= 0 ? previousValue : Math.round((count / totalCrowd) * 100);
  };

  return {
    ...previous,
    total_crowd: totalCrowd,
    occupancy_rate: occupancyRate,
    density_per_m2: density ?? null,
    seats_occupied: seatOccupied ?? (hasClassroomSnapshot ? null : previous.seats_occupied),
    total_seats: seatTotal ?? previous.total_seats,
    moving_count: firstFinite(trajectory.moving_count) ?? previous.moving_count,
    stationary_count: firstFinite(trajectory.stationary_count) ?? previous.stationary_count,
    flow_in: flowIn,
    flow_out: flowOut,
    net_flow: flowIn - flowOut,
    flow_in_per_minute: flowInPerMinute,
    flow_out_per_minute: flowOutPerMinute,
    net_flow_per_minute: netFlowPerMinute,
    visual_presentation: hasVisualLabels
      ? {
          female_presenting: visualLabels.female ?? 0,
          male_presenting: visualLabels.male ?? 0,
          unknown: visualLabels.unknown ?? 0,
          coverage_pct: knownCoverage === undefined ? previous.visual_presentation.coverage_pct : Math.round(knownCoverage * 100),
        }
      : previous.visual_presentation,
    space_distribution: {
      front_pct: percentageFor('front', previous.space_distribution.front_pct),
      middle_pct: percentageFor('middle', previous.space_distribution.middle_pct),
      back_pct: percentageFor('back', previous.space_distribution.back_pct),
    },
    zones: zones.length > 0 ? zones : hasSpatialSnapshot ? [] : previous.zones,
    spatial: Object.keys(spatial).length > 0 ? spatial : previous.spatial,
    classroom: Object.keys(classroom).length > 0 ? classroom : previous.classroom,
    crowd: Object.keys(crowd).length > 0 ? crowd : previous.crowd,
    trajectory: Object.keys(trajectory).length > 0 ? trajectory : previous.trajectory,
    crossing: Object.keys(crossing).length > 0 ? crossing : previous.crossing,
    history: Object.keys(history).length > 0 ? history : previous.history,
    room_area_m2: firstFinite(room.visible_floor_area_m2) ?? previous.room_area_m2 ?? null,
    room_capacity: maximumCapacity ?? previous.room_capacity ?? null,
    occupancy_calibrated: maximumCapacity !== undefined && maximumCapacity > 0,
    seat_occupancy_calibrated: seatOccupied !== undefined,
  };
}
