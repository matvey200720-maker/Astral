/*
 * Человек у табло в кадре «На месте» (задача 14, доработка ТЗ 18.10.2026, поздний вечер): вместо чёрной
 * капсулы — свободный персонаж из самой игры (голова, причёска, руки, футболка, джинсы, кеды в стойке, как
 * у жертвы в сцене боя). Рост 1,8 м рядом с табло в 3,3–4,5 м нужен для масштаба.
 *
 * Тело читает главный процесс из архивов игры игрока (`readStandingBody`; в песочнице — тот же код у
 * dev-сервера, `qa-standing-body.js`), модель в поставке не лежит. Нет игры, нет Astral Desktop или тело не
 * прочиталось — человека в кадре нет совсем: рисованной замены нет. Тело читается один раз на окно.
 */

import { useEffect, useMemo, useState } from "react";
import { detectInstallations, hasDesktopBridge, readStandingBody, standingBodyAvailable } from "../../../api.js";
import { loadActor } from "../combat-stage/combat-actors.js";

/* Где стоит человек: справа от табло, на метр с небольшим за его краем и в полуметре от стены, лицом к зрителю и чуть к табло. */
export const VISITOR = Object.freeze({ gap: 1.15, depth: -0.55, yaw: -0.85 });

/** Положение человека у табло шириной `width` (оси сцены, Z вверх): `{ position, yaw }` для таза при высоте `lift` от земли. */
export const visitorPlacement = (width, lift) => ({ position: [width / 2 + VISITOR.gap, VISITOR.depth, lift], yaw: VISITOR.yaw });

/* Папка игры: первая Legacy, как у остальных редакторов мастерской (`ptfxGameRoot`). */
async function gameRoot() {
  if (!hasDesktopBridge()) return "";
  const found = await detectInstallations();
  const games = Array.isArray(found) ? found : found?.games || [];
  return games.find((game) => game?.path && String(game.edition || "Legacy").toLowerCase() === "legacy")?.path || "";
}

let reading = null;
/** Тело в стойке: `{ body }` или `null` (игры нет, окно не умеет, чтение отказало). Прочитанное лежит в памяти окна; `null` не запоминается. */
export function loadVisitorBody() {
  if (!standingBodyAvailable()) return Promise.resolve(null);
  if (!reading) {
    const attempt = (async () => {
      const root = await gameRoot();
      if (!root) return null;
      const answer = await readStandingBody({ gameRoot: root });
      return answer?.body ? { body: answer.body } : null;
    })()
      .catch(() => null)
      .then((read) => {
        if (!read && reading === attempt) reading = null;
        return read;
      });
    reading = attempt;
  }
  return reading;
}

/**
 * Человек для кадра: `{ object } | null` — запись для `objects` кадра (освобождает его сам хук). Стоит у табло шириной `width`;
 * сменилось место (ширина) — переставляется, тело не перечитывается.
 */
export function useScheduleVisitor(width) {
  const [actor, setActor] = useState(null);
  useEffect(() => {
    let cancelled = false;
    let made = null;
    loadVisitorBody()
      .then((read) => (read ? loadActor({ body: read.body }) : null))
      .then((loaded) => {
        if (!loaded) return;
        if (cancelled) loaded.dispose();
        else {
          made = loaded;
          setActor(loaded);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      made?.dispose();
    };
  }, []);
  return useMemo(() => {
    if (!actor) return null;
    actor.setPlacement(visitorPlacement(width, actor.footLift));
    return { object: actor.placement };
  }, [actor, width]);
}
