// Находит в архиве пака большой карты плитки, зум и ридми, описывает пак словами
// и собирает плитки в одну картинку RGBA. Попадает в сборку окна: без node:* и Buffer.
import { decodeTextureRef, readTextureDictionary } from '@modovik/rage-drawable';
import { parseMapZoomMeta } from './mapzoom.js';

const CREDIT_LIMIT = 600;
const ZOOM_STEPS_DESCRIBED = 5;
const DEFAULT_TILE_SIDE = 1024;
const TILE_EXTENSION_LENGTH = '.ytd'.length;

// Вид файла определяется таблицей по имени без пути. Без флага g: у регулярных нет памяти между вызовами.
const FILE_KINDS = [
  ['tile', /^minimap_(?<sea>sea_)?(?<row>[0-9]+)_(?<column>[0-9]+)\.ytd$/i],
  ['zoom', /^mapzoomdata\.meta$/i],
  ['readme', /^readme\.txt$/i],
  ['vector', /^minimap_[0-9]+_[0-9]+\.ydd$/i],
  ['miniMap', /^minimap_main_map\.gfx$/i],
];
const WANTED_KINDS = new Set(['tile', 'zoom', 'readme']);

// Обратная косая разделителем не считается.
const baseName = (fullName) => fullName.slice(fullName.lastIndexOf('/') + 1);

function classify(fullName) {
  const base = baseName(fullName);
  const [kind, pattern] = FILE_KINDS.find(([, rule]) => rule.test(base)) ?? [null];
  return { kind, base, groups: pattern?.exec(base).groups };
}

export function MAP_PACK_WANTED(file) {
  return WANTED_KINDS.has(classify(String(file.name)).kind);
}

const decodeUtf8 = (bytes) => new TextDecoder().decode(bytes);

// Что делать с файлом каждого нужного вида при разборе; поздний текст стирает прежний.
const GATHERERS = {
  tile(found, { base, groups }, bytes) {
    found.tiles.push({
      name: base.slice(0, -TILE_EXTENSION_LENGTH).toLowerCase(),
      sea: Boolean(groups.sea),
      row: Number(groups.row),
      column: Number(groups.column),
      bytes,
    });
  },
  zoom(found, _, bytes) {
    found.zoomText = decodeUtf8(bytes);
  },
  readme(found, _, bytes) {
    found.readmeText = decodeUtf8(bytes);
  },
};

const byGridPosition = (a, b) => a.row - b.row || a.column - b.column || a.sea - b.sea;

export function readMapPack(zipBytes, { unzip, list = null } = {}) {
  const files = unzip(zipBytes, { filter: MAP_PACK_WANTED });
  const names = list ? list(zipBytes) : Object.keys(files);

  const { tiles, zoomText, readmeText } = Object.keys(files).reduce((found, fullName) => {
    const facts = classify(fullName);
    GATHERERS[facts.kind]?.(found, facts, files[fullName]);
    return found;
  }, { tiles: [], zoomText: '', readmeText: '' });

  const kinds = names.map((name) => classify(name).kind);
  return {
    tiles: tiles.sort(byGridPosition),
    zoom: zoomText ? parseMapZoomMeta(zoomText) : [],
    vectorTiles: kinds.filter((kind) => kind === 'vector').length,
    miniMap: kinds.includes('miniMap'),
    credit: readmeText.slice(0, CREDIT_LIMIT),
  };
}

// Уменьшение одним проходом по строкам исходника: точки копятся в суммах строки результата,
// каждые factor строк суммы сливаются в результат. Целые блоки — и только они: остаток отброшен.
function averageBlocks(source, sourceWidth, factor, width, height) {
  const reduced = new Uint8ClampedArray(width * height * 4);
  const sums = new Float64Array(width * 4); // R·A, G·A, B·A, A на каждую точку строки
  const blockArea = factor * factor;

  for (let sourceY = 0; sourceY < height * factor; sourceY += 1) {
    for (let sourceX = 0; sourceX < width * factor; sourceX += 1) {
      const from = (sourceY * sourceWidth + sourceX) * 4;
      const slot = Math.floor(sourceX / factor) * 4;
      const alpha = source[from + 3];
      sums[slot] += source[from] * alpha;
      sums[slot + 1] += source[from + 1] * alpha;
      sums[slot + 2] += source[from + 2] * alpha;
      sums[slot + 3] += alpha;
    }
    if ((sourceY + 1) % factor === 0) {
      const rowStart = Math.floor(sourceY / factor) * width * 4;
      for (let slot = 0; slot < sums.length; slot += 4) {
        const alphaSum = sums[slot + 3];
        // Округление и ограничение делает сам Uint8ClampedArray.
        for (let channel = 0; channel < 3; channel += 1) {
          reduced[rowStart + slot + channel] = alphaSum === 0 ? 0 : sums[slot + channel] / alphaSum;
        }
        reduced[rowStart + slot + 3] = alphaSum / blockArea;
      }
      sums.fill(0);
    }
  }
  return reduced;
}

export function tilePixels(tile, { inflateRaw, side = DEFAULT_TILE_SIDE } = {}) {
  const textures = readTextureDictionary(tile.bytes, { inflateRaw });
  const chosen = textures.find((texture) => texture.format) ?? textures[0];
  if (!chosen) throw new Error(`В плитке ${tile.name} нет текстуры.`);

  const { width, height, rgba } = decodeTextureRef(chosen);
  // Обычная математика намеренно: side 0, null, NaN дают пустую картинку без ошибки (контракт).
  const factor = Math.max(1, Math.floor(width / Math.min(side, width)));
  if (factor === 1) return { width, height, rgba, source: width };

  const reducedWidth = Math.floor(width / factor);
  const reducedHeight = Math.floor(height / factor);
  return {
    width: reducedWidth,
    height: reducedHeight,
    rgba: averageBlocks(rgba, width, factor, reducedWidth, reducedHeight),
    source: width,
  };
}

// Math.max пропускает NaN, поэтому плохой ряд или колонка дойдут до RangeError при укладке.
const peak = (items, read) => items.reduce((top, item) => Math.max(top, read(item)), -Infinity);

export function stitchMapPack(pack, { inflateRaw, side = DEFAULT_TILE_SIDE } = {}) {
  const land = pack.tiles.filter((tile) => !tile.sea);
  const chosen = land.length > 0 ? land : pack.tiles;
  if (chosen.length === 0) throw new Error('В архиве нет плиток карты.');

  const rows = peak(chosen, (tile) => tile.row) + 1;
  const columns = peak(chosen, (tile) => tile.column) + 1;
  const layers = chosen.map((tile) => ({ tile, picture: tilePixels(tile, { inflateRaw, side }) }));
  const tileSide = peak(layers, ({ picture }) => picture.width);
  const sourceSide = peak(layers, ({ picture }) => picture.source);

  const width = columns * tileSide;
  const height = rows * tileSide;
  const rgba = new Uint8ClampedArray(width * height * 4);

  // Высота не обрезается: высокая плитка затекает ниже, за концом холста set даёт RangeError.
  for (const { tile, picture } of layers) {
    const stride = picture.width * 4;
    for (let y = 0; y < picture.height; y += 1) {
      const line = picture.rgba.subarray(y * stride, (y + 1) * stride);
      rgba.set(line, ((tile.row * tileSide + y) * width + tile.column * tileSide) * 4);
    }
  }
  return { width, height, rgba, rows, columns, tileSide, sourceSide };
}

const SEA_NOTE = ' (и такие же для слоя с морем)';
const NOT_A_PACK = 'Плиток карты в архиве нет — это не пак большой карты.';
const NO_VECTOR = 'Векторного слоя нет — пак целиком растровый.';
const NO_ZOOM = 'Файла зума в архиве нет.';
const TILES_OFF_NOTE = ' — штатные векторные плитки отключены, картинка видна и вблизи';
const HAS_MINI_MAP = 'В паке есть и мини-карта — её Astral не берёт.';

function tilesLine(tiles, side) {
  const landCount = tiles.filter((tile) => !tile.sea).length;
  if (landCount === 0) return NOT_A_PACK;
  const sideNote = side ? `, по ${side}×${side}` : '';
  return `Плиток карты: ${landCount}${sideNote}${tiles.length > landCount ? SEA_NOTE : ''}.`;
}

function zoomLine(zoom) {
  if (zoom.length === 0) return NO_ZOOM;
  const steps = zoom.slice(0, ZOOM_STEPS_DESCRIBED);
  const scales = steps.map((step) => step.scale).join(' → ');
  const tilesOff = steps.every((step) => !step.tiles[0] && !step.tiles[1]);
  return `Зум: ${scales}${tilesOff ? TILES_OFF_NOTE : ''}.`;
}

export function describeMapPack(pack, { side = 0 } = {}) {
  const vectorLine = pack.vectorTiles
    ? `Векторный слой: ${pack.vectorTiles} файлов геометрии. Astral их не переносит — игра падала на пустых векторных плитках; берётся только картинка.`
    : NO_VECTOR;
  return [
    tilesLine(pack.tiles, side),
    vectorLine,
    zoomLine(pack.zoom),
    ...(pack.miniMap ? [HAS_MINI_MAP] : []),
  ];
}
