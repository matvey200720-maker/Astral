/*
 * Основа редукса (владелец 12.11.2026: «Вообще все файлы должны быть один в один»; первое ТЗ: чему нет раздела в каталоге — остаётся в самом редуксе и ставится
 * вместе с ним, карточкой в каталог не идёт).
 *
 * Разбор (`analyzeAnatomy`) раскладывает файлы автора по компонентам, а остаток называет поимённо: «не названо в проекте» (`skipped.unverified`), «не разобрано»
 * (`unresolved`) и файлы компонентов без способа установки (`reported` с `noInstall`: настройки эффектов вне штатных путей, банки звуков не оружия). До 13.11.2026
 * этот остаток не ставился вовсе — у ALLIANCE V3 так пропадали 274 дорожных узла `paths.rpf`, две меты и пять `.ymt` эффектов. Здесь он становится ОДНИМ служебным
 * пакетом редукса — теми же путями, что у автора, байт в байт.
 *
 * Что идёт в основу:
 *   • файл, которого в чистом `update.rpf` нет (свой файл автора: `common/data/vehicle_camry7.meta`, `hatemods/hatemods.ymt`, настройки эффектов вне штатного
 *     пути) — всегда: штатного под ним нет, испортить игре нечего;
 *   • файл по пути, который в чистом `update.rpf` есть (узлы дорог `x64/levels/gta5/paths.rpf/nodes*.ynd`, интерфейс, метаданные), — только когда редукс собран
 *     на той же версии игры, что и чистая копия разбора (`sameBuild`). Тогда отличие от штатного — правка автора. На другой версии отличить правку автора от
 *     штатного файла его версии нельзя, а целый файл прежней версии поверх новой игры её ломает — так же задание после обновления игры снимает с выдачи записи
 *     «целым файлом» (`scripts/redux-post/after-update-core.js`). Такой файл в основу не идёт и называется с причиной.
 *
 * Чего в основе не бывает (называется с причиной, `REST_NEVER`): опознавательный файл `update.rpf` и правила оружия, боя и ИИ целым файлом — по штатным путям.
 *
 * Как ложится:
 *   • файл вне архивов и файл внутри штатного архива игры — записью `update.rpf` по своему пути (`upsert`);
 *   • архив, которого в чистом `update.rpf` нет и который целиком состоит из остатка, — одним файлом-архивом, как векторная карта `minimap.rpf` у «Большой
 *     карты»: целый архив автора — это и есть «один в один», собирать его заново из записей незачем;
 *   • файл из архива автора, чьё остальное содержимое разнесено по компонентам, — не ставится: архива автора у игрока нет (части лежат в слоях Astral), положить
 *     один его файл «по тому же пути» некуда. Называется поимённо с причиной.
 *
 * Данные версии игры (`skipped.gameData`, §4.5), ганпаки и одежда сюда не попадают: их разбор не берёт по своим правилам. Пакет привязан к версии игры автора
 * (`boundToBuild`), полка карточки — маппинга: уже выпущенное окно такие части редукса на полки не выводит (`UNLISTED_PART_EDITORS`), новое узнаёт пакет по слоту.
 *
 * Файл основы лежит у игрока байт в байт, но работает, только если игра читает этот путь сама. Файл, который автор подключал строкой своего `content.xml`
 * (`hatemods/hatemods.ymt` — `EXPLOSION_INFO_FILE` у GODMODE), без этой строки игра не читает: `content.xml` автора — данные версии игры и не ставится.
 */

import { postKey } from "./post-key.js";
import { ID_LIMIT, NO_MEDIA, UPDATE_RPF, idPrefixOf, payloadName, placementOf, plural } from "./anatomy-drafts.js";

export const REST_SLOT = "redux-base";
export const REST_KIND = "redux-base";
/* Имя, которое видит человек (карточка, строка «Компонентов»). «Основа редукса» / «Base Files» владелец не понял (13.11.2026: «непонятно, что такое
   base files») — зовётся прямо: «Остальные файлы». Внутри кода пакет по-прежнему «основа редукса» (слот `redux-base`). */
export const REST_LABEL = "Остальные файлы";
const CAPABILITIES = Object.freeze(["direct-update-entries-v1", "rpf-container-entry-v1"]);
/* Потолок записей пакета у каталога (`isTrustedInstallManifest`: не больше 5000 файлов). */
const FILES_LIMIT = 5000;

/** Файлы игры, которые в основу не идут никогда — с причиной, которая уходит в отчёт. Правило смотрит только на пути, которые есть в чистом `update.rpf`. */
export const REST_NEVER = Object.freeze([
  { test: "^setup2\\.xml$", why: "опознавательный файл update.rpf: чужой сбивает игре порядок загрузки обновления" },
  {
    test: "^common/data/(action|ai)/",
    why: "правила оружия, боя и ИИ игры целым файлом: это не оформление, а отдача, урон и поведение — серверы считают такую правку читом; из оружейных мет берётся только привязка трейсеров",
  },
]);
const NEVER_TABLE = REST_NEVER.map((rule) => ({ re: new RegExp(rule.test, "i"), why: rule.why }));
export const OTHER_BUILD_WHY = "файл игры целиком, а редукс собран на другой версии игры: правку автора не отличить от штатного файла его версии, а файл прежней версии поверх новой игры её ломает";

const lower = (text) => String(text ?? "").toLowerCase();
const lastOf = (path) => String(path).split("/").pop();
const filesWord = (count) => `${count} ${plural(count, "файл", "файла", "файлов")}`;

/** Архивы на пути записи, от внешнего к внутреннему: `a/b.rpf/c.rpf/d.ydr` → [`a/b.rpf`, `a/b.rpf/c.rpf`]; запись вне архивов — пустой список. */
export function archivesOfEntry(path) {
  const text = String(path);
  const found = [];
  for (let at = lower(text).indexOf(".rpf/"); at >= 0; at = lower(text).indexOf(".rpf/", at + 1)) found.push(text.slice(0, at + 4));
  return found;
}

/**
 * Куда ложится каждый файл остатка.
 *
 * @param {{ path: string, sha256?: string, size?: number }[]} leftovers остаток разбора (повторы по пути схлопываются)
 * @param {{ rows?: { path: string }[], hasStockArchive?: (path: string) => boolean, inStock?: (path: string) => boolean, sameBuild?: boolean }} [facts]
 *   `rows` — все записи `update.rpf` автора; `hasStockArchive(путь строчными)` — есть ли такой архив в чистом `update.rpf`; `inStock(путь строчными)` — есть ли
 *   такая запись в чистом `update.rpf`; `sameBuild` — редукс собран на версии игры чистой копии
 * @returns {{ files: object[], containers: { path: string, files: object[] }[], refused: { path: string, sha256?: string, size?: number, why: string }[] }}
 */
/* Путь в игре уже занят компонентом: автор подключил вместо этого файла другой (HALLOWEN 240, 13.11.2026: погоду игра у него читает из `pogoda.xml`,
   таймцикл ставит её по штатному пути `weather.xml`, а неиспользуемый `weather.xml` автора шёл в основу тем же путём — два пакета писали одну запись,
   и в игре оказывалась не та погода). Такой файл автора в игре не работает и у него самого — в основу он не идёт. */
export const TAKEN_WHY = "путь в игре занят компонентом редукса: автор подключил вместо этого файла другой, он и ставится";

export function planRest(leftovers, { rows = [], hasStockArchive = () => false, inStock = () => false, sameBuild = false, taken = () => false } = {}) {
  const byPath = new Map();
  for (const item of leftovers || []) if (item?.path && !byPath.has(lower(item.path))) byPath.set(lower(item.path), item);
  const files = [];
  const refused = [];
  const own = new Map();
  const refuse = (item, why) => refused.push({ path: item.path, sha256: item.sha256, size: item.size, why });
  for (const [key, item] of byPath) {
    if (taken(key)) {
      refuse(item, TAKEN_WHY);
      continue;
    }
    if (inStock(key)) {
      /* Файл игры целиком: версия и запреты. Своего файла автора (пути в чистой игре нет) это не касается. Версия — первой: у редукса на другой
         версии игры отличие от штатного файла, скорее всего, и есть разница версий, а не правка автора (ENEMY V2, 13.11.2026: игра автора 2024 года,
         41 такой файл) — называть его «читом» было бы неправдой. */
      if (!sameBuild) {
        refuse(item, OTHER_BUILD_WHY);
        continue;
      }
      const never = NEVER_TABLE.find((rule) => rule.re.test(key));
      if (never) {
        refuse(item, never.why);
        continue;
      }
    }
    /* Первый архив на пути, которого нет в чистом `update.rpf`: всё, что внутри него, у игрока создавать некуда — он идёт целиком или не идёт. */
    const archive = archivesOfEntry(item.path).find((candidate) => !hasStockArchive(lower(candidate)));
    if (!archive) {
      files.push(item);
      continue;
    }
    if (!own.has(lower(archive))) own.set(lower(archive), { path: archive, files: [] });
    own.get(lower(archive)).files.push(item);
  }
  /* Архив автора идёт целиком, только если весь он — остаток: иначе часть его файлов уже ушла в компоненты, и целый архив задвоил бы их. */
  const containers = [];
  for (const [key, group] of own) {
    const inside = rows.filter((row) => lower(row.path).startsWith(`${key}/`));
    const whole = inside.length > 0 && inside.every((row) => byPath.has(lower(row.path)));
    if (whole) {
      containers.push(group);
      continue;
    }
    for (const item of group.files) refuse(item, `лежит в архиве автора ${group.path}, которого у игрока нет: остальное содержимое архива разнесено по компонентам, положить один файл по тому же пути некуда`);
  }
  return { files, containers, refused };
}

/**
 * Заявка «Основа редукса» одного `update.rpf`.
 *
 * @param {object} anatomy результат `analyzeAnatomy` (нужны `build` и остаток)
 * @param {{ label?: string, author?: string, archive?: string, postUrl?: string, sourceOf?: (path: string) => string, containerSourceOf?: (path: string) => string,
 *   leftovers?: object[], rows?: object[], hasStockArchive?: (path: string) => boolean, inStock?: (path: string) => boolean, sameBuild?: boolean, taken?: (path: string) => boolean }} [context]
 *   `leftovers` — остаток сверх `skipped.unverified` и `unresolved` (файлы компонентов без способа установки); остальное — как у `planRest`;
 *   `absorb` — готовые заявки, чьи записи пакет забирает как есть (переключатели оптимизации, когда карточка «Оптимизация» — архив мира:
 *   `anatomy-optimization.js`): записи по штатным путям игры, те же байты, правила остатка (`planRest`) к ним не применяются
 * @returns {{ draft: object|null, claimed: Set<string>, refused: object[], problems: object[] }}
 */
export function restComponentDraft(anatomy, context = {}) {
  const { label = "", author = "", archive = "", postUrl = "", sourceOf = (path) => path, leftovers = [], rows = [], hasStockArchive = () => false, inStock = () => false, sameBuild = false, taken = () => false, absorb = [] } = context;
  const containerSourceOf = context.containerSourceOf ?? sourceOf;
  const all = [...(anatomy?.skipped?.unverified || []), ...(anatomy?.unresolved || []), ...leftovers];
  const plan = planRest(all, { rows, hasStockArchive, inStock, sameBuild, taken });
  const result = { draft: null, claimed: new Set(), refused: plan.refused, problems: [] };
  for (const item of plan.refused) result.problems.push({ code: "rest-refused", message: `${item.path}: в основу редукса не идёт — ${item.why}.`, severity: "warn", reported: item });
  const absorbed = absorb.flatMap((draft) => (draft.spec?.files || []).map((record) => ({ draft, record })));
  const total = plan.files.length + plan.containers.length + absorbed.length;
  if (total === 0) return result;
  if (total > FILES_LIMIT) {
    result.problems.push({ code: "rest-files-limit", message: `Основа редукса: записей ${total} — больше, чем принимает каталог (${FILES_LIMIT}); пакет не собран.`, severity: "block" });
    return result;
  }

  const specFiles = [];
  const mapping = [];
  const sources = {};
  for (const group of plan.containers) {
    const source = payloadName(lastOf(group.path), specFiles.length);
    /* `upsert`, не `import`: у игрока другой версии игры такой архив может уже быть, а `import` по существующей записи движок отвергает до установки. */
    specFiles.push({ source, target: UPDATE_RPF, entry: group.path, action: "upsert" });
    sources[group.path] = { author: group.path };
    mapping.push({ path: source, source: containerSourceOf(group.path), contains: group.files.map((file) => ({ path: file.path, sha256: file.sha256, size: file.size })) });
    result.claimed.add(lower(group.path));
    for (const file of group.files) result.claimed.add(lower(file.path));
  }
  for (const file of plan.files) {
    const source = payloadName(lastOf(file.path), specFiles.length);
    specFiles.push({ source, target: UPDATE_RPF, entry: file.path, action: "upsert" });
    sources[file.path] = { author: file.path, inventory: file.sha256 };
    mapping.push({ path: source, source: sourceOf(file.path), sha256: file.sha256, size: file.size });
    result.claimed.add(lower(file.path));
  }

  /* Записи вобранных заявок — как есть: тот же путь в игре, то же действие, те же байты; имя файла пакета — своё, по общему счёту. */
  for (const { draft, record } of absorbed) {
    const file = (draft.files || []).find((item) => item.path === record.source);
    if (!file) continue;
    const source = payloadName(lastOf(record.entry), specFiles.length);
    specFiles.push({ ...record, source });
    mapping.push({ ...file, path: source });
    const from = draft.domain?.anatomy?.sources?.[record.entry];
    if (from) sources[record.entry] = from;
    result.claimed.add(lower(record.entry));
  }
  const absorbedTitles = absorb.map((draft) => String(draft.card?.name || "").split(" · ").at(-1) || draft.id);

  const id = [[idPrefixOf(label), REST_SLOT].join("-"), postKey(postUrl)].filter(Boolean).join("-").slice(0, ID_LIMIT);
  const counted = plan.files.length + plan.containers.reduce((sum, group) => sum + group.files.length, 0) + absorbed.length;
  const from = label ? ` редукса ${label}` : "";
  const placement = placementOf("mapping");
  const card = {
    name: label ? `${label} · ${REST_LABEL}` : REST_LABEL,
    description: `Файлы${from} без своего раздела в каталоге: ${filesWord(counted)} автора по его же путям, ставятся вместе с редуксом.${absorbedTitles.length ? ` В их числе настройки оптимизации: ${absorbedTitles.map((title) => title.toLowerCase()).join(", ")}.` : ""} Привязано к версии игры: после её обновления файлы перепроверяются.`,
    author: String(author || "").trim(),
    ...placement,
    /* Слот полки — свой: в запись облачного каталога не доходят ни манифест, ни `domain.anatomy`, и окно узнаёт пакет только по `catalogSlot`. Раздел,
       вид и подраздел остаются маппинга: выпущенное окно, которое слота не знает, находит редактор по подписи подраздела «Маппинг» и на полки пакет
       не выводит (`redux-editors.js: reduxEditorOf`, `UNLISTED_PART_EDITORS`); в набор «Весь маппинг» и в слот «Маппинг» библиотеки он при этом не идёт. */
    slot: REST_SLOT,
    catalogSubcategory: placement.subcategory ?? "",
  };
  delete card.subcategory;
  result.draft = {
    id,
    archive,
    kind: REST_KIND,
    delivery: "package",
    spec: {
      id,
      version: "1.0.0",
      adapter: "rpf-entry",
      editions: ["Legacy"],
      requiresLoader: false,
      scope: "game-root",
      ...(author ? { author } : {}),
      capabilities: [...CAPABILITIES],
      slots: [REST_SLOT],
      files: specFiles,
    },
    files: mapping,
    card,
    domain: {
      anatomy: {
        schema: 1,
        redux: label,
        slot: REST_SLOT,
        slots: [REST_SLOT],
        kind: REST_KIND,
        label: REST_LABEL,
        order: null,
        build: anatomy?.build?.key ?? null,
        stock: "diff",
        package: REST_SLOT,
        boundToBuild: true,
        units: [],
        omitted: [],
        sources,
        rest: { files: plan.files.length, containers: plan.containers.map((group) => ({ path: group.path, files: group.files.length })), refused: plan.refused.length, sameBuild, ...(absorbedTitles.length ? { optimization: absorbedTitles } : {}) },
      },
    },
    problems: [{ code: "needs-media", message: NO_MEDIA, severity: "warn" }],
  };
  return result;
}
