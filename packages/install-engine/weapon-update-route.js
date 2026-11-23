/*
 * Оружие через `update.rpf` (GTA 5 RP, 19.11.2026, `docs/RP-WEAPONS-UPDATE.md`): куда писать файл ствола, чтобы его увидела
 * игра, у которой не открыты наши пакеты (`astral_weapons` на RP не монтируется, запись в `update.rpf` видна).
 *
 * Игра берёт файл по имени у того, кто смонтирован старше всех:
 *
 *   база `x64*.rpf` (0) < корень `update.rpf` (25) < контейнер `x64/astral` (50) < пакет `dlcpacks/<пак>` (100 + order)
 *   < правка пакета `update.rpf:dlc_patch/<пак>/…` (100 + order + 0,5)
 *
 * Корень и контейнер проигрывают любому пакету, поэтому записывать надо туда, где имя выигрывает: в `dlc_patch/<победитель>/x64/models/cdimages/<вложенный
 * архив>/<имя>` (проверено игрой 19.11.2026, сюжет: `dlc_patch/mpheist4/…/weapons.rpf/w_pi_singleshoth4.ytd` показывается). Победитель, у которого в
 * `update.rpf` нет вложенного архива (штатный пакет, как `patchday8ng`), и победитель-база или корень в этом шаге не готовы: для них нужна своя проба.
 *
 * Модуль чистый: ввода-вывода нет, окружение подаёт вызывающий, победителей — перепись (`apps/desktop/src/weapon-route-census.js`) готовыми строками.
 */

export const WEAPONS_VIA_UPDATE_ENV = "ASTRAL_WEAPONS_VIA_UPDATE";
export const WEAPONS_UPDATE_TARGET = "update/update.rpf";

/** Папка внутри пака (и его правки в `update.rpf`), где игра держит архивы оружия. */
const NESTED_DIRECTORY = "x64/models/cdimages";
/** Вложенные архивы, в которые мы пишем: ствол берётся из `weapons.rpf` и (тяжёлый пистолет, `mpbusiness2`) из `dlc_weapons_patch.rpf`. */
const ALLOWED_NESTED = Object.freeze(["weapons.rpf", "dlc_weapons_patch.rpf"]);
/** Имя пака: как в `dlclist.xml`, без точек и косых черт. */
const PACK = "[a-z0-9_]+";
/** Файл оружия: `w_*` и `p_w_*`, словарь или модель, `+hi` у словаря; те же знаки, что в `manifest.js` (`direct-weapon-dlc-v1`). */
const WEAPON_LEAF = /^(?:p_)?w_[a-z0-9][a-z0-9._+~-]*\.(?:ydr|ytd)$/;
const LEAF_LIMIT = 120;

/**
 * Режим выключателя (любой регистр, пробелы по краям не в счёт): `patch` — `1`, `true`, `update`, `patch` (запись в `dlc_patch/<победитель>`);
 * `container` — контейнер слоя Astral `x64/astral/astral_rp_weapons.rpf` в `update.rpf` (20.11.2026, проба X1b первого лида: контейнер перекрывает и
 * словари, и модели `.ydr`); пусто и любое другое значение — `null` (выключено, путь прежний). Окружение подаёт вызывающий.
 */
export function weaponUpdateMode(env = {}) {
  const value = String(env?.[WEAPONS_VIA_UPDATE_ENV] ?? "").trim().toLowerCase();
  if (value === "container") return "container";
  return ["1", "true", "update", "patch"].includes(value) ? "patch" : null;
}

/** Включён ли режим (любой из двух). */
export function weaponUpdateRouteEnabled(env = {}) {
  return weaponUpdateMode(env) !== null;
}

/** Контейнер оружия в `update.rpf`. Не `astral_weapons.rpf`: такие слои `migrateLegacyWeaponLayers` (`fast-weapon-dlc.js`) тянет в хост. */
export const WEAPON_CONTAINER_ENTRY_PREFIX = "x64/astral/astral_rp_weapons.rpf/";
/** Права пакета слоя Astral в `update.rpf` (как у наборов E3/E8/E9): регистрацию контейнера в `content.xml` пишет движок. */
export const WEAPON_CONTAINER_CAPABILITIES = Object.freeze([
  "rpf-container-entry-v1",
  "astral-content-rpf-v1",
  "direct-update-rpf-v1",
  "direct-update-entries-v1",
]);

/** Ранг источника. `source`: `base`, `update` (корень), `astral` (контейнер), `pack` (штатный пакет), `patch` (`dlc_patch/<пак>`). */
export function holderRank({ source, order = 0 } = {}) {
  const step = Number(order) || 0;
  if (source === "base") return 0;
  if (source === "update") return 25;
  if (source === "astral") return 50;
  if (source === "pack") return 100 + step;
  if (source === "patch") return 100 + step + 0.5;
  throw new Error(`Неизвестный источник файла оружия: ${source}`);
}

/** Победитель имени: наибольший ранг, при ничьей — смонтированный позже (стоящий в списке позже). Пусто — `null`. */
export function winnerOf(holders) {
  let best = null;
  for (const holder of holders || []) {
    const rank = holderRank(holder);
    if (!best || rank >= best.rank) best = { ...holder, rank };
  }
  return best;
}

const nestedOf = (directory, file) => (directory === NESTED_DIRECTORY ? file : `${directory}/${file}`);

/**
 * Строка места из переписи (`censusMapTextures`, поле `at`) → `{ source, pack, nested }` или `null`. `nested` — имя вложенного архива, если он
 * лежит в `x64/models/cdimages`, иначе его путь с папками (его не допускает `routeWeaponEntries`).
 */
export function parseWinnerAt(at) {
  const text = String(at ?? "").toLowerCase().replaceAll("\\", "/");
  let match = new RegExp(`^update:dlc_patch/(${PACK})/(.+)/([^/]+\\.rpf)/[^/]+$`).exec(text);
  if (match) return { source: "patch", pack: match[1], nested: nestedOf(match[2], match[3]) };
  match = new RegExp(`^update/x64/dlcpacks/(${PACK})/dlc\\.rpf:(.+)/([^/]+\\.rpf)/[^/]+$`).exec(text);
  if (match) return { source: "pack", pack: match[1], nested: nestedOf(match[2], match[3]) };
  match = new RegExp(`^x64w\\.rpf:dlcpacks/(${PACK})/dlc\\.rpf/(.+)/([^/]+\\.rpf)/[^/]+$`).exec(text);
  if (match) return { source: "pack", pack: match[1], nested: nestedOf(match[2], match[3]) };
  if (/^update:x64\/astral\//.test(text)) return { source: "astral" };
  match = /^update:x64\/models\/cdimages\/(weapons\.rpf)\/[^/]+$/.exec(text);
  if (match) return { source: "update", nested: match[1] };
  if (/^update:/.test(text)) return { source: "update" };
  match = /^(x64[a-z]\.rpf):(.+)\/([^/]+\.rpf)\/[^/]+$/.exec(text);
  if (match) return { source: "base", archive: match[1], directory: match[2], nested: match[3] };
  if (/^x64[a-z]\.rpf:/.test(text)) return { source: "base" };
  return null;
}

/** Допустимо ли имя файла оружия для записи (строчные, без папок и «..», `.ydr`/`.ytd`). */
export const isWeaponLeaf = (name) =>
  typeof name === "string" && name.length <= LEAF_LIMIT && !name.includes("..") && WEAPON_LEAF.test(name);
const validLeaf = isWeaponLeaf;

/** Семья имени: без `+hi` и `_hi` перед расширением (`w_at_x_hi.ydr` → `w_at_x.ydr`), иначе `null`. */
function familyOf(name) {
  const dot = name.lastIndexOf(".");
  const stem = name.slice(0, dot);
  const extension = name.slice(dot);
  if (stem.endsWith("+hi")) return `${stem.slice(0, -3)}${extension}`;
  if (stem.endsWith("_hi")) return `${stem.slice(0, -3)}${extension}`;
  return null;
}

function routeOfWinner(name, winner) {
  const parsed = parseWinnerAt(winner?.at);
  if (!parsed) return { name, kind: "refused", ready: false, reason: "bad-winner" };
  const rank = Number.isFinite(winner.rank) ? winner.rank : null;
  if (parsed.source === "patch" || parsed.source === "pack") {
    if (!ALLOWED_NESTED.includes(parsed.nested)) return { name, kind: "refused", ready: false, reason: "nested-not-allowed" };
    if (parsed.source === "pack") {
      return { name, kind: "pack", ready: false, reason: "pack-winner", pack: parsed.pack, nested: parsed.nested, rank };
    }
    return {
      name,
      kind: "patch",
      ready: true,
      pack: parsed.pack,
      nested: parsed.nested,
      target: WEAPONS_UPDATE_TARGET,
      entry: `dlc_patch/${parsed.pack}/${NESTED_DIRECTORY}/${parsed.nested}/${name}`,
      rank,
    };
  }
  if (parsed.source === "astral") return { name, kind: "refused", ready: false, reason: "container-winner" };
  if (parsed.source === "update") {
    /* Копия weapons.rpf в корне update.rpf уже есть (её положили раньше): запись идёт в неё, как в dlc_patch. */
    if (parsed.nested !== "weapons.rpf") return { name, kind: "refused", ready: false, reason: "nested-not-allowed" };
    return { name, kind: "root", ready: true, target: WEAPONS_UPDATE_TARGET, entry: `${NESTED_DIRECTORY}/weapons.rpf/${name}`, rank };
  }
  /* Победитель — база: игра берёт файл из x64e.rpf. Рабочий путь (проба E6, 19.11.2026, сюжет): копия всего базового weapons.rpf (96,3 МиБ)
     вставляется в корень update.rpf одной записью, наша запись — внутри копии. Сборку копии штатный установщик не умеет
     (`rpf-preflight-missing`), её писать отдельно (`composeRpfArchive`): здесь только план. */
  if (parsed.source === "base" && parsed.nested === "weapons.rpf" && parsed.directory === "models/cdimages") {
    return {
      name,
      kind: "root-nested",
      ready: false,
      reason: "needs-nested-archive-build",
      target: WEAPONS_UPDATE_TARGET,
      entry: `${NESTED_DIRECTORY}/weapons.rpf/${name}`,
      plan: { copyOf: `${parsed.archive}:${parsed.directory}/${parsed.nested}`, insertAs: `${NESTED_DIRECTORY}/weapons.rpf`, approxMiB: 96.3 },
      rank,
    };
  }
  return { name, kind: "refused", ready: false, reason: "nested-not-allowed" };
}

/**
 * Маршрут для каждого имени (в порядке `names`). `winners` — `Map` или объект «имя → `{ at, rank }`» (`null` или нет записи — имени нет ни у кого).
 * Ответ — массив:
 *  - `patch`: `ready: true`, запись в `update.rpf` (`target`, `entry`) во вложенный архив `dlc_patch/<пак>`;
 *  - `pack`: победитель — штатный пакет, `ready: false` (`reason: "pack-winner"`);
 *  - `root`: победитель — корень update.rpf с готовой копией weapons.rpf, `ready: true`, запись в неё;
 *  - `root-nested`: победитель — база, `ready: false` (`needs-nested-archive-build`), `plan` — копия базового weapons.rpf в корень (путь E6, сборка не написана);
 *  - `refused`: `bad-name`, `duplicate`, `bad-winner`, `nested-not-allowed`, `container-winner`, `no-family`.
 * Имя, которого нет ни у кого (новая модель), идёт за пакетом своей семьи (`<имя>` без `_hi` или `+hi`) — `via: "family"`.
 */
export function routeWeaponEntries({ names = [], winners = new Map() } = {}) {
  const lookup = (name) => (winners instanceof Map ? winners.get(name) : winners?.[name]);
  const seen = new Set();
  const first = names.map((name) => {
    if (!validLeaf(name)) return { name, kind: "refused", ready: false, reason: "bad-name" };
    if (seen.has(name)) return { name, kind: "refused", ready: false, reason: "duplicate" };
    seen.add(name);
    const winner = lookup(name);
    return winner ? routeOfWinner(name, winner) : null;
  });
  const byName = new Map(first.filter(Boolean).map((route) => [route.name, route]));
  return first.map((route, index) => {
    if (route) return route;
    const name = names[index];
    const family = familyOf(name);
    /* Семья — среди маршрутов запроса или среди победителей переписи: базовая модель может не входить в запрос. */
    const known = family ? lookup(family) : null;
    const sibling = family ? byName.get(family) || (known ? routeOfWinner(family, known) : null) : null;
    if (!sibling || !["patch", "pack"].includes(sibling.kind)) return { name, kind: "refused", ready: false, reason: "no-family" };
    const next = { ...sibling, name, via: "family" };
    if (sibling.kind === "patch") next.entry = `dlc_patch/${sibling.pack}/${NESTED_DIRECTORY}/${sibling.nested}/${name}`;
    return next;
  });
}

/** Пакет-хост оружия и папка его потока: куда сегодня ложатся записи ганпака (`fast-weapon-dlc.js`). */
export const WEAPON_HOST_TARGET = "update/x64/dlcpacks/astral_weapons/dlc.rpf";
export const WEAPON_HOST_PREFIX = "astral_stream.rpf/";

/**
 * Перевод файлов пакета оружия по маршруту (`routes` — ответ `routeWeaponEntries` на имена файлов хоста). Готовые (`patch`, `root`) уходят в `update.rpf`
 * (`replace` у победителя, `import` у нового имени), остальные остаются в хосте с причиной. Маска (`delete`) не переводится никогда: удаление в штатном
 * вложенном архиве стёрло бы штатную запись, и весь пакет остаётся в хосте. Исходные файлы не меняются; чужие файлы пакета (не из хоста) идут как есть.
 * Ответ: `{ files, moved, kept: [{ name, reason }], all }`; `all` — все файлы хоста переведены.
 */
export function translateWeaponFiles({ files = [], routes = [] } = {}) {
  const byName = new Map(routes.map((route) => [route.name, route]));
  const isHost = (file) => file?.target === WEAPON_HOST_TARGET && String(file.entry || "").startsWith(WEAPON_HOST_PREFIX);
  const leafOf = (file) => String(file.entry).slice(WEAPON_HOST_PREFIX.length);
  const hostFiles = files.filter(isHost);
  if (hostFiles.some((file) => file.action === "delete")) {
    return { files, moved: 0, kept: hostFiles.map((file) => ({ name: leafOf(file), reason: "delete-mask" })), all: false };
  }
  let moved = 0;
  const kept = [];
  const next = files.map((file) => {
    if (!isHost(file)) return file;
    const name = leafOf(file);
    const route = byName.get(name);
    if (route?.ready && (route.kind === "patch" || route.kind === "root")) {
      moved += 1;
      return { ...file, target: route.target, entry: route.entry, action: route.via === "family" ? "import" : "replace" };
    }
    kept.push({ name, reason: route ? route.reason || route.kind : "no-route" });
    return file;
  });
  return { files: next, moved, kept, all: moved > 0 && kept.length === 0 };
}

/**
 * Перевод файлов пакета оружия в контейнер `x64/astral/astral_rp_weapons.rpf` внутри `update.rpf` (режим `container`): по имени, без победителя и
 * переписи. Файлы хоста (`astral_stream.rpf/<имя>`) → `import` в контейнер (`astral-content-rpf-v1` принимает только его). Имя, которое не годится для
 * записи (не `w_*` / `p_w_*`, не `.ydr`/`.ytd`), остаётся в хосте с причиной `bad-name`. Маска (`delete`) в контейнере не нужна: записи, которой не
 * положили, там нет, а прежний скин той же модели снимает замена слота; маска из пакета выбрасывается. Чужие файлы пакета идут как есть.
 * Ответ: `{ files, moved, dropped, kept: [{ name, reason }], all }`; `all` — в хосте не осталось ничего, а в контейнер что-то легло.
 */
export function translateWeaponFilesToContainer({ files = [] } = {}) {
  const isHost = (file) => file?.target === WEAPON_HOST_TARGET && String(file.entry || "").startsWith(WEAPON_HOST_PREFIX);
  const leafOf = (file) => String(file.entry).slice(WEAPON_HOST_PREFIX.length);
  const seen = new Set();
  let moved = 0;
  let dropped = 0;
  const kept = [];
  const next = [];
  for (const file of files) {
    if (!isHost(file)) {
      next.push(file);
      continue;
    }
    const name = leafOf(file);
    if (file.action === "delete") {
      dropped += 1;
      continue;
    }
    if (!isContainerLeaf(name) || seen.has(name)) {
      kept.push({ name, reason: isContainerLeaf(name) ? "duplicate" : "bad-name" });
      next.push(file);
      continue;
    }
    seen.add(name);
    moved += 1;
    next.push({ ...file, target: WEAPONS_UPDATE_TARGET, entry: `${WEAPON_CONTAINER_ENTRY_PREFIX}${name}`, action: "import" });
  }
  return { files: next, moved, dropped, kept, all: moved > 0 && kept.length === 0 };
}

/**
 * Можно ли положить это имя в контейнер (и для ответа «нужен ли хост» до скачивания). Шире `isWeaponLeaf`: победителя искать не нужно, имя не обязано
 * начинаться с `w_` — манифест ганпака (`direct-weapon-dlc-v1`) и форма записи контейнера (`x64/astral/*.rpf/<строчное имя>`) разрешают любое строчное
 * `.ydr`/`.ytd`. Прописные буквы остаются в хосте: контейнер слоя принимает только строчные имена.
 */
const CONTAINER_LEAF = /^[a-z0-9][a-z0-9._+~-]{0,119}\.(?:ydr|ytd)$/;
export const isContainerLeaf = (name) => typeof name === "string" && !name.includes("..") && CONTAINER_LEAF.test(name);
