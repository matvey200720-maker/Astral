/*
 * Покрытия для сцены предпросмотра.
 *
 * Настоящие текстуры (асфальт, разметка, бетон трибун) достаёт из установленной
 * игры отдельный пакет `@modovik/gta-preview-assets`. Его может не быть вовсе:
 * игра не подключена, сборка идёт в браузере, пакет ещё не выехал. Поэтому
 * связь с ним односторонняя и необязательная, а на его месте всегда лежит
 * процедурная замена — окно обязано показать дорогу и без игры.
 *
 * Контракт пакета: функция отдаёт список `{ id, url, kind, tileMeters }` либо
 * пустой список. Имя функции не зафиксировано, поэтому берётся первое
 * подходящее из нескольких ожидаемых — сцепка по имени переменной сломалась бы
 * молча, а сломанная сцепка здесь выглядит как «текстуры из игры не приехали»,
 * что человек прочитает как отсутствие игры и пойдёт искать не там.
 */

import * as THREE from "three";

/*
 * Пакет подключён глобом, а не импортом.
 *
 * Обычный `import` из ненайденного пакета роняет сборку всего лаунчера, а этот
 * пакет по своей природе может отсутствовать. `import.meta.glob` на
 * несуществующий путь молча отдаёт пустой набор — ровно то поведение, которое
 * нужно: нет пакета — нет текстур из игры, а не белый экран.
 */
function packageLoaders() {
  try {
    return import.meta.glob(
      "../../../../../../../packages/gta-preview-assets/index.js",
    );
  } catch {
    return {};
  }
}

const EXPORT_CANDIDATES = [
  "listPreviewAssets",
  "loadPreviewAssets",
  "previewAssets",
  "gtaPreviewAssets",
  "default",
];

async function readGameAssets() {
  const loaders = Object.values(packageLoaders());
  if (!loaders.length) return [];
  try {
    const module = await loaders[0]();
    for (const name of EXPORT_CANDIDATES) {
      const entry = module?.[name];
      if (!entry) continue;
      const value = typeof entry === "function" ? await entry() : entry;
      const list = Array.isArray(value) ? value : value?.items;
      if (Array.isArray(list)) return list;
    }
    return [];
  } catch {
    /* Пакет есть, но упал: не читается архив, не нашлась игра, кончилось место.
       Для окна это то же самое, что его отсутствие. */
    return [];
  }
}

/* ---------- процедурная замена ---------- */

const PALETTES = {
  asphalt: { base: [0.052, 0.055, 0.06], grain: 0.05, speck: 0.1 },
  concrete: { base: [0.2, 0.2, 0.196], grain: 0.045, speck: 0.05 },
  kerb: { base: [0.31, 0.305, 0.29], grain: 0.03, speck: 0.03 },
  marking: { base: [0.62, 0.6, 0.55], grain: 0.02, speck: 0.02 },
  dirt: { base: [0.16, 0.13, 0.095], grain: 0.06, speck: 0.06 },
  sand: { base: [0.3, 0.26, 0.19], grain: 0.05, speck: 0.05 },
  grass: { base: [0.055, 0.09, 0.04], grain: 0.05, speck: 0.06 },
  metal: { base: [0.19, 0.2, 0.215], grain: 0.03, speck: 0.02 },
  fabric: { base: [0.11, 0.115, 0.13], grain: 0.04, speck: 0.03 },
};

const DEFAULT_PALETTE = { base: [0.17, 0.17, 0.17], grain: 0.04, speck: 0.04 };

const hash = (x, y, seed) => {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return value - Math.floor(value);
};

function valueNoise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

/*
 * Замена рисуется в массив, а не на canvas.
 *
 * `getContext("2d")` в jsdom отдаёт null, и текстуры, нарисованные холстом,
 * превращают любой тест со сценой в падение на пустом месте. Массив байт
 * работает всюду одинаково — и в браузере, и в тесте, и в Electron.
 */
function proceduralTexture(kind, seed) {
  const size = 128;
  const palette = PALETTES[kind] || DEFAULT_PALETTE;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const coarse = valueNoise(x / 13, y / 13, seed);
      const fine = valueNoise(x / 2.6, y / 2.6, seed + 7);
      const speck = hash(x, y, seed + 19) > 0.987 ? palette.speck : 0;
      const offset = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const linear =
          palette.base[channel] +
          (coarse - 0.5) * palette.grain +
          (fine - 0.5) * palette.grain * 0.6 +
          speck;
        /* В текстуру уходит sRGB — three сам вернёт её в линейный свет по
           `colorSpace`. Писать линейные байты значило бы потерять точность в
           тенях, где как раз и живёт весь асфальт. */
        data[offset + channel] = Math.round(
          Math.min(Math.max(linear, 0), 1) ** (1 / 2.2) * 255,
        );
      }
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  /*
   * Фильтрация задаётся руками, потому что у `DataTexture` в three умолчания
   * не такие, как у обычной текстуры: там `NearestFilter` на увеличение и на
   * уменьшение и выключенные мип-уровни. Замена, оставленная с ними, вблизи
   * разваливается на квадраты по 128 текселей, а вдали кипит муаром — и
   * заметнее всего это на освещённом пятне, где перепад яркости наибольший.
   * Сторона 128 — степень двойки, мип-уровни строятся.
   */
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/* ---------- набор ---------- */

const DEFAULT_TILE_METERS = 4;

/**
 * Загружает набор покрытий. Всегда успешно: без игры и без пакета возвращается
 * тот же объект, только с процедурными текстурами внутри.
 */
export async function loadPreviewAssets({ quality = "medium" } = {}) {
  const raw = await readGameAssets();
  const items = raw
    .filter((item) => item && item.id)
    .map((item) => ({
      id: String(item.id),
      url: item.url ? String(item.url) : "",
      kind: String(item.kind || "concrete"),
      tileMeters: Number(item.tileMeters) || DEFAULT_TILE_METERS,
    }));
  /*
   * Один и тот же `id` приходит дважды — цветом и картой нормалей: это два
   * канала одной текстуры, а не два покрытия. Плоская карта «id → запись»
   * оставила бы последнюю запись, то есть карту нормалей, и асфальт в сцене
   * стал бы сиреневым. Каналы разведены по двум спискам.
   */
  const byId = new Map();
  const normalsById = new Map();
  for (const item of items) {
    const target = item.kind === "normal" ? normalsById : byId;
    if (!target.has(item.id)) target.set(item.id, item);
  }
  const cache = new Map();
  const loader = items.length ? new THREE.TextureLoader() : null;
  let disposed = false;
  /* «Из игры» — только когда есть что показать: список записей без ссылок
      означает ровно ту же процедурную замену, и называть её текстурами из
      игры значит соврать в подписи под окном. */
  const source = [...byId.values()].some((item) => item.url)
    ? "game"
    : "fallback";

  /* Анизотропия — самый заметный на дороге параметр качества: без неё асфальт
     в двадцати метрах превращается в мыло. Но и самый дорогой из дешёвых. */
  const anisotropy = quality === "low" ? 1 : quality === "high" ? 8 : 4;

  /*
   * Пиксели кэшируются отдельно от повтора.
   *
   * Ключ включал `repeat`, а одно и то же покрытие просят с разной плотностью:
   * схема комнаты берёт бетон дважды — по ширине на четыре для пола и на семь
   * для стен. Выходило две записи кэша на одну картинку: две загрузки, два
   * декодирования и два экземпляра в видеопамяти (у покрытия 2048×2048 это
   * два десятка мегабайт на комнату), а у процедурной замены — ещё и второй
   * прогон шума, четыре миллисекунды синхронно на главном потоке.
   *
   * Клон текстуры в three делит `.source` с оригиналом: пиксели загружаются в
   * видеокарту один раз, а повтор, обёртка и анизотропия у каждого клона свои.
   * Оба лежат в одном кэше и освобождаются вместе — `dispose` у клона не
   * трогает общий источник, поэтому порядок значения не имеет.
   */
  function build(table, id, { repeat, kind, colorSpace, onLoad }) {
    if (disposed) return null;
    const key = `${colorSpace}|${id}|${repeat}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const baseKey = `${colorSpace}|${id}`;
    let base = cache.get(baseKey);
    if (!base) {
      const item = table.get(String(id));
      base = item?.url
        ? loader.load(item.url, onLoad, undefined, () => {
            /* Файл пропал между списком и загрузкой — сцена уже нарисована
               базовым цветом, и падать здесь незачем. */
          })
        : proceduralTexture(kind || String(id), cache.size + 1);
      base.colorSpace = colorSpace;
      base.wrapS = THREE.RepeatWrapping;
      base.wrapT = THREE.RepeatWrapping;
      base.anisotropy = anisotropy;
      cache.set(baseKey, base);
    } else if (onLoad && base.image) {
      /* Картинка уже доехала до этого спроса: сцена рисуется по требованию, и
         без сигнала покрытие останется базовым цветом до движения мыши. */
      onLoad(base);
    }

    const texture = base.clone();
    texture.repeat.set(repeat, repeat);
    texture.needsUpdate = true;
    cache.set(key, texture);
    return texture;
  }

  return {
    source,
    items,
    list: (kind) =>
      kind ? items.filter((item) => item.kind === kind) : [...items],
    find: (id) => byId.get(String(id)) || null,
    tileMeters: (id) => byId.get(String(id))?.tileMeters || DEFAULT_TILE_METERS,

    /**
     * Текстура покрытия. `id` — из списка пакета либо любое имя: неизвестное
     * имя даёт процедурную замену вида `kind`, а не пустоту, потому что дыра в
     * сцене выглядит как поломка редактора, а не как отсутствие игры.
     *
     * `onLoad` зовётся, когда картинка доехала: сцена рисуется по требованию,
     * и без этого сигнала текстура из игры доедет в кадр, который никто уже не
     * рисует — покрытие останется базовым цветом до первого движения мыши.
     */
    texture(id, { repeat = 1, kind, onLoad } = {}) {
      return build(byId, id, {
        repeat,
        kind,
        onLoad,
        colorSpace: THREE.SRGBColorSpace,
      });
    },

    /**
     * Карта нормалей того же покрытия, если игра её дала. Её нет — `null`, а
     * не процедурная замена: выдуманный рельеф хуже честно плоского.
     */
    normalTexture(id, { repeat = 1, onLoad } = {}) {
      if (!normalsById.has(String(id))) return null;
      return build(normalsById, id, {
        repeat,
        onLoad,
        /* Карта нормалей — не цвет: пропустить её через гамму значит получить
           рельеф, наклонённый не туда. */
        colorSpace: THREE.NoColorSpace,
      });
    },

    dispose() {
      disposed = true;
      for (const texture of cache.values()) texture.dispose();
      cache.clear();
    },
  };
}
