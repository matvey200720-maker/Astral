/*
 * «Подлетел, нажал колёсико — правишь именно это» (ТЗ 11.10.2026, ночь,
 * задача 2). Нажатие колеса по кадру арены (`onAim` общего кадра) — что
 * открыть на правку: инструмент раздела и, если у места элементы по одному,
 * ключ элемента — полотна, экрана, таблички под курсором.
 *
 * Попадание кадра — `{ point, material, uv?, pick? }` (`orbit-stage.js`):
 * материал сцены знает группу листа (раздел) и имя листа (место), точка —
 * какое из полотен места (`arenaPanelAtPoint`), развёртка — какой остров у
 * мест, что делятся островами. Плашка своего вида полотна (`pick`) — сразу
 * её элемент.
 */

import { arenaPanelAtPoint } from "@modovik/climb-contract/recolor/arena-panels";
import { ARENA_REPLACEABLE } from "@modovik/climb-contract/recolor/arena-replace";
import {
  ARENA_CLOTH_TEXTURE,
  ARENA_SECTIONS,
  ARENA_SLOTS,
  MAJESTIC_CENTRE_EMBLEM,
  arenaChairVariants,
  arenaCovers,
  arenaPlaceElements,
  arenaServerInventory,
  arenaSlotElements,
  arenaPlacePlated,
  arenaTexturePlace,
} from "@modovik/climb-contract/recolor/arenas";

const CHAIRS = new Set(arenaChairVariants().map((item) => item.id));
const OBJECTS = new Set(["vending", "atms", "parking", "cola"]);
const wrap = (value) => value - Math.floor(value);
const within = (rect, [u, v], margin = 0.002) => u >= rect[0] - margin && u <= rect[2] + margin && v >= rect[1] - margin && v <= rect[3] + margin;

/* Элемент места под точкой: полотно, лист, остров — или само место. */
function elementOf(server, section, place, { name, point, uv }) {
  const elements = arenaPlaceElements(server, section, place);
  if (!elements.length) return null;
  if (elements.some((item) => item.panel)) {
    const found = point ? arenaPanelAtPoint(elements.map((item) => ({ key: item.key, panel: item.panel })), point) : null;
    return found?.key || null;
  }
  if (elements.some((item) => item.texture)) return elements.find((item) => item.texture === name)?.key || null;
  if (elements.some((item) => item.islands) && uv) {
    const record = (arenaServerInventory(server)?.textures || []).find((item) => item.name === name && item.group === section && item.islands?.length);
    const at = [wrap(uv[0]), wrap(uv[1])];
    const index = record ? record.islands.findIndex((island) => within(island.rect, at)) : -1;
    return index >= 0 ? elements.find((item) => item.islands?.includes(index))?.key || null : null;
  }
  return elements.length === 1 ? elements[0].key : null;
}

/**
 * Что открыть по нажатию колеса: `{ tool, key? }` или `null` (мимо
 * правящегося — пол под креслом, грязь, служебные сетки). `asset` — сцена
 * кадра (материалы), `server` — сервер работы.
 */
export function arenaAimTarget(server, asset, hit) {
  if (!hit) return null;
  const tools = new Set([...ARENA_SECTIONS[server].outside, ...ARENA_SECTIONS[server].inside]);
  if (hit.pick?.kind === "panel" && hit.pick.section) return { tool: hit.pick.section, key: hit.pick.key };
  /* Своя модель вместо модели сервера — её карточка в «Замене моделей». */
  if (hit.pick?.kind === "replace" && tools.has("replace")) return { tool: "replace", key: hit.pick.key };
  const info = Number.isInteger(hit.material) ? asset?.materials?.[hit.material] : null;
  if (!info) return null;
  /* Модель сервера, что можно заменить (аирдроп, болид…), — её карточка. */
  const replaceable = tools.has("replace") ? (ARENA_REPLACEABLE[server] || []).find((item) => info.file === `${item.model}.ydr`) : null;
  if (replaceable) return { tool: "replace", key: replaceable.id };
  const group = String(info.group || "");
  /* Полотна у арок снаружи — у каждого свой материал (`splitArenaCloths`). */
  if (info.element && info.name === ARENA_CLOTH_TEXTURE) return { tool: "outBanners", key: info.element };
  if (group.startsWith("cover:")) {
    const cover = arenaCovers(server).find((entry) => entry.place === group.slice("cover:".length));
    return cover && tools.has(cover.section) ? { tool: cover.section, key: cover.place } : info.base && tools.has(info.base) ? { tool: info.base } : null;
  }
  /* Крылатый знак в центре зала Majestic — наклейка пола, но место «Эмблем зала» (только его квадрат). */
  if (server === "majestic" && info.name === MAJESTIC_CENTRE_EMBLEM.record.name && hit.uv) {
    const at = [wrap(hit.uv[0]), wrap(hit.uv[1])];
    if (MAJESTIC_CENTRE_EMBLEM.record.islands.some((island) => within(island.rect, at))) return { tool: MAJESTIC_CENTRE_EMBLEM.section, place: MAJESTIC_CENTRE_EMBLEM.place.id, key: MAJESTIC_CENTRE_EMBLEM.place.id };
  }
  /* Места только плашками (картины и баннеры Majestic) — по листу, в какой бы группе сцены он ни был. */
  for (const section of ARENA_SLOTS) {
    if (section === group || !tools.has(section)) continue;
    const plated = arenaTexturePlace(server, section, info.name);
    if (!plated || !arenaPlacePlated(server, section, plated.place)) continue;
    const key = elementOf(server, section, plated.place, { name: info.name, point: hit.point, uv: hit.uv });
    return { tool: section, place: plated.place, ...(key ? { key } : {}) };
  }
  if (ARENA_SLOTS.includes(group) && tools.has(group)) {
    const place = arenaTexturePlace(server, group, info.name);
    if (!place) return { tool: group };
    const key = elementOf(server, group, place.place, { name: info.name, point: hit.point, uv: hit.uv });
    return { tool: group, place: place.place, ...(key ? { key } : {}) };
  }
  /* Лист фасада с местами снаружи (надпись, логотипы, баннеры) — по острову области. */
  if (group === "outside") {
    const record = (arenaServerInventory(server)?.textures || []).find((item) => item.group === "outside" && item.name === info.name);
    const at = hit.uv ? [wrap(hit.uv[0]), wrap(hit.uv[1])] : null;
    const region = at ? (record?.regions || []).find((item) => item.islands?.some((island) => within(island.rect, at))) : null;
    if (region && tools.has(region.section)) {
      const elements = arenaPlaceElements(server, region.section, region.place);
      const index = region.islands.findIndex((island) => within(island.rect, at));
      const key = elements.find((item) => item.islands?.includes(index))?.key || (elements.length === 1 ? elements[0].key : null);
      return { tool: region.section, place: region.place, ...(key ? { key } : {}) };
    }
    return tools.has("facade") ? { tool: "facade" } : null;
  }
  if (CHAIRS.has(group) || group === "seats") return tools.has("seats") ? { tool: "seats" } : null;
  if (OBJECTS.has(group)) return tools.has("objects") ? { tool: "objects" } : null;
  if (PANEL_OVERLAYS.has(info.name)) {
    const panel = panelUnder(server, tools, hit.point);
    if (panel) return panel;
  }
  return tools.has(group) ? { tool: group } : null;
}

/*
 * Полотно под слоем оболочки: у табло турнира Majestic перед листом `standings_en` лежит прозрачная сетка точек стены
 * (`tk_ammo_dots_mask_diffuse`, группа `walls`) — щелчок по табло попадал в неё, открывал «Стены» и штриховал весь слой (ведущая 31.10.2026).
 * Сетка шире полотен описи (до 0,8 м за краем табло), поэтому полотно — ближайшее к точке в пределах полутора метров вдоль стены.
 */
const PANEL_OVERLAYS = new Set(["tk_ammo_dots_mask_diffuse"]);
function panelUnder(server, tools, point) {
  if (!point) return null;
  for (const section of ARENA_SLOTS) {
    if (!tools.has(section)) continue;
    const panels = arenaSlotElements(server, section).filter((item) => item.panel);
    const found = panels.length ? arenaPanelAtPoint(panels, point, { slack: 1.5, depth: 0.5 }) : null;
    if (found) return { tool: section, place: found.place, key: found.key };
  }
  return null;
}

/**
 * Прямоугольник острова развёртки под попаданием — только он и подсвечивается,
 * когда на одном листе стоят несколько мест (баннеры фасада, картины зала):
 * правится один, а не весь лист. `null` — у листа нет островов или точка мимо.
 */
export function arenaHitIsland(server, asset, hit) {
  const info = Number.isInteger(hit?.material) ? asset?.materials?.[hit.material] : null;
  if (!info || !hit.uv) return null;
  const records = (arenaServerInventory(server)?.textures || []).filter((item) => item.name === info.name && item.islands?.length);
  const record = records.find((item) => item.group === info.group) || records[0];
  if (!record) return null;
  const at = [wrap(hit.uv[0]), wrap(hit.uv[1])];
  return record.islands.find((island) => within(island.rect, at))?.rect || null;
}
