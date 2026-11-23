/*
 * То, что Главная берёт из окна без новых хранилищ: когда поставлен каждый мод (запись установки движка), последние
 * черновики студий оружия и одежды (`gun-draft-store.js`) и два действия — «Установить» и «Продолжить» в студии.
 * Тяжёлые соседи грузятся по требованию, каждый своим куском: Главная в стартовом куске окна, и тянуть мастерскую
 * ради двух карточек на старте нельзя.
 */
import { getLocalInstallProfile } from "../../api.js";
import { catalogModId } from "../library/engine-ids.js";

// Недоступный ответ — не поломка: карточка «Продолжить» просто не появится.
const attempt = async (job, otherwise) => {
  try {
    return await job();
  } catch {
    return otherwise;
  }
};

/** Когда поставлен каждый мод: id каталога → ISO-время записи установки. Записей с временем нет — пустая карта. */
export async function readInstallTimes() {
  const profile = await attempt(() => getLocalInstallProfile(), null);
  const times = new Map();
  for (const record of Array.isArray(profile?.installed)
    ? profile.installed
    : []) {
    const at = Date.parse(record?.installedAt || "");
    if (!record?.modId || !Number.isFinite(at)) continue;
    const id = catalogModId(record.modId);
    if (!(times.get(id) >= at)) times.set(id, at);
  }
  return new Map(
    [...times].map(([id, at]) => [id, new Date(at).toISOString()]),
  );
}

// Свежая запись таблицы черновиков: {slot, at, name}.
function newest(table) {
  const rows = Object.entries(table && typeof table === "object" ? table : {})
    .map(([slot, entry]) => ({
      slot,
      at: String(entry?.updatedAt || ""),
      name: String(entry?.project?.name || "").trim(),
    }))
    .filter((row) => Number.isFinite(Date.parse(row.at)));
  rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return rows[0] || null;
}

/** Последние черновики студий: `{ gun, clothing }`, у каждого `{ slot, at, name }` или `null`. */
export async function readStudioDrafts(storage = globalThis.localStorage) {
  return attempt(
    async () => {
      const store = await import("../workshop/works/gun-draft-store.js");
      const clothing = newest(
        store.readGunDraftEntries(storage, store.CLOTHING_DRAFTS_KEY),
      );
      return {
        gun: newest(store.readGunDraftEntries(storage, store.GUN_DRAFTS_KEY)),
        clothing: clothing && {
          ...clothing,
          ...store.draftOwner(clothing.slot),
        },
      };
    },
    { gun: null, clothing: null },
  );
}

/**
 * «Установить» на Главной. Простой мод ставится сразу — тем же путём, что кнопка каталога (`onInstall` оболочки сама
 * разбирается с «нет игры», сборками и наборами). Вещь одежды сперва спрашивает «на что поставить», а окно выбора живёт
 * на странице мода, поэтому её ведём туда. Без `onInstall` (окно без оболочки) — тоже страница мода.
 */
export async function installFromHome(mod, { onInstall, onSelect }) {
  if (!onInstall) return onSelect?.(mod);
  const { clothingInstallKind } =
    await import("@modovik/clothing/install-kind");
  if (clothingInstallKind(mod)) return onSelect?.(mod);
  return onInstall(mod);
}

/** «Продолжить» черновик: открыть его студию в мастерской. Студия не открылась — просто мастерская. */
export async function continueStudio(
  { section, slot },
  { language, onNavigate },
) {
  await attempt(async () => {
    const editors = await import("../workshop/useWorkshopEditors.jsx");
    editors.presetWorkshopEditor(
      { section, slotId: slot, catalog: [] },
      { locale: language },
    );
  });
  onNavigate?.("workshop");
}
