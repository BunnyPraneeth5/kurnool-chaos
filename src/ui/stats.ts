import type { VehicleType } from '../vehicles/params';

// This session's numbers for the Stats page (TASKS H.2). Not saved.

export const stats = {
  startedAt: performance.now(),
  /** metres per vehicle type, and on foot */
  distance: { foot: 0, car: 0, auto: 0, bike: 0, bus: 0, lorry: 0 } as Record<VehicleType | 'foot', number>,
  topSpeed: 0, // m/s
  borrowed: 0,
  stars: 0,
  copsEscaped: 0,
  busted: 0,
  crashes: 0,
  rides: 0,
};
