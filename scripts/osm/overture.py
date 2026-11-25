"""Task K.1: download Overture Maps buildings for the map box into a committed snapshot.

Uses the `overturemaps` Python tool (approved dev tool, not shipped with the game):
    uv tool install overturemaps
    "%APPDATA%/uv/tools/overturemaps/Scripts/python" scripts/osm/overture.py

Writes scripts/osm/overture-buildings.json.gz, read by build.mjs. The release is pinned
so a re-download gives the same data. Calls the library directly (not the CLI) with the
STAC catalog off, because the CLI checks the release against stac.overturemaps.org,
which often answers 429 Too Many Requests.

Licence: the Overture buildings theme is ODbL. Credit: "© OpenStreetMap contributors,
Overture Maps Foundation" (https://docs.overturemaps.org/attribution/).
"""

import gzip
import json
import sys
from pathlib import Path

from overturemaps import core
from shapely import wkb

RELEASE = "2026-11-18.0"
# Same box as scripts/osm/common.mjs BBOX (west, south, east, north).
BBOX = (77.975, 15.770, 78.065, 15.870)
OUT = Path(__file__).with_name("overture-buildings.json.gz")


def main() -> None:
    reader = core.record_batch_reader(
        "building", bbox=BBOX, release=RELEASE, stac=False
    )
    if reader is None:
        sys.exit("Overture download failed (no reader)")
    feats = []
    seen = 0
    for batch in reader:
        cols = batch.to_pydict()
        for i in range(batch.num_rows):
            seen += 1
            geom = wkb.loads(cols["geometry"][i])
            if geom.geom_type == "MultiPolygon":
                geom = max(geom.geoms, key=lambda g: g.area)
            if geom.geom_type != "Polygon":
                continue
            ring = [[round(x, 6), round(y, 6)] for x, y in geom.exterior.coords]
            srcs = cols.get("sources", [None] * batch.num_rows)[i] or []
            datasets = sorted({s.get("dataset") or "?" for s in srcs})
            f = {"id": cols["id"][i], "src": datasets, "ring": ring}
            for key, short in (
                ("height", "h"),
                ("num_floors", "floors"),
                ("class", "class"),
                ("subtype", "subtype"),
            ):
                v = cols.get(key, [None] * batch.num_rows)[i]
                if v is not None:
                    f[short] = round(v, 1) if isinstance(v, float) else v
            feats.append(f)
    feats.sort(key=lambda f: f["id"])
    data = {"release": RELEASE, "bbox": BBOX, "licence": "ODbL", "buildings": feats}
    raw = json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    # mtime=0 so the .gz is byte-identical for the same data.
    OUT.write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))
    by_src = {}
    for f in feats:
        k = "+".join(f["src"])
        by_src[k] = by_src.get(k, 0) + 1
    print(
        f"Overture {RELEASE}: {seen} rows, {len(feats)} polygons kept -> {OUT.name} ({OUT.stat().st_size / 1e6:.2f} MB)"
    )
    for k, v in sorted(by_src.items(), key=lambda kv: -kv[1]):
        print(f"  {k}: {v}")
    print(
        f"  with height: {sum('h' in f for f in feats)}, with floors: {sum('floors' in f for f in feats)}"
    )


if __name__ == "__main__":
    main()
