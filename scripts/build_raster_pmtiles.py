import argparse
import io
import json
import math
from pathlib import Path

import mercantile
import numpy as np
import rasterio
from PIL import Image
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.warp import reproject


MAPBIOMAS_CLASSES = {
    1: ("Formacion boscosa", "#1f8d49"),
    3: ("Bosque", "#1f8d49"),
    4: ("Bosque abierto", "#7dc975"),
    6: ("Bosque inundable", "#026975"),
    10: ("Herbazal y arbustal", "#d6bc74"),
    11: ("Herbazal/arbustal inundable", "#519799"),
    12: ("Herbazal/arbustal", "#d6bc74"),
    13: ("Otra formacion natural no forestal", "#d89f5c"),
    14: ("Agropecuario", "#ffefc3"),
    15: ("Pastura", "#edde8e"),
    18: ("Agricultura", "#e974ed"),
    21: ("Mosaico de usos", "#ffefc3"),
    22: ("Area sin vegetacion", "#d4271e"),
    23: ("Playa, duna y banco de arena", "#ffa07a"),
    24: ("Infraestructura urbana", "#d4271e"),
    25: ("Otra area antropica sin vegetacion", "#db4d4f"),
    26: ("Cuerpo de agua", "#2532e4"),
    27: ("No observado", "#ffffff"),
    29: ("Afloramiento rocoso", "#ffaa5f"),
    30: ("Mineria", "#9c0027"),
    31: ("Acuicultura", "#091077"),
    33: ("Rio, lago", "#2532e4"),
    34: ("Glaciar", "#93dfe6"),
    39: ("Soya (beta)", "#f5b3c8"),
    61: ("Salar", "#f5d5d5"),
    66: ("Matorral", "#a89358"),
    68: ("Otra area natural sin vegetacion", "#e97a7a"),
    72: ("Otros cultivos", "#c1799c"),
    81: ("Pajonal y arbustal andino", "#c8c099"),
    82: ("Pajonal y arbustal andino inundable", "#66b2a3"),
}


def hex_to_rgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def png_for_tile(values):
    if not np.any(values):
        return None

    palette = [0] * (256 * 3)
    alpha = [0] * 256
    for code, (_, hex_color) in MAPBIOMAS_CLASSES.items():
        r, g, b = hex_to_rgb(hex_color)
        palette[code * 3 : code * 3 + 3] = [r, g, b]
        alpha[code] = 255

    img = Image.fromarray(values.astype("uint8"), mode="P")
    img.putpalette(palette)
    img.info["transparency"] = bytes(alpha)

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def build(input_tif, output_pmtiles, minzoom=0, maxzoom=12):
    input_tif = Path(input_tif)
    output_pmtiles = Path(output_pmtiles)
    output_pmtiles.parent.mkdir(parents=True, exist_ok=True)

    with rasterio.open(input_tif) as src:
        if not src.crs:
            raise RuntimeError("El raster no tiene CRS definido.")
        bounds = src.bounds
        tiles = list(mercantile.tiles(bounds.left, bounds.bottom, bounds.right, bounds.top, range(minzoom, maxzoom + 1)))
        tiles.sort(key=lambda t: zxy_to_tileid(t.z, t.x, t.y))

        header = {
            "tile_compression": Compression.NONE,
            "tile_type": TileType.PNG,
            "min_lon_e7": round(bounds.left * 10_000_000),
            "min_lat_e7": round(bounds.bottom * 10_000_000),
            "max_lon_e7": round(bounds.right * 10_000_000),
            "max_lat_e7": round(bounds.top * 10_000_000),
            "center_lon_e7": round(((bounds.left + bounds.right) / 2) * 10_000_000),
            "center_lat_e7": round(((bounds.bottom + bounds.top) / 2) * 10_000_000),
            "center_zoom": 5,
        }
        metadata = {
            "name": "Cobertura MapBiomas Bolivia 2024",
            "description": "Raster de cobertura y uso del suelo de Bolivia, simbolizado con la paleta MapBiomas Coleccion 3.",
            "attribution": "MapBiomas Bolivia",
            "bounds": [bounds.left, bounds.bottom, bounds.right, bounds.top],
            "minzoom": minzoom,
            "maxzoom": maxzoom,
            "type": "raster",
            "format": "png",
            "legend": [
                {"value": code, "label": label, "color": color}
                for code, (label, color) in sorted(MAPBIOMAS_CLASSES.items())
            ],
        }

        with output_pmtiles.open("wb") as f:
            writer = Writer(f)
            written = 0
            total = len(tiles)
            for i, tile in enumerate(tiles, 1):
                merc = mercantile.xy_bounds(tile)
                dst = np.zeros((256, 256), dtype=np.uint8)
                dst_transform = from_bounds(merc.left, merc.bottom, merc.right, merc.top, 256, 256)
                reproject(
                    source=rasterio.band(src, 1),
                    destination=dst,
                    src_transform=src.transform,
                    src_crs=src.crs,
                    dst_transform=dst_transform,
                    dst_crs="EPSG:3857",
                    src_nodata=0,
                    dst_nodata=0,
                    resampling=Resampling.nearest,
                    num_threads=2,
                )
                png = png_for_tile(dst)
                if png:
                    writer.write_tile(zxy_to_tileid(tile.z, tile.x, tile.y), png)
                    written += 1
                if i % 1000 == 0 or i == total:
                    print(f"{i}/{total} tiles procesados, {written} tiles escritos")

            if written == 0:
                raise RuntimeError("No se escribio ningun tile.")
            writer.finalize(header, metadata)
    print(f"PMTiles creado: {output_pmtiles}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input_tif")
    parser.add_argument("output_pmtiles")
    parser.add_argument("--minzoom", type=int, default=0)
    parser.add_argument("--maxzoom", type=int, default=12)
    args = parser.parse_args()
    build(args.input_tif, args.output_pmtiles, args.minzoom, args.maxzoom)


if __name__ == "__main__":
    main()
