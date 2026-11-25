"""Task K.5: download satellite building heights and a water map for the map box from Google Earth Engine.

Dev tool only (not shipped with the game). Setup, once:
    uv tool install --python 3.12 earthengine-api --with numpy
    earthengine authenticate          (Bunny signs in himself)
Run:
    $env:EE_PROJECT = "<your Earth Engine project id>"
    & "$env:APPDATA/uv/tools/earthengine-api/Scripts/python" scripts/osm/earthengine.py

Writes committed snapshots read by build.mjs, so the build never needs Earth Engine:
    scripts/osm/ee-heights.bin.gz   building height, 4 m grid, uint8 in half metres (0..100 m)
    scripts/osm/ee-water.bin.gz     water probability, 5 m grid, uint8 0..100
    scripts/osm/earthengine.json    grid shapes and sources

Sources (both CC BY 4.0, credited in the game):
- Google Open Buildings 2.5D Temporal (GOOGLE/Research/open-buildings-temporal/v1), 2023 heights.
- Dynamic World (GOOGLE/DYNAMICWORLD/V1), 90th percentile of the water probability over
  June 2023 to June 2024, so seasonal canals and rivers show at their full width.
"""

import gzip
import io
import json
import math
import os
import sys
import urllib.request
from pathlib import Path

import ee
import numpy as np

# Same box and metres-per-degree as scripts/osm/common.mjs.
BBOX = {"south": 15.770, "west": 77.975, "north": 15.870, "east": 78.065}
LAT0 = (BBOX["south"] + BBOX["north"]) / 2
PHI = math.radians(LAT0)
M_LAT = 111132.92 - 559.82 * math.cos(2 * PHI) + 1.175 * math.cos(4 * PHI)
M_LON = 111412.84 * math.cos(PHI) - 93.5 * math.cos(3 * PHI)

DIR = Path(__file__).parent
TILE = 1000  # pixels per tile side; Earth Engine caps the size of one download


def grid(metres: float) -> dict:
    d_lon = metres / M_LON
    d_lat = metres / M_LAT
    width = math.ceil((BBOX["east"] - BBOX["west"]) / d_lon)
    height = math.ceil((BBOX["north"] - BBOX["south"]) / d_lat)
    return {
        "west": BBOX["west"],
        "north": BBOX["north"],
        "dLon": d_lon,
        "dLat": d_lat,
        "width": width,
        "height": height,
    }


def download(image: ee.Image, g: dict, label: str) -> np.ndarray:
    """Fetches a uint8 single-band image on the lat/lon grid g, tile by tile, as a (height, width) array."""
    out = np.zeros((g["height"], g["width"]), dtype=np.uint8)
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
            with urllib.request.urlopen(url, timeout=300) as r:
                arr = np.load(io.BytesIO(r.read()), allow_pickle=False)
            band = arr[arr.dtype.names[0]] if arr.dtype.names else arr
            out[j0 : j0 + h, i0 : i0 + w] = band.astype(np.uint8)
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

    # Building heights, 2023, in half metres.
    heights_img = (
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
    hg = grid(4)
    print(f"Heights grid {hg['width']}x{hg['height']} (4 m)")
    heights = download(heights_img, hg, "heights")

    # Water probability, 90th percentile over a year, in percent.
    water_img = (
        ee.ImageCollection("GOOGLE/DYNAMICWORLD/V1")
        .filterBounds(region)
        .filterDate("2023-06-01", "2024-06-01")
        .select("water")
        .reduce(ee.Reducer.percentile([90]))
        .unmask(0)
        .multiply(100)
        .round()
        .clamp(0, 100)
        .toUint8()
    )
    wg = grid(5)
    print(f"Water grid {wg['width']}x{wg['height']} (5 m)")
    water = download(water_img, wg, "water")

    (DIR / "ee-heights.bin.gz").write_bytes(
        gzip.compress(heights.tobytes(), compresslevel=9, mtime=0)
    )
    (DIR / "ee-water.bin.gz").write_bytes(
        gzip.compress(water.tobytes(), compresslevel=9, mtime=0)
    )
    meta = {
        "heights": {
            **hg,
            "file": "ee-heights.bin.gz",
            "unit": "half metres",
            "source": "GOOGLE/Research/open-buildings-temporal/v1, 2023, building_height",
        },
        "water": {
            **wg,
            "file": "ee-water.bin.gz",
            "unit": "percent",
            "source": "GOOGLE/DYNAMICWORLD/V1, water probability, 90th percentile 2023-06 to 2024-06",
        },
        "licence": "CC BY 4.0 (Google Open Buildings 2.5D Temporal; Dynamic World)",
    }
    (DIR / "earthengine.json").write_text(
        json.dumps(meta, indent=2) + "\n", encoding="utf-8"
    )
    built = heights > 0
    print(
        f"Heights: {built.mean() * 100:.1f}% of pixels under buildings, median {np.median(heights[built]) / 2 if built.any() else 0:.1f} m, 95th percentile {np.percentile(heights[built], 95) / 2 if built.any() else 0:.1f} m"
    )
    print(f"Water: {(water >= 50).mean() * 100:.1f}% of pixels 50%+ water")


if __name__ == "__main__":
    main()
