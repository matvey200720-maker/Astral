/*
 * «Бороды игры» в окне «На что поставить?» (Ц3в, решение общей ведущей 16.11.2026; договор окна с Desktop — `NOTE-game-beards-api-1611.md`, API — `api.js`: `listGameBeards`, `readGameBeardPicture`, `bakeGameBeard`,
 * `applyGameBeard`). Штатные бороды цирюльника — не модели, а наложения на лицо: модель бороды ложится в них плоским рисунком (в игре не проверено).
 *
 * Окно показывает их плитками в разделе «Маска» под чипами «Бороды» и «Усы» (по виду листа) только у моделей бороды и усов на вкладке «GTA». Плитка — штатный номер 1…29 (hipster не цель:
 * `target: false`), выбор сохраняется как у остальных целей, но цель несёт `kind: "game-beard"` (без картинок и листа: лист Desktop пересчитывает при установке).
 *
 * Модуль без зависимостей от окна: правила, форма вещи-цели и цели установки; загрузку и картинки ведёт `useGameBeards.js`.
 */

export const GAME_BEARD_KIND = "game-beard";

/** Вещь окна для штатной бороды `beard` (запись `listGameBeards`); `title` — подпись на языке окна, `preview` — адрес картинки листа (пусто, пока едет). */
export function gameBeardItem(beard, { title, preview = "" } = {}) {
  return {
    key: beard.key,
    kind: GAME_BEARD_KIND,
    /* Раздел «Маска»: чип лежит в нём; номера `drawable` и папки нет — ни снимка вещи, ни кода `berd_NNN` у плитки не будет. */
    component: "berd",
    name: title || beard.title,
    shop: "GTA V",
    textures: 1,
    index: beard.index,
    number: beard.number,
    beardName: beard.name,
    shape: beard.shape || "",
    shapeDisputed: Boolean(beard.shapeDisputed),
    preview,
  };
}

/** Это вещь-цель «борода игры». */
export const isGameBeardItem = (item) => item?.kind === GAME_BEARD_KIND;

/** Цель установки в `clothingChoice` (договор Б0): без картинок и листа. */
export const gameBeardTarget = (item) => ({
  kind: GAME_BEARD_KIND,
  key: item.key,
  index: item.index,
  number: item.number,
  name: item.name,
});

/** Целью можно показывать только то, что Desktop разрешил (`target`), и только номера с листом. */
export const gameBeardTargets = (beards) =>
  (beards || []).filter(
    (beard) => beard?.target && beard.key && Number.isInteger(beard.index),
  );

/** Есть ли среди номеров усы (чип называется «Бороды и усы игры»). */
export const hasGameMoustaches = (beards) =>
  gameBeardTargets(beards).some((beard) => beard.shape === "moustache");

/**
 * Нужны ли штатные бороды этому моду (решение общей ведущей): у моделей бороды — всегда, если Desktop отдал номера; у моделей усов — только когда среди штатных номеров усы есть. `kind` — что за мод
 * (`"beard"` | `"moustache"` | иное: маска и прочее — не нужны); `wear` — вид мода окна `{ component }`. Кто борода, а кто усы, решает окно: подвид карточки, данные разбора и название (`beardKindOf`).
 */
export function wantsGameBeards(kind, wear, beards) {
  if (wear?.component !== "berd" || !gameBeardTargets(beards).length)
    return false;
  if (kind === "moustache") return hasGameMoustaches(beards);
  return kind === "beard";
}

/**
 * Состояние окна с вещами-целями «бороды игры»: те же поля, что у `useClothingTargets`, плюс вещи бород в общем списке и в отдельной полке; выбор бороды (`key`) главнее выбора вещи сервера, пока человек не нажмёт
 * вещь сервера (тогда выбор бороды снимается). Во время поиска состояние как есть: бороды в поиск не входят.
 */
export function withGameBeards(state, { items, key, select }) {
  if (!items?.length || state.searching) return state;
  const picked = key ? items.find((item) => item.key === key) || null : null;
  const group = { key: "game-beards", title: "Бороды игры", items, open: true };
  return {
    ...state,
    items: [...state.items, ...items],
    groups: [...state.groups, group],
    chosen: picked ? [picked] : state.chosen,
    isChosen: (itemKey) =>
      picked ? itemKey === picked.key : state.isChosen(itemKey),
    takenOf: (item) =>
      isGameBeardItem(item) ? null : state.takenOf?.(item) || null,
    /* Вещь-борода выбирается своим ключом; вещь сервера снимает выбор бороды и выбирается как обычно (уже выбранную не снимает вторым нажатием). */
    toggle: (itemKey) => {
      const beard = items.find((item) => item.key === itemKey);
      if (beard) {
        select(beard.key === key ? null : beard.key);
        return;
      }
      if (picked) {
        select(null);
        if (!state.isChosen(itemKey)) state.toggle(itemKey);
        return;
      }
      state.toggle(itemKey);
    },
    blocked: picked ? false : state.blocked,
    replace: picked ? [] : state.replace,
  };
}
