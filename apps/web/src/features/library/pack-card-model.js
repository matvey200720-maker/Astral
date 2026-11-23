/*
 * Карточка ганпака в библиотеке v2 (14.11.2026): чистая модель — размер модели в руках и «убрать один ствол».
 *
 * Размер: пределы 50–200 % (как в студии: `MODEL_SCALE` в `@modovik/rage-drawable/model-adjust.js`), шаги 80–120 % и «Свой размер…», 100 % — «как в игре». Выбранный размер хранится в окне
 * по моду пака (`astral.library.pack-size.v1`): запись установки движка (`local-gunpack-*`) называется другим id, а карточке нужно показать то, что человек применил.
 *
 * Один ствол из каталожного пака: пак — один подписанный пакет со всеми стволами, у каждого ствола свой пакет. Поэтому «убрать ствол» — это снять пак и поставить пакеты остальных стволов.
 * Какие именно, считает `packWithoutGun`.
 */

export const SIZE_MIN = 50;
export const SIZE_MAX = 200;
export const SIZE_STEPS = Object.freeze([80, 90, 100, 110, 120]);
export const SIZE_KEY = "astral.library.pack-size.v1";

export const clampSize = (value) => {
  const number = Math.round(Number(value));
  return Number.isFinite(number)
    ? Math.min(SIZE_MAX, Math.max(SIZE_MIN, number))
    : 100;
};

/** Размер в запросе установки (`modelScale`, доля единицы): 110 % → 1,1; 100 % → не передаётся. */
export const modelScaleOf = (percent) => {
  const size = clampSize(percent);
  return size === 100 ? undefined : size / 100;
};

function readTable(storage) {
  try {
    const table = JSON.parse(storage?.getItem(SIZE_KEY) || "null");
    return table && typeof table === "object" && !Array.isArray(table)
      ? table
      : {};
  } catch {
    return {};
  }
}

/** Размер, применённый к паку (процент); нет записи — 100. */
export function appliedSize(packModId, storage = globalThis.localStorage) {
  const value = Number(readTable(storage)[packModId]);
  return Number.isFinite(value) ? clampSize(value) : 100;
}

/** Запоминает применённый размер; 100 % стирает запись. */
export function rememberSize(
  packModId,
  percent,
  storage = globalThis.localStorage,
) {
  const table = readTable(storage);
  const size = clampSize(percent);
  if (size === 100) delete table[packModId];
  else table[packModId] = size;
  try {
    storage?.setItem(SIZE_KEY, JSON.stringify(table));
  } catch {
    /* хранилища нет — размер живёт до закрытия окна в карточке */
  }
  return size;
}

/** Стволы пака (моды-части из каталога) в порядке состава. */
export function packGuns(pack, mods = []) {
  const byId = new Map(mods.map((mod) => [mod.id, mod]));
  return (pack?.includedModIds || []).map((id) => byId.get(id)).filter(Boolean);
}

/**
 * Что сделать, чтобы убрать ствол из установленного каталожного пака.
 * @returns {{ remove: string[], install: object[] }} `remove` — id пака (снимается целиком), `install` — моды оставшихся стволов (ставятся своими пакетами); пусто — стволов не остаётся, пак просто снимается
 */
export function packWithoutGun(pack, gun, mods = []) {
  const guns = packGuns(pack, mods);
  if (!guns.some((item) => item.id === gun?.id))
    throw new Error("Этого ствола в паке нет.");
  return {
    remove: [pack.id],
    install: guns.filter((item) => item.id !== gun.id),
  };
}
