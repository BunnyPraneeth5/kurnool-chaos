import type { RoundState } from '../modes/types';

// Who may hit whom (task M.11). Free roam: everyone. In a round the mode decides: Chaos yes,
// Chor–Police only police against chors (and chors fighting back), Landmark hunt and Hill
// climb no. Someone in a round and someone not cannot hit each other. Pure; tested.

export function mayHit(s: RoundState, me: string, other: string): boolean {
  const playing = s.phase === 'countdown' || s.phase === 'playing';
  const meIn = playing && s.players.includes(me);
  const themIn = playing && s.players.includes(other);
  if (!meIn && !themIn) return true;
  if (meIn !== themIn || s.phase !== 'playing') return false;
  if (s.mode === 'chaos') return true;
  if (s.mode === 'chor') {
    const a = s.roles[me], b = s.roles[other];
    return (a === 'police' && b === 'chor') || (a === 'chor' && b === 'police');
  }
  return false;
}
