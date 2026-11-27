import { describe, expect, it } from 'vitest';
// @ts-ignore: the tests run in Node, but the project has no Node types
import { readdirSync, statSync } from 'node:fs';
import { CLIP_NAMES, CUES, ENGINES, HORNS, clipInfo, fetchClip } from '../src/audio/clips';

const DIR = 'public/sounds';

describe('sound files', () => {
  it('has exactly the files the game loads', () => {
    expect((readdirSync(DIR) as string[]).sort()).toEqual(CLIP_NAMES.map((n) => `${n}.mp3`).sort());
  });

  it('stays under 500 KB in total for phones', () => {
    const total = CLIP_NAMES.reduce((sum, n) => sum + (statSync(`${DIR}/${n}.mp3`).size as number), 0);
    expect(total).toBeLessThan(500_000);
  });

  it('names a source for every recording', () => {
    for (const n of CLIP_NAMES) {
      const { source } = clipInfo(n);
      expect(source.title && source.author).toBeTruthy();
      expect(source.id).toBeGreaterThan(0);
    }
  });

  it('gives engines, the siren and horns a part that repeats', () => {
    const looped = [...Object.values(ENGINES), ...Object.values(HORNS)].map((v) => v.clip);
    for (const n of [...looped, 'siren' as const]) {
      const [from, to] = clipInfo(n).loop!;
      expect(to).toBeGreaterThan(from);
    }
    // One-shots must not repeat.
    for (const n of [...Object.values(CUES).map((c) => c.clip), 'crash' as const]) expect(clipInfo(n).loop).toBeUndefined();
  });
});

describe('loading a sound', () => {
  const answer = (res: Response) => (() => Promise.resolve(res)) as typeof fetch;

  it('returns the bytes', async () => {
    const res = new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } });
    expect((await fetchClip('/sounds/a.mp3', answer(res))).byteLength).toBe(3);
  });

  it('names the file and the reason when it fails', async () => {
    await expect(fetchClip('/sounds/a.mp3', answer(new Response('', { status: 404 })))).rejects.toThrow('/sounds/a.mp3 did not download (HTTP 404).');
    const page = new Response('<html>', { headers: { 'content-type': 'text/html' } });
    await expect(fetchClip('/sounds/a.mp3', answer(page))).rejects.toThrow('/sounds/a.mp3 is missing.');
    const offline = (() => Promise.reject(new TypeError('offline'))) as typeof fetch;
    await expect(fetchClip('/sounds/a.mp3', offline)).rejects.toThrow('network problem');
  });
});
