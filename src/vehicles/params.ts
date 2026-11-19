// Per-type handling (ARCHITECTURE: Vehicles). One physics model, different numbers.
// Only the car exists so far; auto, bike, bus and lorry arrive in task 5.1.

export type VehicleType = 'car';

export interface VehicleParams {
  /** top speed, m/s */
  top: number;
  /** acceleration, m/s^2 at standstill */
  acc: number;
  /** how fast travel direction follows the nose (higher = more grip) */
  grip: number;
  /** steering rate, rad/s at full lock */
  turn: number;
  /** collision circles: two of this radius at +-axle along the body */
  radius: number;
  axle: number;
  /** body size for the model */
  len: number;
  w: number;
  bodyH: number;
  cabH: number;
  cabLen: number;
  cabZ: number;
}

export const VEHICLES: Record<VehicleType, VehicleParams> = {
  // Demo sedan, retuned for narrow streets: two 1.0 m circles instead of one 1.6 m circle,
  // so it fits lanes about 2.5 m wide and does not catch on walls with its corners.
  car: { top: 34, acc: 15, grip: 7, turn: 2.3, radius: 1.0, axle: 1.2, len: 4.3, w: 1.9, bodyH: 0.65, cabH: 0.6, cabLen: 2.2, cabZ: -0.2 },
};

export const CAR_COLOURS = [0xe4573d, 0xf2b33d, 0x3d8fd6, 0xeae3d6, 0x34304a, 0x49b08c, 0xb25fc4, 0xf08a5d];
