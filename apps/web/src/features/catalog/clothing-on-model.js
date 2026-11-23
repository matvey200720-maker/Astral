/*
 * «Вещь на персонаже» в окне 3D мода одежды (владелец, 28.10.2026: «на персонаже отдельно превьюшку не делать: если человек нажимает 3D —
 * прогружается как на персонаже»). Отдельного кадра в ленте карточки нет (853b5655e): персонаж живёт только в окне «3D».
 *
 * Персонажа не возим: его собирает Astral Desktop из файлов игры человека (`readClothingCharacter`, GLB: тело в белье и вещь из пакета
 * мода «как в файле»; тот же мужской персонаж, что в «На модельке» мастерской). Собирается по требованию — когда открыли окно «3D» (чтение игры
 * и пакета — секунды): пока едет, окно показывает саму вещь, потом подменяет её персонажем. Готовый GLB держится адресом blob: на мод — второй раз
 * окно открывается сразу. Нет игры, нет пакета, у категории нет места на теле — остаётся вещь сама, честно, без нарисованного персонажа.
 */
import { useEffect, useState } from "react";
import { shelfOfCategory } from "@modovik/clothing/taxonomy";
import { hasClothingCharacter, readClothingCharacter } from "../../api.js";
import { clothingOf } from "../clothing/clothing-catalog.js";
import { clothingSectionOf } from "./clothing-sections.js";
import { detectLegacyGame } from "../workshop/install-queue/game-root.js";
import { notePreviewFailure } from "../clothing/preview-journal.js";

/* Категории, у которых Desktop знает набор частей тела (`CHARACTER_OUTFITS`): тату и прочее персонаж не показывает. */
const SLOTS = new Set([
  "tshirts",
  "government-clothing",
  "armor",
  "pants",
  "shoes",
  "hats",
  "accessories",
  "masks",
  "gloves",
  "bags",
  /* Причёска и борода — вещи на персонаже (14.11.2026). */
  "hair",
  "beards",
]);

/** Слот вещи на персонаже или пусто, если у категории места на теле нет. */
export function onModelSlot(mod) {
  const block = clothingOf(mod);
  if (!block) return "";
  const slot = shelfOfCategory(block.category || mod?.catalogSlot || "");
  /* Борода — маска с тегом «борода» (`clothing-sections.js`): на лице, причёска остаётся; маска причёску прячет. */
  if (slot === "masks" && clothingSectionOf(mod) === "beards") return "beards";
  return SLOTS.has(slot) ? slot : "";
}

/** Персонаж в вещи доступен, когда окно умеет его собрать и у вещи есть место на теле. */
export const onModelAvailable = (mod) => Boolean(onModelSlot(mod)) && hasClothingCharacter();

const built = new Map();
const LIMIT = 6;
const keyOf = (mod, colour) => `${mod?.id || ""}|${colour || ""}`;

/**
 * Адрес GLB персонажа в вещи мода (blob:), собранного из игры человека. Повтор — из памяти; не собрался — отказ (память отказ не держит:
 * следующая попытка пробует снова).
 */
export function loadOnModel(mod, colour = "") {
  const key = keyOf(mod, colour);
  if (built.has(key)) return built.get(key);
  const pending = (async () => {
    const slot = onModelSlot(mod);
    if (!slot) throw new Error("У этой вещи нет места на персонаже.");
    const gameRoot = await detectLegacyGame();
    if (!gameRoot) throw new Error("Персонажа собирают из вашей игры: GTA V Legacy не найдена.");
    /* Пакет вещи — у облачной через выдачу ссылки; тяжёлый разбор модели — у Desktop, окну он не нужен. */
    const { catalogPackageOf } = await import("../../components/desktop/workshop/gun/clothing-models.js");
    const pack = await catalogPackageOf(mod);
    /* Расцветка — буква пакета (28.10.2026): персонаж надевает выбранный цвет мода, а не первый. */
    const result = await readClothingCharacter({ gameRoot, slot, ...pack, onModel: true, ...(colour ? { colour } : {}) });
    return URL.createObjectURL(new Blob([result.bytes], { type: "model/gltf-binary" }));
  })();
  pending.catch(() => {
    if (built.get(key) === pending) built.delete(key);
  });
  built.set(key, pending);
  if (built.size > LIMIT) {
    const [oldest] = built.keys();
    const old = built.get(oldest);
    built.delete(oldest);
    void old.then((url) => URL.revokeObjectURL(url)).catch(() => {});
  }
  return pending;
}

/** Забыть собранных (тесты). */
export function forgetOnModel() {
  for (const pending of built.values()) void pending.then((url) => URL.revokeObjectURL(url)).catch(() => {});
  built.clear();
}

/**
 * Персонаж в вещи для окна «3D»: `{ url, status }`, `status` — `idle` (не вещь одежды или персонажа не собрать), `building`, `ready`, `failed`.
 * Собирается, только пока `enabled` (окно открыто).
 */
export function useOnModel(mod, enabled = true, colour = "") {
  const [state, setState] = useState({ url: "", status: "idle" });
  const id = mod?.id || "";
  useEffect(() => {
    if (!enabled || !mod || !onModelAvailable(mod)) {
      setState({ url: "", status: "idle" });
      return undefined;
    }
    let alive = true;
    /* Другой цвет: прежний персонаж остаётся на экране, пока собирается новый (окно не мигает), но чужим цветом не называется. */
    setState((previous) => ({ url: previous.url, status: "building" }));
    loadOnModel(mod, colour).then(
      (url) => alive && setState({ url, status: "ready" }),
      (error) => {
        /* Отказ не глотается молча (22.11.2026, пустой предпросмотр в 1.0.0): ступень «персонаж» — в журнал окна, причина с машины человека видна сразу. */
        notePreviewFailure({ stage: "Персонаж из игры не собрался", subject: mod?.name || mod?.id, error });
        if (alive) setState({ url: "", status: "failed" });
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- мод узнаётся по id
  }, [id, enabled, colour]);
  return state;
}
