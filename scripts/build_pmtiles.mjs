import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import { zxyToTileId } from 'pmtiles';

const HEADER_BYTES = 127;
const ROOT_LEAF_SIZE = 3500;
const COMPRESSION_GZIP = 2;
const TILE_TYPE_MVT = 1;

function writeVarint(value, out) {
  let v = BigInt(value);
  while (v >= 0x80n) {
    out.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  out.push(Number(v));
}

function serializeDirectory(entries) {
  const out = [];
  writeVarint(entries.length, out);

  let lastId = 0n;
  for (const entry of entries) {
    const tileId = BigInt(entry.tileId);
    writeVarint(tileId - lastId, out);
    lastId = tileId;
  }

  for (const entry of entries) writeVarint(entry.runLength ?? 1, out);
  for (const entry of entries) writeVarint(entry.length, out);

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const prev = entries[i - 1];
    if (i > 0 && entry.offset === prev.offset + prev.length) {
      writeVarint(0, out);
    } else {
      writeVarint(entry.offset + 1, out);
    }
  }

  return Buffer.from(out);
}

function lonLatToTile(lon, lat, z) {
  const latRad = lat * Math.PI / 180;
  const n = 2 ** z;
  const x = Math.floor((lon + 180) / 360 * n);
  const y = Math.floor((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2 * n);
  return [
    Math.max(0, Math.min(n - 1, x)),
    Math.max(0, Math.min(n - 1, y)),
  ];
}

function getBounds(geojson) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = coords => {
    if (typeof coords[0] === 'number') {
      bounds[0] = Math.min(bounds[0], coords[0]);
      bounds[1] = Math.min(bounds[1], coords[1]);
      bounds[2] = Math.max(bounds[2], coords[0]);
      bounds[3] = Math.max(bounds[3], coords[1]);
      return;
    }
    coords.forEach(visit);
  };
  for (const feature of geojson.features) {
    if (feature.geometry) visit(feature.geometry.coordinates);
  }
  return bounds;
}

function setUint64(view, offset, value) {
  const v = BigInt(value);
  view.setUint32(offset, Number(v & 0xffffffffn), true);
  view.setUint32(offset + 4, Number(v >> 32n), true);
}

function headerBytes(header) {
  const buf = Buffer.alloc(HEADER_BYTES);
  buf.write('PMTiles', 0, 'ascii');
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint8(7, 3);
  setUint64(view, 8, header.rootDirectoryOffset);
  setUint64(view, 16, header.rootDirectoryLength);
  setUint64(view, 24, header.jsonMetadataOffset);
  setUint64(view, 32, header.jsonMetadataLength);
  setUint64(view, 40, header.leafDirectoryOffset);
  setUint64(view, 48, header.leafDirectoryLength);
  setUint64(view, 56, header.tileDataOffset);
  setUint64(view, 64, header.tileDataLength);
  setUint64(view, 72, header.numAddressedTiles);
  setUint64(view, 80, header.numTileEntries);
  setUint64(view, 88, header.numTileContents);
  view.setUint8(96, 1);
  view.setUint8(97, COMPRESSION_GZIP);
  view.setUint8(98, COMPRESSION_GZIP);
  view.setUint8(99, TILE_TYPE_MVT);
  view.setUint8(100, header.minZoom);
  view.setUint8(101, header.maxZoom);
  view.setInt32(102, Math.round(header.minLon * 1e7), true);
  view.setInt32(106, Math.round(header.minLat * 1e7), true);
  view.setInt32(110, Math.round(header.maxLon * 1e7), true);
  view.setInt32(114, Math.round(header.maxLat * 1e7), true);
  view.setUint8(118, header.centerZoom);
  view.setInt32(119, Math.round(header.centerLon * 1e7), true);
  view.setInt32(123, Math.round(header.centerLat * 1e7), true);
  return buf;
}

function tileRanges(bounds, z) {
  const [minX, maxY] = lonLatToTile(bounds[0], bounds[1], z);
  const [maxX, minY] = lonLatToTile(bounds[2], bounds[3], z);
  return { minX, maxX, minY, maxY };
}

function buildPmtiles({ input, output, layerName, minZoom, maxZoom, tolerance }) {
  const geojson = JSON.parse(fs.readFileSync(input, 'utf8'));
  const bounds = getBounds(geojson);
  const tileIndex = geojsonvt(geojson, {
    maxZoom,
    indexMaxZoom: Math.min(8, maxZoom),
    extent: 4096,
    buffer: 64,
    tolerance,
    promoteId: 'FID',
  });

  const tiles = [];
  for (let z = minZoom; z <= maxZoom; z += 1) {
    const range = tileRanges(bounds, z);
    for (let x = range.minX; x <= range.maxX; x += 1) {
      for (let y = range.minY; y <= range.maxY; y += 1) {
        const tile = tileIndex.getTile(z, x, y);
        if (!tile || !tile.features || tile.features.length === 0) continue;
        const mvt = vtpbf.fromGeojsonVt({ [layerName]: tile });
        if (!mvt || mvt.length === 0) continue;
        tiles.push({
          tileId: zxyToTileId(z, x, y),
          data: zlib.gzipSync(Buffer.from(mvt), { level: 9 }),
        });
      }
    }
  }
  tiles.sort((a, b) => a.tileId - b.tileId);

  const tileBuffers = [];
  const tileEntries = [];
  let tileOffset = 0;
  for (const tile of tiles) {
    tileEntries.push({
      tileId: tile.tileId,
      offset: tileOffset,
      length: tile.data.length,
      runLength: 1,
    });
    tileBuffers.push(tile.data);
    tileOffset += tile.data.length;
  }

  const leafBuffers = [];
  const rootEntries = [];
  let leafOffset = 0;
  for (let i = 0; i < tileEntries.length; i += ROOT_LEAF_SIZE) {
    const leafEntries = tileEntries.slice(i, i + ROOT_LEAF_SIZE);
    const leaf = zlib.gzipSync(serializeDirectory(leafEntries), { level: 9 });
    rootEntries.push({
      tileId: leafEntries[0].tileId,
      offset: leafOffset,
      length: leaf.length,
      runLength: 0,
    });
    leafBuffers.push(leaf);
    leafOffset += leaf.length;
  }

  const rootDirectory = zlib.gzipSync(serializeDirectory(rootEntries), { level: 9 });
  const metadata = zlib.gzipSync(Buffer.from(JSON.stringify({
    name: layerName,
    description: 'Sistemas Ecologicos Acuaticos',
    attribution: 'WWF / FAUNAGUA',
    vector_layers: [{
      id: layerName,
      description: 'Sistemas Ecologicos Acuaticos',
      minzoom: minZoom,
      maxzoom: maxZoom,
      fields: {
        FID: 'Number',
        TA_DATE: 'String',
        SEA: 'String',
        NOMBRE: 'String',
        SUBCUENCA: 'String',
      },
    }],
  })), { level: 9 });

  const leafDirectory = Buffer.concat(leafBuffers);
  const tileData = Buffer.concat(tileBuffers);
  const rootDirectoryOffset = HEADER_BYTES;
  const jsonMetadataOffset = rootDirectoryOffset + rootDirectory.length;
  const leafDirectoryOffset = jsonMetadataOffset + metadata.length;
  const tileDataOffset = leafDirectoryOffset + leafDirectory.length;

  const header = headerBytes({
    rootDirectoryOffset,
    rootDirectoryLength: rootDirectory.length,
    jsonMetadataOffset,
    jsonMetadataLength: metadata.length,
    leafDirectoryOffset,
    leafDirectoryLength: leafDirectory.length,
    tileDataOffset,
    tileDataLength: tileData.length,
    numAddressedTiles: tileEntries.length,
    numTileEntries: tileEntries.length + rootEntries.length,
    numTileContents: tileEntries.length,
    minZoom,
    maxZoom,
    minLon: bounds[0],
    minLat: bounds[1],
    maxLon: bounds[2],
    maxLat: bounds[3],
    centerZoom: 6,
    centerLon: (bounds[0] + bounds[2]) / 2,
    centerLat: (bounds[1] + bounds[3]) / 2,
  });

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, Buffer.concat([header, rootDirectory, metadata, leafDirectory, tileData]));
  console.log(JSON.stringify({
    output,
    layerName,
    features: geojson.features.length,
    tiles: tileEntries.length,
    rootEntries: rootEntries.length,
    bytes: fs.statSync(output).size,
    bounds,
    minZoom,
    maxZoom,
    tolerance,
  }, null, 2));
}

const [input, output, layerName = 'sea', minZoom = '0', maxZoom = '13', tolerance = '3'] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node scripts/build_pmtiles.mjs input.geojson output.pmtiles [layerName] [minZoom] [maxZoom] [tolerance]');
  process.exit(1);
}

buildPmtiles({
  input,
  output,
  layerName,
  minZoom: Number(minZoom),
  maxZoom: Number(maxZoom),
  tolerance: Number(tolerance),
});
