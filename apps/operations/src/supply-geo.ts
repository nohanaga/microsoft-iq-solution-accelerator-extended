import geo from '../v3/data/geo.json';

export interface GeoPoint { latitude: number; longitude: number }

const toMap = (rows: Array<{ id: string; city: string; latitude: number; longitude: number }>) =>
  new Map(rows.map(row => [row.id, row]));

export const storeGeo = toMap(geo.stores);
export const supplierGeo = toMap(geo.suppliers);
export const geoNote = geo.note;
export const geoPrecision = geo.precision;

const EARTH_RADIUS_KM = 6371.0088;
const toRadians = (value: number) => (value * Math.PI) / 180;
const toDegrees = (value: number) => (value * 180) / Math.PI;

export function distanceKm(from: GeoPoint, to: GeoPoint) {
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLon = toRadians(to.longitude - from.longitude);
  const haversine = Math.sin(deltaLat / 2) ** 2
    + Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

const TILE_SIZE = 256;
/** Web メルカトルで表現できる緯度の限界。 */
const MAX_LATITUDE = 85.05112878;

const fractionX = (longitude: number) => (longitude + 180) / 360;
const fractionY = (latitude: number) => {
  const sin = Math.sin(toRadians(Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, latitude))));
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
};
const longitudeOf = (fraction: number) => fraction * 360 - 180;
const latitudeOf = (fraction: number) => toDegrees(2 * Math.atan(Math.exp((0.5 - fraction) * 2 * Math.PI)) - Math.PI / 2);

export interface MapView { center: GeoPoint; zoom: number }
export interface MapTile { key: string; url: string; x: number; y: number; size: number }
export interface TileViewport {
  project: (point: GeoPoint) => { x: number; y: number };
  locate: (x: number, y: number) => GeoPoint;
  tiles: MapTile[];
  metresPerPixel: number;
}

/** OpenStreetMap の標準タイル。利用規約: https://operations.osmfoundation.org/policies/tiles/ */
const tileUrl = (zoom: number, x: number, y: number) => `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;

export function createTileViewport(view: MapView, width: number, height: number): TileViewport {
  const tileZoom = Math.max(0, Math.min(19, Math.round(view.zoom)));
  const scale = 2 ** (view.zoom - tileZoom);
  const world = TILE_SIZE * 2 ** tileZoom;
  const centreX = fractionX(view.center.longitude) * world;
  const centreY = fractionY(view.center.latitude) * world;
  const toScreenX = (worldX: number) => (worldX - centreX) * scale + width / 2;
  const toScreenY = (worldY: number) => (worldY - centreY) * scale + height / 2;

  const columns = 2 ** tileZoom;
  const firstX = Math.floor((centreX - width / 2 / scale) / TILE_SIZE);
  const lastX = Math.floor((centreX + width / 2 / scale) / TILE_SIZE);
  const firstY = Math.floor((centreY - height / 2 / scale) / TILE_SIZE);
  const lastY = Math.floor((centreY + height / 2 / scale) / TILE_SIZE);
  const tiles: MapTile[] = [];
  for (let row = firstY; row <= lastY; row += 1) {
    if (row < 0 || row >= columns) continue;
    for (let column = firstX; column <= lastX; column += 1) {
      const wrapped = ((column % columns) + columns) % columns;
      tiles.push({
        key: `${tileZoom}/${column}/${row}`,
        url: tileUrl(tileZoom, wrapped, row),
        x: toScreenX(column * TILE_SIZE),
        y: toScreenY(row * TILE_SIZE),
        size: TILE_SIZE * scale,
      });
    }
  }

  return {
    project: point => ({ x: toScreenX(fractionX(point.longitude) * world), y: toScreenY(fractionY(point.latitude) * world) }),
    locate: (x, y) => ({
      longitude: longitudeOf((centreX + (x - width / 2) / scale) / world),
      latitude: latitudeOf((centreY + (y - height / 2) / scale) / world),
    }),
    tiles,
    metresPerPixel: (156543.03392 * Math.cos(toRadians(view.center.latitude))) / 2 ** view.zoom,
  };
}

/** 全拠点が余白の内側へ収まる中心と倍率を返す。 */
export function fitView(points: GeoPoint[], width: number, height: number, padding: number): MapView {
  const xs = points.map(row => fractionX(row.longitude));
  const ys = points.map(row => fractionY(row.latitude));
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const usableX = Math.max(width - padding * 2, 80);
  const usableY = Math.max(height - padding * 2, 80);
  const zoomX = spanX > 0 ? Math.log2(usableX / (TILE_SIZE * spanX)) : 13;
  const zoomY = spanY > 0 ? Math.log2(usableY / (TILE_SIZE * spanY)) : 13;
  return {
    center: {
      longitude: longitudeOf((Math.min(...xs) + Math.max(...xs)) / 2),
      latitude: latitudeOf((Math.min(...ys) + Math.max(...ys)) / 2),
    },
    zoom: Math.max(2, Math.min(16, Math.min(zoomX, zoomY))),
  };
}

/** 縮尺バーに使う、切りのよい距離。 */
export function scaleBarKm(maxKm: number) {
  return [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 500].filter(value => value <= maxKm).pop() ?? 0.2;
}
