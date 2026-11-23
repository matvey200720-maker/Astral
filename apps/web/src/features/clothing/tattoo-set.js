/*
 * Набор тату каталога с выбором (круг 7, 30.10.2026; «Blackwork» из архива nightzmodz: семь рисунков под именами штатных тату игры). Что это за набор и как он ставится — `apps/desktop/src/tattoo-set.js`.
 *
 * Окно узнаёт части набора по карточке, а не по пакету: у каждой «расцветки» набора тату — свой кадр на персонаже (`preview`), а в подписи кадра — имя файла части («mp_bea_tat_m_006»). Пакет качается
 * при установке и только выбранные части. Здесь — чистые функции: части набора, тату игры, на которые часть может лечь, и выбор по умолчанию.
 */

import { useEffect, useState } from "react";
import { clothingOf, isTattooPack } from "./clothing-catalog.js";
import { listGameTattoos } from "../../api.js";
import { detectLegacyGame } from "../workshop/install-queue/game-root.js";
import { whenPersonaFramePainted } from "../workshop/persona-frame.js";

const TXD = /\b(mp_[a-z0-9]+_tat_[a-z0-9_]+)\b/i;
const EMPTY = Object.freeze([]);

/**
 * Части набора тату карточки: `[{ letter, txd, file, image }]` — кадр на персонаже и файл части. `null` — не набор по тату игры (кожа тела `mp_fm_skin_*`, одно тату без имени игры, не тату):
 * такая карточка ставится прежним путём.
 */
export function tattooSetOf(mod) {
  if (!isTattooPack(mod)) return null;
  const block = clothingOf(mod);
  const parts = [];
  for (const set of block?.sets || [])
    for (const variant of set.variants || []) {
      const frame = (mod.gallery || []).find((item) => item?.source && item.source === variant.preview);
      const txd = TXD.exec(String(frame?.caption || ""))?.[1]?.toLowerCase();
      if (!txd) return null;
      parts.push({ letter: variant.letter, txd, file: `${txd}.ytd`, image: frame?.url || null });
    }
  return parts.length ? Object.freeze(parts) : null;
}

/** Тату игры, которое автор набора имел в виду для части (имя файла части — имя картинки тату). */
export const originalOf = (tattoos, part, gender = "male") =>
  tattoos.find((tattoo) => String(tattoo.txd || "").toLowerCase() === part.txd && (!tattoo.gender || tattoo.gender === gender)) || null;

/*
 * Порядок «сначала дешёвые»: цена салона по возрастанию; у тату салона без цены в файлах (её знает скрипт салона) — после всех с ценой; тату, которого в салоне нет (купить нельзя, а заменёнка видна, только когда оно набито), — в самом конце.
 */
const costRank = (tattoo) => (tattoo.sold === false ? 2 : Number(tattoo.cost) > 0 ? 0 : 1);
export const byCost = (left, right) =>
  costRank(left) - costRank(right) || (Number(left.cost) || 0) - (Number(right.cost) || 0) || String(left.title).localeCompare(String(right.title), "ru");

/**
 * На какие тату игры может лечь часть: той же части тела, что и её тату у автора, — сначала то самое, дальше дешёвые (их и берут под рисунок), несущие в салоне цену выше, чем бесценные.
 * Тату другого места на теле часть не предлагается: рамка у него другая, а ложится картинка в рамку.
 */
export function targetsFor(tattoos, part, { gender = "male", taken = new Set() } = {}) {
  const original = originalOf(tattoos, part, gender);
  if (!original) return EMPTY;
  const own = original.key;
  return tattoos
    .filter((tattoo) => tattoo.zone === original.zone && (!tattoo.gender || tattoo.gender === gender) && !taken.has(tattoo.key))
    .sort((left, right) => Number(right.key === own) - Number(left.key === own) || byCost(left, right));
}

/** Выбор при открытии (голос владельца 01.11.2026: «идут со знаком вопроса»): на каждой части «?», тату выбирает человек. Части, у которой в игре нет тату автора, ставить некуда: рамка неизвестна. */
export function defaultChoices(tattoos, parts, gender = "male") {
  const choices = {};
  for (const part of parts) choices[part.file] = { target: "", on: Boolean(originalOf(tattoos, part, gender)) };
  return choices;
}

/** Выбор → то, что уходит в установку: `[{ file, target }]` по включённым частям. */
export const picksOf = (parts, choices) =>
  parts.filter((part) => choices[part.file]?.on && choices[part.file]?.target).map((part) => ({ file: part.file, target: choices[part.file].target }));

/* Тату игры одного пути — один запрос на окно: Desktop держит оглавление в кэше, но IPC-ответ в сотни килобайт дважды читать незачем. */
const lists = new Map();

/** Тату игры по папке игры: `{ status: "idle" | "no-game" | "loading" | "ready" | "error", tattoos, error }`. */
export function useGameTattooList(gameRoot) {
  const [state, setState] = useState({ status: "idle", tattoos: EMPTY, error: "" });
  useEffect(() => {
    if (!gameRoot) {
      setState({ status: "no-game", tattoos: EMPTY, error: "" });
      return undefined;
    }
    let alive = true;
    setState((current) => ({ ...current, status: "loading" }));
    /* Персонаж первым (15.11.2026): пока студия грузит модель, список тату не просится — разбор 1,4 МБ и сотен строк шёл бы вместе с загрузкой персонажа (`persona-frame.js`). */
    if (!lists.has(gameRoot))
      lists.set(
        gameRoot,
        whenPersonaFramePainted()
          .then(() => listGameTattoos({ gameRoot }))
          .catch((error) => {
            lists.delete(gameRoot);
            throw error;
          }),
      );
    lists
      .get(gameRoot)
      .then((answer) => {
        if (alive) setState({ status: "ready", tattoos: Array.isArray(answer?.tattoos) ? answer.tattoos : EMPTY, error: "" });
      })
      .catch((error) => {
        if (alive) setState({ status: "error", tattoos: EMPTY, error: String(error?.message || error) });
      });
    return () => {
      alive = false;
    };
  }, [gameRoot]);
  return state;
}

/** Папка игры: названная мастерской, иначе установка Legacy, найденная без окна выбора. `{ root, detecting }`. */
export function useFoundGameRoot(gameRoot) {
  const [found, setFound] = useState(null);
  useEffect(() => {
    if (gameRoot) return undefined;
    let alive = true;
    void detectLegacyGame()
      .then((path) => {
        if (alive) setFound(path || "");
      })
      .catch(() => {
        if (alive) setFound("");
      });
    return () => {
      alive = false;
    };
  }, [gameRoot]);
  return { root: gameRoot || found || "", detecting: !gameRoot && found === null };
}

/** Забыть прочитанное: следующее окно спросит Desktop заново (тесты, смена игры). */
export const forgetGameTattooList = () => lists.clear();
