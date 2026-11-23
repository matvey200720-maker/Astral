import { useEffect, useState } from "react";
import { shelfOfCategory } from "@modovik/clothing/taxonomy";
import { hasCatalogClothingModel, readCatalogClothingModel } from "../../api.js";
import { clothingOf } from "./clothing-catalog.js";
import { notePreviewFailure } from "./preview-journal.js";
import { tr } from "../../locales/ui.js";

/*
 * Вещь мода выбранным цветом (28.10.2026, владелец: «в «Установить» выбрал голубой цвет мода — превью остаётся белым»): модель витрины мода
 * (`mod.model`) нарисована первой расцветкой, а на другие её не перекрасить в окне — текстуры цветов лежат в пакете. Цветную модель собирает
 * Astral Desktop из подписанного пакета (`readCatalogClothingModel`, расцветка — буква пакета): разбор модели один на вещь, на каждый цвет —
 * только текстура, готовый GLB лежит на диске. Окно держит последние адреса: возврат к цвету — мгновенно. Нет Desktop или пакета — остаётся модель
 * витрины (первый цвет), и окно не выдаёт её за выбранный цвет.
 */
const built = new Map();
const LIMIT = 24;

const keyOf = (mod, colour) => `${mod?.id || ""}|${colour}`;

/** Слот вещи (категория) для сборки показа: перчаткам нужна пара. */
const slotOf = (mod) => {
  const block = clothingOf(mod);
  return block ? shelfOfCategory(block.category || mod?.catalogSlot || "") : "";
};

/** Цветную модель можно собрать: окно в Desktop и у мода есть буква цвета. */
export const colourModelAvailable = (mod, colour) => Boolean(colour) && Boolean(mod?.id) && hasCatalogClothingModel();

/**
 * Адрес GLB вещи мода выбранного цвета (blob:). Повтор — из памяти; не собралось — отказ (следующая попытка пробует снова).
 */
export function loadColourModel(mod, colour) {
  const key = keyOf(mod, colour);
  if (built.has(key)) return built.get(key);
  const pending = (async () => {
    const { catalogPackageOf } = await import("../../components/desktop/workshop/gun/clothing-models.js");
    const pack = await catalogPackageOf(mod);
    const result = await readCatalogClothingModel({ ...pack, slot: slotOf(mod), colour });
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

/** Забыть собранное (тесты). */
export function forgetColourModels() {
  for (const pending of built.values()) void pending.then((url) => URL.revokeObjectURL(url)).catch(() => {});
  built.clear();
}

/**
 * Подпись про выбранный цвет под моделью — одно правило для окна «3D» и окна «Установить» (замечание ревью 1.0.2, 22.11.2026: выбрал не первый цвет, а видит
 * модель первого цвета молча — против решения владельца от 28.10). `picked` — выбранный не первый цвет; `character` — адрес собранного персонажа (в окне «Установить»
 * его нет); `settled` — персонаж не собирается (пока он едет, слово о нём, не об отказе цвета); `shown` — адрес, который рисует просмотрщик.
 * Цвет собирается — «Меняю цвет…». «Показана модель без выбранного цвета» — когда цвет не собрался (и персонажа нет) или просмотрщик ушёл с подмены, вещи цвета
 * или персонажа, на витрину: пустая модель или не открылась (`onShown(true)`). Цвет готов, персонаж показан — подписи нет. `shownBy(url)` — `onShown` для этого адреса.
 */
export function useColourCaption({ tinted, picked = "", character = "", settled = true, shown = "" }) {
  const [fellUrl, setFellUrl] = useState("");
  const fellBack = Boolean(shown) && fellUrl === shown;
  const refused = (!character && tinted.status === "failed") || fellBack;
  let text = "";
  if (picked && !character && tinted.status === "building") text = tr("Меняю цвет…");
  else if (picked && settled && refused) text = tr("Показана модель без выбранного цвета");
  return { text, shownBy: (url) => (fellBack) => setFellUrl(fellBack ? url : "") };
}

/**
 * Модель выбранного цвета для просмотрщика: `{ url, status }`, `status` — `idle` (цвета нет или собрать нечем: рисуется модель витрины),
 * `building`, `ready` или `failed`. Пока цвет едет, `url` — прежний (если был): окно не мигает и не выдаёт чужой цвет за выбранный
 * (`status === "building"` — слово «Меняю цвет…» над моделью).
 */
export function useColourModel(mod, colour, enabled = true) {
  const [state, setState] = useState({ url: "", status: "idle", colour: "" });
  const id = mod?.id || "";
  useEffect(() => {
    if (!enabled || !colourModelAvailable(mod, colour)) {
      setState({ url: "", status: "idle", colour: "" });
      return undefined;
    }
    let alive = true;
    setState((previous) => ({ url: previous.url, status: "building", colour }));
    loadColourModel(mod, colour).then(
      (url) => alive && setState({ url, status: "ready", colour }),
      (error) => {
        /* Ступень «цвет» не глотается молча: причина — в журнал окна (22.11.2026). */
        notePreviewFailure({ stage: "Цвет вещи не собрался", subject: mod?.name || mod?.id, error });
        if (alive) setState({ url: "", status: "failed", colour });
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- мод узнаётся по id
  }, [id, colour, enabled]);
  return state;
}
