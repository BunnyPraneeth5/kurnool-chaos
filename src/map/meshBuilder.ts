import * as THREE from 'three';

/**
 * Collects lit triangles with per-vertex normal, UV and colour into one geometry.
 * tri() flips the winding when needed so each triangle faces along its first vertex's normal.
 */
export class SolidMeshBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];

  get empty(): boolean {
    return this.idx.length === 0;
  }

  /** Number of vertices so far (a marker for lift()). */
  get count(): number {
    return this.pos.length / 3;
  }

  /** Raises every vertex added since `from` by dy (stand a model on the ground). */
  lift(from: number, dy: number): void {
    for (let i = from * 3 + 1; i < this.pos.length; i += 3) this.pos[i] += dy;
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, c: THREE.Color): number {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(c.r, c.g, c.b);
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    const p = this.pos;
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const ux = p[b * 3] - ax, uy = p[b * 3 + 1] - ay, uz = p[b * 3 + 2] - az;
    const vx = p[c * 3] - ax, vy = p[c * 3 + 1] - ay, vz = p[c * 3 + 2] - az;
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const n = this.nor;
    if (cx * n[a * 3] + cy * n[a * 3 + 1] + cz * n[a * 3 + 2] >= 0) this.idx.push(a, b, c);
    else this.idx.push(a, c, b);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** Collects flat, upward-facing triangles with vertex colours into one geometry. */
export class FlatMeshBuilder {
  private pos: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];

  get empty(): boolean {
    return this.idx.length === 0;
  }

  vertex(x: number, y: number, z: number, c: THREE.Color): number {
    this.pos.push(x, y, z);
    this.col.push(c.r, c.g, c.b);
    return this.pos.length / 3 - 1;
  }

  /** Adds a triangle, flipping the winding if needed so it faces up (+Y). */
  tri(a: number, b: number, c: number): void {
    const p = this.pos;
    const ux = p[b * 3] - p[a * 3];
    const uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3];
    const vz = p[c * 3 + 2] - p[a * 3 + 2];
    if (uz * vx - ux * vz >= 0) this.idx.push(a, b, c);
    else this.idx.push(a, c, b);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const normals = new Float32Array(this.pos.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * Adds a flat-shaded polygon (with holes) laid over the ground: triangulated, then each triangle
 * is split along its longest edge only where the ground bends away from it by more than `tol`
 * metres (down to minEdge), so flat water and parks stay a few big triangles. Every point sits
 * at heightAt(x, z). `pick` chooses the builder for each piece (by its middle), so big shapes can
 * be split into culled chunks.
 */
export function drapePolygon(
  pick: (x: number, z: number) => FlatMeshBuilder,
  outer: [number, number][],
  holes: [number, number][][],
  heightAt: (x: number, z: number) => number,
  c: THREE.Color,
  minEdge: number,
  tol = 0.15,
): void {
  const contour = outer.map(([x, z]) => new THREE.Vector2(x, z));
  const hs = holes.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z)));
  const all = [outer, ...holes].flat();
  type P = { x: number; z: number; y: number };
  const at = (x: number, z: number): P => ({ x, z, y: heightAt(x, z) });
  const emit = (a: P, b: P, d: P): void => {
    const mb = pick((a.x + b.x + d.x) / 3, (a.z + b.z + d.z) / 3);
    mb.tri(mb.vertex(a.x, a.y, a.z, c), mb.vertex(b.x, b.y, b.z, c), mb.vertex(d.x, d.y, d.z, c));
  };
  const split = (a: P, b: P, d: P, depth: number): void => {
    const lab = Math.hypot(b.x - a.x, b.z - a.z), lbd = Math.hypot(d.x - b.x, d.z - b.z), lda = Math.hypot(a.x - d.x, a.z - d.z);
    // Rotate so a-b is the longest edge.
    if (lbd > lab && lbd >= lda) return split(b, d, a, depth);
    if (lda > lab && lda > lbd) return split(d, a, b, depth);
    if (lab <= minEdge || depth > 18) return emit(a, b, d);
    const m = at((a.x + b.x) / 2, (a.z + b.z) / 2);
    const cx = (a.x + b.x + d.x) / 3, cz = (a.z + b.z + d.z) / 3;
    const err = Math.max(Math.abs(m.y - (a.y + b.y) / 2), Math.abs(heightAt(cx, cz) - (a.y + b.y + d.y) / 3));
    if (err <= tol && lab <= minEdge * 8) return emit(a, b, d);
    split(a, m, d, depth + 1);
    split(m, b, d, depth + 1);
  };
  for (const [ia, ib, ic] of THREE.ShapeUtils.triangulateShape(contour, hs)) {
    split(at(all[ia][0], all[ia][1]), at(all[ib][0], all[ib][1]), at(all[ic][0], all[ic][1]), 0);
  }
}
