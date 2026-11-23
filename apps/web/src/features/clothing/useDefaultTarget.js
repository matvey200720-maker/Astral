/*
 * Цель по умолчанию в окне (TASK-targets-5, 14.11.2026): у вещи проекта — карточки `addon` без заданной автором цели — есть штатная вещь, на которую «Установить» ставит сразу
 * («я выбрал, устанавливаю, у меня ногти устанавливаются на ногти, то есть на дефолтные просто»). Правило, список и причины «цели нет» — `@modovik/clothing/default-targets`;
 * здесь — подготовка данных окна: вещи игры, белые паки, занятые слоты. Тяжёлый модуль со списком (19 КБ) грузится лениво, на первом вопросе.
 *
 * Не по умолчанию (остаётся прежний выбор «На что поставить?»): заменёнка автора с заданной целью («Заменяет», `authorTargets`), у мода файлы по проектам (`projectTargets`),
 * вид установки не «одна вещь» (комплект, перекраска, тату, набор мест), не знаем пол вещи, и модель бороды — штатные бороды игры наложения на лицо, а не модели
 * (`beard`: слова, цели по умолчанию нет).
 */

import { useEffect, useMemo, useState } from "react";
import { looksLikeBeard } from "@modovik/clothing/beard";
import { garmentKindOf } from "@modovik/clothing/garment-kinds";
import { clothingInstallKind } from "@modovik/clothing/install-kind";
import { clothingSectionOf } from "../catalog/clothing-sections.js";
import { clothingOf } from "./clothing-catalog.js";
import { authorTargets, wearOf } from "./clothing-targets.js";
import { genderOfMod, genderTwin, twinItem } from "./gender-twin.js";
import { hasProjectFiles, projectTargets } from "./project-targets.js";
import { itemColours, modColoursOf } from "./colour-mapping.js";
import {
  gameItemsOf,
  majesticLocalOf,
  mergeAssortmentCached,
} from "./assortment-cache.js";
import { occupantOf, useOccupiedClothingState } from "./clothing-occupied.js";
import { useGameRows } from "./useGameClothing.js";
import { useUiLanguage } from "../../locales/ui.js";

const NO_TAGS = Object.freeze([]);
const OFF = Object.freeze({
  state: "off",
  target: null,
  answer: null,
  beard: false,
});

/** Виды установки, где человек выбирает «одну вещь на замену» — только им нужна цель по умолчанию. */
const ONE_ITEM = new Set(["pick", "gloves"]);

/**
 * Нужна ли карточке цель по умолчанию и по каким данным её искать: `{ wear, kind, beard }` или `null`. Чистая функция — для окна и для теста.
 * `wear` — `{ gender, component, prop }`; `kind` — крой по названию и тегам (как в окне выбора); `beard` — вещь называется бородой или усами.
 */
export function defaultTargetWanted(mod) {
  if (!mod || !ONE_ITEM.has(clothingInstallKind(mod))) return null;
  const block = clothingOf(mod);
  if (!block?.component) return null;
  /* Авторская заменёнка (`origin: "replace"`) без заданной цели прежде всегда спрашивала, на что ставить: цель по умолчанию — для вещи проекта (`addon`), как сказано в задаче (ревью 14.11, №14). */
  if (block.origin === "replace") return null;
  /* Ногти (`domain.clothing.subkind = "nails"`, слот «Руки и перчатки», настоящие карточки GTA 5 RP 16.11.2026): штатной вещи-ногтей в игре нет, а запасной список `uppr` — перчатки («Черные с защитой»): они встали бы под ногти
     первой плиткой и выбранными. Предложения нет — окно открывается пустым на вкладке с руками и перчатками игры (безымянные голые руки в списке не показываются, `selectable`), человек выбирает сам. */
  if (clothingSectionOf(mod) === "nails") return null;
  /* Автор назвал, на что ставить, или у мода файлы по проектам — как раньше. */
  if (authorTargets(mod).length || hasProjectFiles(projectTargets(mod)))
    return null;
  const base = wearOf(mod);
  const gender = genderOfMod(mod);
  if (!base || !gender) return null;
  const tags = Array.isArray(mod.tags) ? mod.tags : NO_TAGS;
  const kind =
    block.garment ||
    garmentKindOf({ component: base.component, names: [mod.name, ...tags] });
  return {
    wear: { ...base, gender },
    kind: kind || null,
    /* Борода — по подвиду карточки (`domain.clothing.subkind = "beard"` или тег «борода», `clothingSectionOf`: так её находит и каталог) или по названию. */
    beard:
      base.component === "berd" &&
      (clothingSectionOf(mod) === "beards" || looksLikeBeard(mod.name, tags)),
  };
}

let module_ = null;
const loadPicker = () =>
  (module_ ||= import("@modovik/clothing/default-targets"));

/**
 * Цель по умолчанию для карточки. `state`: `off` (не нужна), `loading` (данные игры и список грузятся), `ready` (цель есть: `target` — вещь ассортимента, `answer` — как выбрана, что пропущено),
 * `none` (цели нет: `answer.why` — `no-list` | `unread` | `none`), `beard` (модель бороды: цели нет, штатных бород-моделей в игре нет).
 * Поля готовой цели: `modColours` / `itemColours` — сколько расцветок у заменёнки и у вещи (режим «сразу» кладёт расцветки мода на цвета вещи по порядку, недостающие — первой); `partner` — парная вещь другого
 * пола (`{ item, occupant }`), если у мода есть вариант для другого пола: она тоже встанет, и занята ли она, видно до нажатия (ревью 14.11, №6, №7).
 * `catalog` — карточки каталога (для парного мода), `version` — ключ перечитывания занятости: у страницы вещи он меняется при установке и снятии (№5).
 */
export function useDefaultTarget(mod, catalog = NO_TAGS, version = "") {
  const [picker, setPicker] = useState(null);
  const wanted = useMemo(() => defaultTargetWanted(mod), [mod]);
  const language = useUiLanguage();
  const gameRows = useGameRows(Boolean(wanted));
  /* Записи установки читаются, только когда карточке нужна цель по умолчанию: страница мода не одежды за профилем не ходит. */
  const { occupied, ready: occupiedReady } = useOccupiedClothingState(
    "",
    version,
    Boolean(wanted),
  );
  const colours = useMemo(
    () => (wanted ? modColoursOf(mod, language).length : 0),
    [wanted, mod, language],
  );
  /* Вариант мода для другого пола: его расцветки и пол; парная вещь ищется только если у него есть расцветки (как в окне выбора). */
  const twin = useMemo(
    () => (wanted && catalog.length ? genderTwin(mod, catalog) : null),
    [wanted, mod, catalog],
  );
  const twinColours = useMemo(
    () => (twin ? modColoursOf(twin, language).length : 0),
    [twin, language],
  );

  useEffect(() => {
    if (!wanted || picker) return undefined;
    let alive = true;
    loadPicker().then((loaded) => {
      if (alive) setPicker(loaded);
    });
    return () => {
      alive = false;
    };
  }, [wanted, picker]);

  return useMemo(() => {
    if (!wanted || !picker) return wanted ? { ...OFF, state: "loading" } : OFF;
    if (wanted.beard) return { ...OFF, state: "beard", beard: true };
    if (!gameRows.ready || !occupiedReady) return { ...OFF, state: "loading" };
    const rows = gameRows.rows;
    const items = rows
      ? mergeAssortmentCached(
          gameItemsOf(rows, wanted.wear.gender, wanted.wear.component),
        )
      : [];
    const answer = picker.pickDefaultTarget({
      gender: wanted.wear.gender,
      component: wanted.wear.component,
      kind: wanted.kind,
      items,
      local: rows ? majesticLocalOf(rows) : null,
      colours,
      occupantOf: (item) => occupantOf(occupied, item, ""),
    });
    if (answer.item) {
      let partner = null;
      const twinGender = twin && twinColours > 0 ? genderOfMod(twin) : null;
      if (twinGender && twinGender !== wanted.wear.gender && rows) {
        const found = twinItem(
          answer.item,
          mergeAssortmentCached(
            gameItemsOf(rows, twinGender, wanted.wear.component),
          ),
        );
        if (found)
          partner = {
            item: found,
            occupant: occupantOf(occupied, found, "") || null,
          };
      }
      return {
        state: "ready",
        target: answer.item,
        answer,
        beard: false,
        wear: wanted.wear,
        kind: wanted.kind,
        modColours: colours,
        itemColours: itemColours(answer.item.textures).length,
        partner,
      };
    }
    return {
      state: "none",
      target: null,
      answer,
      beard: false,
      wear: wanted.wear,
      kind: wanted.kind,
    };
  }, [
    wanted,
    picker,
    gameRows,
    colours,
    occupied,
    occupiedReady,
    twin,
    twinColours,
  ]);
}
