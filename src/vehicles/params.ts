// Per-type handling (ARCHITECTURE: Vehicles). One physics model, different numbers.

export type VehicleType = 'car' | 'auto' | 'bike' | 'bus' | 'lorry';

export const VEHICLE_TYPES: readonly VehicleType[] = ['car', 'auto', 'bike', 'bus', 'lorry'];

export interface VehicleParams {
  name: string;
  /** top speed, m/s */
  top: number;
  /** acceleration, m/s^2 at standstill */
  acc: number;
  /** how fast travel direction follows the nose (higher = more grip) */
  grip: number;
  /** steering rate, rad/s at full lock */
  turn: number;
  /** collision circles: this radius at each of these offsets along the body (front positive) */
  radius: number;
  circles: readonly number[];
  /** body size */
  len: number;
  w: number;
  /** body roll at full lock: negative rolls out of the turn, positive leans into it (radians) */
  roll: number;
  /** how fast the roll follows the steering (lower = floppier) */
  rollRate: number;
  /** weight compared with a car: decides who gets shoved in a crash */
  mass: number;
  /** chase camera */
  camDist: number;
  camHeight: number;
  /** roof height, for the police light bar and name tags */
  roof: number;
}

// The car is the demo sedan, retuned for narrow streets: two 1.0 m circles instead of one
// 1.6 m circle, so it fits lanes about 2.5 m wide and does not catch on walls with its corners.
export const VEHICLES: Record<VehicleType, VehicleParams> = {
  car: { name: 'Car', top: 34, acc: 15, grip: 7, turn: 2.3, radius: 1.0, circles: [1.2, -1.2], len: 4.3, w: 1.9, roll: -0.07, rollRate: 8, mass: 1, camDist: 9.5, camHeight: 4.4, roof: 1.68 },
  // Slow, slides about and rolls a lot.
  auto: { name: 'Auto', top: 18, acc: 9, grip: 3.5, turn: 2.8, radius: 0.75, circles: [0.65, -0.65], len: 2.8, w: 1.45, roll: -0.18, rollRate: 4.5, mass: 0.6, camDist: 8, camHeight: 3.9, roof: 1.92 },
  // Quick off the line, leans into turns and fits through gaps.
  bike: { name: 'Bike', top: 30, acc: 20, grip: 5, turn: 2.9, radius: 0.45, circles: [0.55, -0.55], len: 2.0, w: 0.7, roll: 0.5, rollRate: 7, mass: 0.3, camDist: 7, camHeight: 3.2, roof: 1.75 },
  // Long and slow to turn.
  bus: { name: 'Bus', top: 20, acc: 6, grip: 8, turn: 1.25, radius: 1.25, circles: [3.55, 1.2, -1.2, -3.55], len: 9.6, w: 2.6, roll: -0.035, rollRate: 3, mass: 4, camDist: 17, camHeight: 7.2, roof: 3.15 },
  // Heavy: shoves lighter vehicles aside.
  lorry: { name: 'Lorry', top: 22, acc: 7, grip: 6, turn: 1.45, radius: 1.25, circles: [2.6, 0, -2.6], len: 7.6, w: 2.5, roll: -0.045, rollRate: 3, mass: 4.5, camDist: 15, camHeight: 6.6, roof: 3.0 },
};

export const CAR_COLOURS = [0xe4573d, 0xf2b33d, 0x3d8fd6, 0xeae3d6, 0x34304a, 0x49b08c, 0xb25fc4, 0xf08a5d];

const LIVERY: Record<Exclude<VehicleType, 'car'>, readonly number[]> = {
  auto: [0xf2c230, 0xf2c230, 0x2f9e5b],
  bike: [0xd13b32, 0x232833, 0x2c66c4],
  bus: [0xc7392f, 0x2f7d5a, 0xd8d3c4],
  lorry: [0xe0762c, 0x2d5fa8, 0xb8452f],
};

/** Body colour for a vehicle: the same type and number look the same on every screen. */
export function vehicleColour(type: VehicleType, index: number): number {
  const list = type === 'car' ? CAR_COLOURS : LIVERY[type];
  return list[((index % list.length) + list.length) % list.length];
}
