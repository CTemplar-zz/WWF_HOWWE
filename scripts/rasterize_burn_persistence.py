"""Rasterize the ArcGIS Pro burn-persistence shapefile for web map tiles."""

import sys
from osgeo import gdal, ogr


def main(source, destination, cell_size=75):
    gdal.UseExceptions()
    vector = ogr.Open(source)
    if vector is None:
        raise RuntimeError(f"Unable to open {source}")
    extent = vector.GetLayer(0).GetExtent()  # xmin, xmax, ymin, ymax
    options = gdal.RasterizeOptions(
        format="GTiff",
        outputBounds=[extent[0], extent[2], extent[1], extent[3]],
        xRes=cell_size,
        yRes=cell_size,
        outputType=gdal.GDT_Byte,
        attribute="ANIOS",
        noData=0,
        creationOptions=["TILED=YES", "COMPRESS=DEFLATE", "BIGTIFF=IF_SAFER"],
    )
    print(f"Rasterizing {source} at {cell_size} m to {destination}", flush=True)
    result = gdal.Rasterize(destination, source, options=options)
    if result is None:
        raise RuntimeError("Rasterization failed")
    print(f"Finished: {result.RasterXSize} x {result.RasterYSize}", flush=True)
    result = None


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 75)
