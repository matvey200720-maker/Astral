/*
 * Подсветка взятого полотна (и модели сервера в «Замене моделей») в кадре
 * (ТЗ 11.10.2026, ночь, задача 2): правишь «Баннер фойе 2» — в зале обведён
 * именно он, и это видно сквозь перила. Так понятно, какое из трёх одинаковых
 * полотен сейчас в руках, — и до «Применить», и после выбора колесом.
 *
 * Задача 10Б (18.10.2026): прежде это были белые рамки-коробки, а всё остальное выбранное обводилось штрихами и
 * контуром кадра (`selection-highlight.js`). Теперь у арены одна подсветка: полотно — плоский кусок с его краями
 * (`shapeProxy`), модель сервера — силуэт её настоящих сеток в зале (все такие предметы разом), а у модели вне
 * описи зала — грани коробки каждой расстановки.
 */

import { useEffect, useMemo } from "react";
import { arenaObjects } from "@modovik/climb-contract/recolor/arena-objects";
import { arenaPanelFaces } from "@modovik/climb-contract/recolor/arena-panels";
import { arenaReplaceable, replacementToScene } from "@modovik/climb-contract/recolor/arena-replace";
import { arenaSlotElements } from "@modovik/climb-contract/recolor/arenas";
import { disposeProxies, shapeProxy } from "../model-stage/selection-highlight.js";
import { itemSpec } from "./arena-items.js";

/*
 * Полотно — по куску на каждую его сторону, ровно по лицу полотна: то, что меняет «Своя картинка», без рамки вокруг
 * (владелец 31.10.2026: у фото гонщика 0,39 × 0,72 м прежний запас 8 см накрывал и рамку).
 */
export function panelProxies(panel) {
  return arenaPanelFaces(panel, 0.03).map((face) => {
    const w = face.width / 2;
    const h = face.height / 2;
    const corner = (a, b) => face.point.map((value, axis) => value + face.right[axis] * a + face.up[axis] * b);
    return shapeProxy([corner(-w, -h), corner(w, -h), corner(w, h), corner(-w, h)]);
  });
}

/* Коробка расстановки модели — шесть граней в сцене зала. */
function placementProxies(replacement) {
  const { min, max } = replacement.bounds;
  const corners = [];
  for (const z of [min[2], max[2]]) for (const y of [min[1], max[1]]) for (const x of [min[0], max[0]]) corners.push([x, y, z]);
  const faces = [
    [0, 1, 3, 2],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 3, 7, 6],
    [0, 2, 6, 4],
    [1, 3, 7, 5],
  ];
  const out = [];
  for (const placement of replacement.placements) {
    const toScene = replacementToScene(placement);
    const placed = corners.map(toScene);
    for (const face of faces) out.push(shapeProxy(face.map((index) => placed[index])));
  }
  return out;
}

/*
 * Описание подсветки модели сервера: сущности зала с этим именем модели (силуэтом, пока они в кадре), а у модели вне
 * описи зала — грани коробок её расстановок.
 */
function replacementSpec(server, replacement, asset) {
  const model = arenaObjects(server)?.models.find((item) => item.name === replacement.model);
  const entities = model ? new Set(model.keys) : null;
  /* Убранная или подменённая модель следа не оставляет: обводятся только сетки, что в кадре (ТЗ 44А — «ни обводки, ни заглушек»). */
  if (entities && asset?.meshes?.some((mesh) => entities.has(mesh.entity))) return itemSpec(entities, asset, "arena");
  return { proxies: placementProxies(replacement) };
}

/**
 * Что подсветить вокруг элемента `{ section, key }`: описание для кадра (`ModelStage highlight`) — полотно куском,
 * у «Замены моделей» — силуэт модели сервера во всех её расстановках — или `null`. `{ section, place }` — все полотна
 * места разом (строка места под курсором, ТЗ 29.10.2026, Модуль Б); у места без своих полотен (лист зала) — `null`, и
 * кадр штрихует листы инструмента, как прежде.
 */
export function useArenaHighlight({ server, highlight, asset = null }) {
  const built = useMemo(() => {
    if (highlight?.section && highlight.place) {
      const panels = arenaSlotElements(server, highlight.section).filter((item) => item.place === highlight.place && item.panel);
      return panels.length ? { spec: { proxies: panels.flatMap((item) => panelProxies(item.panel)) } } : null;
    }
    if (!highlight?.section || !highlight.key) return null;
    if (highlight.section === "replace") {
      const replacement = arenaReplaceable(server, highlight.key);
      return replacement ? { spec: replacementSpec(server, replacement, asset) } : null;
    }
    const panel = arenaSlotElements(server, highlight.section).find((item) => item.key === highlight.key)?.panel || null;
    return panel ? { spec: { proxies: panelProxies(panel) } } : null;
  }, [server, highlight?.section, highlight?.key, highlight?.place, asset]);
  useEffect(() => () => disposeProxies(built?.spec?.proxies), [built]);
  return built?.spec || null;
}
