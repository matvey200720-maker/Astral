/*
 * Строки журнала про установку одежды (13.11.2026): куда легла вещь — архив игры, путь записи, ped/компонент/номер.
 *
 * Разбор жалобы «выставил все заменёнки, захожу в игру — ничего не меняется» упёрся в журнал: «workshop-apply-clothing-skin: готово · Rust: probe-rpf, compose-rpf» не говорит, в какой
 * архив писали и увидит ли его клиент сервера (Majestic монтирует только DLC из белого списка, `astral_clothing` в нём нет). Теперь после установки пишется одна строка на пакет и,
 * когда запись уехала туда, где клиент сервера её не прочтёт, — предупреждение. Журнал — для поддержки, как остальные строки `[install]`, по-русски; в окне эти строки не показываются.
 *
 * Чистый модуль: манифест пакета (`files[].target`, `files[].entry`) → строки `{ level, message }`; диска и журнала он не трогает.
 */

const ASTRAL_CLOTHING_DLC = "update/x64/dlcpacks/astral_clothing/dlc.rpf";
const PART = /^((?:p_)?[a-z]{3,5})_(?:diff_)?([0-9]{3})(?:_|\.)/;

/** `x64/levels/gta5/astral_pack.rpf/<папка>/<файл>` → `{ inner, folder, file }`; запись без папки — `null`. */
function splitEntry(entry) {
  const parts = String(entry || "")
    .split("/")
    .filter(Boolean);
  if (parts.length < 3) return null;
  return {
    inner: parts.slice(0, -2).join("/"),
    folder: parts.at(-2),
    file: parts.at(-1),
  };
}

/**
 * @param {{ id?: string, slots?: string[], files?: Array<{ target?: string, entry?: string, action?: string }> }} manifest
 * @param {{ server?: string, kind?: string }} [options] `server` — проект, на который ставили («majestic», «gta5rp»); `kind` — «Покраска» / «Замена» для начала строки
 * @returns {Array<{ level: "info"|"warn", message: string }>}
 */
export function clothingWriteNotes(
  manifest,
  { server = "", kind = "Одежда" } = {},
) {
  const notes = [];
  const byTarget = new Map();
  for (const file of manifest?.files || []) {
    const place = splitEntry(file.entry);
    if (!file.target || !place) continue;
    const list = byTarget.get(file.target) || [];
    list.push({ ...place, action: file.action || "import" });
    byTarget.set(file.target, list);
  }
  for (const [archive, files] of byTarget) {
    const { inner, folder } = files[0];
    const models = files.filter((file) => file.file.endsWith(".ydd")).length;
    const textures = files.filter((file) => file.file.endsWith(".ytd")).length;
    const named = files.map((file) => PART.exec(file.file)).find(Boolean);
    const item = named ? `${named[1]} ${Number(named[2])}` : "вещь";
    const actions = [...new Set(files.map((file) => file.action))].join("/");
    const where = `${archive} → ${inner}/${folder}`;
    notes.push({
      level: "info",
      message: `${kind}: записано в ${where}: ${item}, ${actions}, моделей ${models}, расцветок ${textures}${server ? `, сервер ${server}` : ""}${manifest?.id ? `, пакет ${manifest.id}` : ""}`,
    });
    if (archive === ASTRAL_CLOTHING_DLC && server === "majestic")
      notes.push({
        level: "warn",
        message: `${kind}: запись в Astral Clothing DLC, а клиент Majestic монтирует только DLC из белого списка — на Majestic вещь «${item}» не изменится (${where})`,
      });
  }
  return notes;
}

/** Покраска вещи игры без цели на сервере (`applyClothingSkin`) всегда пишется в Astral Clothing DLC, который клиент Majestic не монтирует. */
export function clothingSkinNotes(manifest) {
  const notes = clothingWriteNotes(manifest, { kind: "Покраска вещи игры" });
  notes.push({
    level: "info",
    message:
      "Покраска вещи игры: ложится в Astral Clothing DLC; клиент Majestic его не монтирует — для Majestic красьте на вещь сервера («На что поставить?»)",
  });
  return notes;
}
