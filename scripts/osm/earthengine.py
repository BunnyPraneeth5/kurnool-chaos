"""Task K.5: download satellite layers for the map from Google Earth Engine.

Dev tool only (not shipped with the game). Setup, once:
    uv tool install --python 3.12 earthengine-api --with numpy
    earthengine authenticate          (Bunny signs in himself)
Run (all layers, or name some: heights water terrain trees):
    $env:EE_PROJECT = "<your Earth Engine project id>"
    & "$env:APPDATA/uv/tools/earthengine-api/Scripts/python" scripts/osm/earthengine.py [layer ...]

Writes committed snapshots read by build.mjs, so the build never needs Earth Engine:
    scripts/osm/ee-heights.bin.gz   building height, 4 m grid, uint8 in half metres (0..100 m)
    scripts/osm/ee-water.bin.gz     water probability, 5 m grid, uint8 0..100
    scripts/osm/ee-terrain.bin.gz   ground height, 10 m grid, uint16 decimetres above 200 m (box + airport)
    scripts/osm/ee-trees.bin.gz     tree probability, 10 m grid, uint8 0..100
    scripts/osm/earthengine.json    grid shapes, sources and licences

Sources (credited in the game):
- Google Open Buildings 2.5D Temporal (GOOGLE/Research/open-buildings-temporal/v1), 2023 heights. CC BY 4.0.
- Dynamic World (GOOGLE/DYNAMICWORLD/V1): water probability, 90th percentile over June 2023 to
  June 2024 (seasonal canals and rivers at full width), and tree probability, median. CC BY 4.0.
- Copernicus DEM GLO-30 (COPERNICUS/DEM/GLO30). Roofs and trees are taken off with a 45 m
  morphological opening (erode then dilate) and a light 30 m smoothing: hills and slopes stay,
  single buildings do not. Produced using Copernicus WorldDEM-30, (c) DLR e.V. 2010-2014 and
  (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the EU and ESA.
"""

import gzip
import io
import json
import math
import os
import sys
import time
import urllib.request
from pathlib import Path

import ee
import numpy as np

# Same box and metres-per-degree as scripts/osm/common.mjs.
BBOX = {"south": 15.748, "west": 77.975, "north": 15.870, "east": 78.065}
# Terrain also covers the airport, which the game places about 1.5 to 3 km east of the box.
TERRAIN_BBOX = {"south": 15.738, "west": 77.965, "north": 15.880, "east": 78.105}
TERRAIN_BASE = 200  # metres; terrain is stored as decimetres above this
LAT0 = (BBOX["south"] + BBOX["north"]) / 2
PHI = math.radians(LAT0)
M_LAT = 111132.92 - 559.82 * math.cos(2 * PHI) + 1.175 * math.cos(4 * PHI)
M_LON = 111412.84 * math.cos(PHI) - 93.5 * math.cos(3 * PHI)

DIR = Path(__file__).parent
TILE = 1000  # pixels per tile side; Earth Engine caps the size of one download

LICENCES = {
    "heights": "CC BY 4.0, Google Open Buildings 2.5D Temporal",
    "water": "CC BY 4.0, Dynamic World",
    "trees": "CC BY 4.0, Dynamic World",
    "terrain": "Copernicus DEM GLO-30, (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the EU and ESA",
}


def grid(metres: float, box: dict = BBOX) -> dict:
    d_lon = metres / M_LON
    d_lat = metres / M_LAT
    width = math.ceil((box["east"] - box["west"]) / d_lon)
    height = math.ceil((box["north"] - box["south"]) / d_lat)
    return {
        "west": box["west"],
        "north": box["north"],
        "dLon": d_lon,
        "dLat": d_lat,
        "width": width,
        "height": height,
    }


def download(image: ee.Image, g: dict, label: str, dtype=np.uint8) -> np.ndarray:
    """Fetches a single-band image on the lat/lon grid g, tile by tile, as a (height, width) array."""
    out = np.zeros((g["height"], g["width"]), dtype=dtype)
    for j0 in range(0, g["height"], TILE):
        for i0 in range(0, g["width"], TILE):
            w = min(TILE, g["width"] - i0)
            h = min(TILE, g["height"] - j0)
            west = g["west"] + i0 * g["dLon"]
            north = g["north"] - j0 * g["dLat"]
            url = image.getDownloadURL(
                {
                    "format": "NPY",
                    "crs": "EPSG:4326",
                    "crs_transform": [g["dLon"], 0, west, 0, -g["dLat"], north],
                    "dimensions": f"{w}x{h}",
                }
            )
            for attempt in range(4):
                try:
                    with urllib.request.urlopen(url, timeout=300) as r:
                        arr = np.load(io.BytesIO(r.read()), allow_pickle=False)
                    break
                except OSError as err:
                    if attempt == 3:
                        raise
                    print(f"  {label}: download failed ({err}), retrying")
                    time.sleep(10 * (attempt + 1))
            band = arr[arr.dtype.names[0]] if arr.dtype.names else arr
            out[j0 : j0 + h, i0 : i0 + w] = band.astype(dtype)
            print(f"  {label}: tile at {i0},{j0} ({w}x{h}) done")
    return out


def main() -> None:
    project = os.environ.get("EE_PROJECT")
    if not project:
        sys.exit(
            "Set EE_PROJECT to your Earth Engine project id first (see the header of this script)."
        )
    ee.Initialize(project=project)
    region = ee.Geometry.Rectangle(
        [BBOX["west"], BBOX["south"], BBOX["east"], BBOX["north"]]
    )
    wanted = set(sys.argv[1:]) or {"heights", "water", "terrain", "trees"}
    meta_path = DIR / "earthengine.json"
    meta = (
        json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    )

    def save(name: str, arr: np.ndarray, g: dict, unit: str, source: str) -> None:
        file = f"ee-{name}.bin.gz"
        (DIR / file).write_bytes(gzip.compress(arr.tobytes(), compresslevel=9, mtime=0))
        meta[name] = {
            **g,
            "file": file,
            "unit": unit,
            "dtype": str(arr.dtype),
            "source": source,
            "licence": LICENCES[name],
        }
        # Saved after every layer, so a later failure keeps what already arrived.
        meta["licence"] = "; ".join(
            sorted(
                {
                    v["licence"]
                    for v in meta.values()
                    if isinstance(v, dict) and "licence" in v
                }
            )
        )
        meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")

    if "heights" in wanted:
        img = (
            ee.ImageCollection("GOOGLE/Research/open-buildings-temporal/v1")
            .filterBounds(region)
            .filterDate("2023-01-01", "2024-01-01")
            .select("building_height")
            .mosaic()
            .unmask(0)
            .multiply(2)
            .round()
            .clamp(0, 200)
            .toUint8()
        )
        g = grid(4)
        print(f"Heights grid {g['width']}x{g['height']} (4 m)")
        heights = download(img, g, "heights")
        save(
            "heights",
            heights,
            g,
            "half metres",
            "GOOGLE/Research/open-buildings-temporal/v1, 2023, building_height",
        )
        built = heights > 0
        print(
            f"Heights: {built.mean() * 100:.1f}% of pixels under buildings, median {np.median(heights[built]) / 2:.1f} m"
        )

    dw = (
        ee.ImageCollection("GOOGLE/DYNAMICWORLD/V1")
        .filterBounds(region)
        .filterDate("2023-06-01", "2024-06-01")
    )

    if "water" in wanted:
        img = (
            dw.select("water")
            .reduce(ee.Reducer.percentile([90]))
            .unmask(0)
            .multiply(100)
            .round()
            .clamp(0, 100)
            .toUint8()
        )
        g = grid(5)
        print(f"Water grid {g['width']}x{g['height']} (5 m)")
        water = download(img, g, "water")
        save(
            "water",
            water,
            g,
            "percent",
            "GOOGLE/DYNAMICWORLD/V1, water probability, 90th percentile 2023-06 to 2024-06",
        )
        print(f"Water: {(water >= 50).mean() * 100:.1f}% of pixels 50%+ water")

    if "trees" in wanted:
        img = (
            dw.select("trees")
            .median()
            .unmask(0)
            .multiply(100)
            .round()
            .clamp(0, 100)
            .toUint8()
        )
        g = grid(10)
        print(f"Trees grid {g['width']}x{g['height']} (10 m)")
        trees = download(img, g, "trees")
        save(
            "trees",
            trees,
            g,
            "percent",
            "GOOGLE/DYNAMICWORLD/V1, tree probability, median 2023-06 to 2024-06",
        )
        print(f"Trees: {(trees >= 50).mean() * 100:.1f}% of pixels 50%+ trees")

    if "terrain" in wanted:
        tregion = ee.Geometry.Rectangle(
            [
                TERRAIN_BBOX["west"],
                TERRAIN_BBOX["south"],
                TERRAIN_BBOX["east"],
                TERRAIN_BBOX["north"],
            ]
        )
        dem = (
            ee.ImageCollection("COPERNICUS/DEM/GLO30")
            .filterBounds(tregion)
            .select("DEM")
            .map(lambda i: i.resample("bilinear"))
            .mosaic()
        )
        # Take roofs and trees off: erode then dilate by 45 m, then smooth 30 m.
        ground = (
            dem.focalMin(45, "circle", "meters")
            .focalMax(45, "circle", "meters")
            .focalMean(30, "circle", "meters")
        )
        img = (
            ground.subtract(TERRAIN_BASE)
            .multiply(10)
            .round()
            .clamp(0, 65535)
            .toUint16()
        )
        g = grid(10, TERRAIN_BBOX)
        print(f"Terrain grid {g['width']}x{g['height']} (10 m)")
        terrain = download(img, g, "terrain", np.uint16)
        save(
            "terrain",
            terrain,
            {**g, "base": TERRAIN_BASE},
            "decimetres above base",
            "COPERNICUS/DEM/GLO30, 45 m opening + 30 m smoothing",
        )
        t = terrain / 10 + TERRAIN_BASE
        print(
            f"Terrain: {t.min():.1f} to {t.max():.1f} m above sea level, median {np.median(t):.1f} m"
        )

    meta["licence"] = "; ".join(
        sorted(
            {
                v["licence"]
                for v in meta.values()
                if isinstance(v, dict) and "licence" in v
            }
        )
    )
    meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
