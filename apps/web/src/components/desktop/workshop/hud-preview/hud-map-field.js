/*
 * Подложка мини-карты: настоящие плитки карты из установленной игры.
 *
 * Мини-карта в GTA показывает кусок того же атласа, который печатает большая
 * карта, — и плитки этого атласа проект уже умеет читать из установки человека
 * (`readWorldMapTiles`, ими живёт `WorldMapCustomizer`). До сих пор редактор
 * мини-карты вместо них показывал один PNG: полосы HP настраивались поверх
 * чужой картинки, а в игре ложились поверх своей.
 *
 * Здесь плитки собираются в один кадр. Дальше он идёт в общее окно обычным
 * источником кадра — окно про карту по-прежнему ничего не знает.
 *
 * Игры может не быть. Это не ошибка и не повод гасить редактор: тогда
 * возвращается тот же PNG, что и раньше, и честно называется рисунком.
 * Папку игры руками здесь не спрашивают — подложка не стоит того, чтобы
 * открывать человеку окно выбора каталога, которое он не звал.
 */

import { atlasFromTiles, parseTileName, tileRect } from "@modovik/vector-map";
import {
  detectInstallations,
  hasDesktopBridge,
  readWorldMapTiles,
} from "../../../../api.js";
import { tr } from "../../../../locales/ui.js";

/** Рисованная подложка: с ней редактор жил до плиток, с ней и остаётся без игры. */
export const MINIMAP_FIELD_FALLBACK =
  "/assets/workshop/minimap/minimap-gfx-field.png";

/**
 * Подложка редактора мини-карты: квартал с улицами, а не остров.
 *
 * Мини-карта в игре показывает несколько кварталов вокруг игрока. Собранный
 * из плиток атлас — это весь остров, то есть большая карта, и полосы HP поверх
 * него читались как «полосы на фоне большой карты». Поэтому редактор мини-карты
 * стоит на этой картинке, а плитки игры остались тем, кому нужен мир целиком:
 * HUD и значкам.
 *
 * Стрелки игрока на картинке нет намеренно: маркер рисует сам редактор, и
 * человек его меняет — цвет, размер, своя картинка или никакой.
 */
export const MINIMAP_RADAR_FIELD =
  "/assets/workshop/minimap/minimap-radar-field.png";

/**
 * Сторона плитки для подложки размером с ладонь.
 *
 * Мини-карта и HUD показывают кадр целиком в прямоугольнике в две-три сотни
 * точек: там между этой стороной и заводской не видно разницы, а лишние
 * мегабайты в памяти вкладки — вполне.
 */
export const MINIMAP_FIELD_TILE = 512;

/**
 * Заводская сторона плитки: столько точек на плитку атласа хранит сама игра.
 *
 * Нужна тому, кто смотрит на карту вблизи. Радар со значками показывает
 * поперёк себя всего полтора километра мира, и на плитке в 512 точек это уже
 * мыло: атлас в 9000 единиц шириной даёт при ней 0.114 точки на метр, то есть
 * 1600 метров укладываются в 182 точки на радар шириной 221 точку экрана.
 * Заводская плитка вчетверо шире, и тот же радар остаётся честным один к
 * одному примерно до 485 метров поперёк — то есть на всех масштабах, которые
 * редактор значков предлагает (ближний — 800 метров). Под лупой радар шире в
 * 2.4 раза, и граница честности отодвигается до 1160 метров: ближний масштаб
 * под лупой всё ещё мягче единицы, но это уже разница вчетверо меньше той, с
 * которой редактор жил.
 *
 * Дороже это ровно вчетверо по площади, поэтому значение не стало общим по
 * умолчанию: тем, у кого подложка размером с ладонь, платить за неё нечем.
 */
export const MINIMAP_FIELD_TILE_GAME = 2048;

/**
 * Сколько точек на плитку класть на самом деле.
 *
 * Предел — это предел, а не требование: у человека может стоять графический
 * мод с плитками мельче заводских, и растягивать их до предела значит выдумать
 * резкость, которой в файлах нет, заплатив за неё вчетверо большей текстурой.
 * Размер приходит из самих плиток (`readWorldMapTiles` отдаёт его вместе с
 * PNG); когда его нет — например в тестах, — берётся предел.
 */
export function minimapFieldTileSide(tiles, limit = MINIMAP_FIELD_TILE) {
  const sides = (Array.isArray(tiles) ? tiles : [])
    .map((tile) =>
      Math.max(Number(tile?.width) || 0, Number(tile?.height) || 0),
    )
    .filter((side) => side > 0);
  return sides.length ? Math.min(limit, Math.max(...sides)) : limit;
}

const fallbackField = (reason = "") =>
  Object.freeze({
    url: MINIMAP_FIELD_FALLBACK,
    source: "fallback",
    label: tr("Рисованная подложка"),
    reason,
    revoke() {},
  });

/** Картинка из байтов PNG. `null`, когда рисовать некуда (тесты, старый браузер). */
function decodePng(bytes) {
  if (typeof Image !== "function" || typeof URL?.createObjectURL !== "function")
    return Promise.resolve(null);
  const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}

/**
 * Складывает плитки в один кадр.
 *
 * Слой моря лежит под слоем суши: у чужих карт бывают оба, и порядок здесь
 * тот же, что у большой карты, — иначе море закрасит остров.
 */
async function stitchTiles(tiles, limit) {
  if (typeof document === "undefined") return null;
  const atlas = atlasFromTiles(tiles);
  const placed = tiles
    .map((tile) => ({ tile, position: parseTileName(tile?.name) }))
    .filter((item) => item.position)
    .sort((left, right) =>
      left.position.layer === right.position.layer
        ? 0
        : left.position.layer === "sea"
          ? -1
          : 1,
    );
  if (!placed.length) return null;

  const side = minimapFieldTileSide(
    placed.map((item) => item.tile),
    limit,
  );
  const canvas = document.createElement("canvas");
  canvas.width = atlas.columns * side;
  canvas.height = atlas.rows * side;
  let context = null;
  try {
    context = canvas.getContext("2d");
  } catch {
    return null;
  }
  if (!context || typeof canvas.toBlob !== "function") return null;

  const drawn = [];
  for (const { tile, position } of placed) {
    const decoded = await decodePng(tile.png);
    if (!decoded) continue;
    drawn.push(decoded.url);
    const rect = tileRect(position.column, position.row, atlas);
    context.drawImage(
      decoded.image,
      rect.u * canvas.width,
      rect.v * canvas.height,
      rect.width * canvas.width,
      rect.height * canvas.height,
    );
  }
  for (const url of drawn) URL.revokeObjectURL(url);
  if (!drawn.length) return null;

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) return null;
  return {
    url: URL.createObjectURL(blob),
    size: { width: canvas.width, height: canvas.height },
  };
}

/**
 * Подложка мини-карты.
 *
 * @param {object} [options]
 * @param {number} [options.tile] Предел стороны плитки в собранном кадре.
 *   Умолчание рассчитано на подложку размером с ладонь; тот, кто смотрит на
 *   карту вблизи, просит `MINIMAP_FIELD_TILE_GAME`. Величина читается один
 *   раз на открытие редактора вместе с самими плитками: менять её на лету
 *   значит собирать атлас заново, и ни один ползунок этого делать не должен.
 * @returns {Promise<{url:string, source:"game"|"fallback", label:string,
 *   size?:{width:number,height:number}, reason:string, revoke:Function}>}
 *   `source` называет человеку, на что он смотрит: подменять рисунок игрой
 *   молча нельзя, иначе настройка «вижу — значит так и будет» перестаёт
 *   работать ровно у тех, у кого игры нет.
 */
export async function loadMinimapField({
  detect = detectInstallations,
  read = readWorldMapTiles,
  available = hasDesktopBridge,
  tile = MINIMAP_FIELD_TILE,
} = {}) {
  /* В браузере игры под рукой нет по определению, и `detectInstallations`
     ушёл бы в сеть за списком, которого там не бывает. */
  if (!available()) return fallbackField(tr("игра доступна только в приложении"));
  try {
    const installations = (await detect()) || [];
    const legacy = installations.find(
      (item) =>
        item?.path &&
        String(item.edition || "Legacy").toLowerCase() === "legacy",
    );
    if (!legacy?.path) return fallbackField(tr("установка GTA V не найдена"));
    const loaded = await read({ gameRoot: legacy.path });
    if (!loaded?.tiles?.length) return fallbackField(tr("плитки карты не найдены"));
    const stitched = await stitchTiles(loaded.tiles, tile);
    if (!stitched) return fallbackField(tr("плитки карты не читаются"));
    return {
      ...stitched,
      source: "game",
      label: tr("Карта из твоей игры"),
      reason: "",
      revoke: () => URL.revokeObjectURL(stitched.url),
    };
  } catch (error) {
    return fallbackField(error?.message || tr("плитки карты не прочитались"));
  }
}
