// Outlines of the cells above a threshold in a grid (marching squares), for water shapes from
// the satellite water map (task K.5). Returns closed rings in grid coordinates (x right,
// y down, cell (i, j) covers i..i+1, j..j+1), each with a flag saying whether it is an outer
// edge or a hole, decided by its winding.

/**
 * @param {Uint8Array} data  width * height values, row by row
 * @param {number} width
 * @param {number} height
 * @param {number} threshold  values >= threshold are inside
 * @returns {{ ring: [number, number][], outer: boolean }[]}
 */
export function contours(data, width, height, threshold) {
  // Pixel-edge tracing on the cell boundaries: walk the edges between inside and outside
  // cells, keeping the inside on the left. Corners are cell corners (integer coordinates).
  const inside = (i, j) => i >= 0 && j >= 0 && i < width && j < height && data[j * width + i] >= threshold;
  // Directed boundary edges keyed by their start corner: from -> list of to.
  const W = width + 1;
  const next = new Map();
  const add = (x0, y0, x1, y1) => {
    const k = y0 * W + x0;
    let l = next.get(k);
    if (!l) next.set(k, (l = []));
    l.push(y1 * W + x1);
  };
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      if (!inside(i, j)) continue;
      // Edges go counter-clockwise around each inside cell in (x right, y down) screen terms,
      // which is clockwise on a y-up map; only edges facing an outside cell are boundary.
      if (!inside(i, j - 1)) add(i + 1, j, i, j); // top edge, right to left
      if (!inside(i - 1, j)) add(i, j, i, j + 1); // left edge, downwards
      if (!inside(i, j + 1)) add(i, j + 1, i + 1, j + 1); // bottom edge, left to right
      if (!inside(i + 1, j)) add(i + 1, j + 1, i + 1, j); // right edge, upwards
    }
  }
  const rings = [];
  const keys = [...next.keys()].sort((a, b) => a - b);
  for (const start of keys) {
    while (next.get(start)?.length) {
      const ring = [];
      let cur = start;
      let prevDir = null;
      for (let guard = 0; guard < 4 * width * height + 10; guard++) {
        const outs = next.get(cur);
        if (!outs || !outs.length) break;
        // At a corner touched by two inside cells diagonally, prefer turning so rings stay simple.
        let pick = 0;
        if (outs.length > 1 && prevDir) {
          const cx = cur % W, cy = Math.floor(cur / W);
          let best = -Infinity;
          outs.forEach((o, n) => {
            const dx = (o % W) - cx, dy = Math.floor(o / W) - cy;
            // Turn towards the inside, so cells touching only at a corner become separate rings.
            const turn = prevDir[1] * dx - prevDir[0] * dy;
            if (turn > best) {
              best = turn;
              pick = n;
            }
          });
        }
        const to = outs.splice(pick, 1)[0];
        const x0 = cur % W, y0 = Math.floor(cur / W);
        const x1 = to % W, y1 = Math.floor(to / W);
        const dir = [x1 - x0, y1 - y0];
        // Keep only corners where the direction changes.
        if (!prevDir || prevDir[0] !== dir[0] || prevDir[1] !== dir[1]) ring.push([x0, y0]);
        prevDir = dir;
        cur = to;
        if (cur === start) break;
      }
      if (ring.length >= 4) {
        let a = 0;
        for (let k = 0; k < ring.length; k++) {
          const p = ring[k], q = ring[(k + 1) % ring.length];
          a += p[0] * q[1] - q[0] * p[1];
        }
        // Screen coordinates (y down): outer rings come out with negative area here.
        rings.push({ ring, outer: a < 0 });
      }
    }
  }
  return rings;
}
