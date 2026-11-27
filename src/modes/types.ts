import type { MapData } from '../map/types';
import type { RoadIndex } from '../map/roadIndex';

// Game rounds (TASKS Phase G): shapes shared by the round flow and the modes.

export type ModeId = 'hunt' | 'chor' | 'chaos' | 'climb';
export type Phase = 'lobby' | 'countdown' | 'playing' | 'results';
export const ROUND_MINUTES = [3, 5, 10] as const;

/**
 * Round state, owned by the host and broadcast whole (event `g`, kind `state`).
 * Times are durations left at send time, never clock readings: phone clocks differ.
 */
export interface RoundState {
  /** Counts rounds started in this room; a new round always wins. */
  round: number;
  /** Bumped on every change within a round. */
  rev: number;
  phase: Phase;
  mode: ModeId;
  mins: number;
  /** Ready ticks in the lobby. */
  ready: string[];
  /** Who plays the current (or last) round. */
  players: string[];
  scores: Record<string, number>;
  /** Mode roles, e.g. police / chor. */
  roles: Record<string, string>;
  /** Mode data, e.g. hunt targets. */
  data: Record<string, unknown>;
  /** Milliseconds left in this phase when sent (countdown, playing, results). */
  leftMs: number;
  /** Milliseconds since Go when sent (playing). */
  elapsedMs: number;
}

export interface Spot {
  x: number;
  z: number;
  heading: number;
}

export interface Target {
  x: number;
  z: number;
  label: string;
}

/** What modes can ask about the room and the world. */
export interface ModeCtx {
  map: MapData;
  roads: RoadIndex;
  myId: string;
  /** Where a player is right now on this screen (us: exact, friends: as drawn). */
  posOf(id: string): { x: number; z: number } | null;
  present(id: string): boolean;
  slotOf(id: string): number;
  nickOf(id: string): string;
  /** Riding in someone's vehicle: the driver's id (task H.4). */
  rideOf?(id: string): string | null;
  /** My chaos points this round (task H.10). */
  chaos?(): number;
}

export interface Claim {
  kind: string;
  [k: string]: unknown;
}

export interface ModeHud {
  /** Big role line, e.g. "You are POLICE". */
  role?: string;
  /** What to do now. */
  goal: string;
  /** Arrow and distance on screen, beacon in the world (hunt). */
  target?: Target;
  beacon?: boolean;
  /** A second marker in the world, e.g. a challenge's bonus gate. */
  marker?: { x: number; z: number };
}

export interface GameMode {
  id: ModeId;
  name: string;
  blurb: string;
  /** false: shown greyed out with the blurb saying why, cannot be picked */
  available?: boolean;
  /** Host: roles, data and starting scores for a new round. */
  setup(players: string[], mins: number, ctx: ModeCtx): Pick<RoundState, 'roles' | 'data' | 'scores'>;
  /** Everyone: where this player starts (always in their slot's car). */
  startSpot(id: string, s: RoundState, ctx: ModeCtx): Spot;
  /** Everyone: extra time this player is held after Go (police head start). */
  holdMs(id: string, s: RoundState): number;
  /** Everyone, each frame while playing: watch for things to claim (a catch, a landmark reached). */
  tick(s: RoundState, ctx: ModeCtx, claim: (c: Claim) => void): void;
  /** Host: check and apply a claim. True if the state changed; 'quiet' = changed, but send it with the next regular update. */
  claim(s: RoundState, from: string, c: Claim, ctx: ModeCtx): boolean | 'quiet';
  /** Host: round over before the timer? */
  done(s: RoundState, ctx: ModeCtx): boolean;
  /** Host: final points when the round ends. */
  finish(s: RoundState, ctx: ModeCtx): void;
  /** Everyone: what this player sees on the HUD. */
  hud(s: RoundState, me: string, ctx: ModeCtx, nowElapsedMs: number): ModeHud;
  /** Everyone: police look for this player's car and name tag. */
  isPolice(s: RoundState, id: string): boolean;
}
