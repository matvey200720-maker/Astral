/*
 * «Архив игры переделан другой сборкой» — словами, а не «Archive entry was not found».
 *
 * Бета 14.10.2026 (6𝒆𝒘 и другие игроки РП-серверов): в `update.rpf` стоят чужие
 * сборки («3pn best mods», angar, arenaopt…), и файлов эффектов нет на штатном
 * месте — `x64/patch/data/effects/ptfx.rpf/core.ypt` вынесен во вложенный
 * `effects.rpf` в корне архива. Редактор эффектов читал штатный путь, хост
 * отвечал «Archive entry was not found», и человек видел «Операция не удалась»
 * (а рядом ещё и «GTA V запущена»).
 *
 * Здесь узнаём этот отказ по записи, которую искали: если её нет там, где она
 * есть в любой штатной игре, а читал её редактор эффектов, — архив перестроили,
 * и Astral на него не ляжет. Чужое не трогаем, ничего не пишем: только честное
 * объяснение и путь к оригиналу. Запись, вынесенную во вложенный архив, ищет
 * `ptfx-entry-locator.js` (15.10.2026): ядро в архиве, который игра подключает
 * через content.xml, читается и правится там; сюда доходят только случаи, где
 * места, которое читает игра, не найти.
 *
 * Второй вид того же отказа — файл на месте, но не читается: помощник RPF
 * отвечает целиком текстом исключения CodeWalker («System.Exception: illegal
 * position! at CodeWalker.GameFiles.ResourceDataReader.ReadFromStream …» — сорок
 * строк стека), и человек видел его в окне редактора попаданий. Указатель
 * в файле ведёт в никуда, когда ядро собрано не по штатной раскладке: чужим
 * модом, под другую версию игры (ресурс 71 у GTA V Enhanced против 68 у
 * Legacy). `explainUnreadableYpt` называет это словами и сверяет версию
 * ресурса по заголовку файла.
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const NOT_FOUND = /Archive entry was not found:\s*(\S+)/i;
/* Записи, которые есть в штатном update.rpf и нужны редактору эффектов. */
const STANDARD_EFFECT_ENTRY = /^update:\/(?:x64\/patch|common)\/data\/effects\//i;

/** Запись, которой не оказалось на штатном месте, — или `null`, если отказ не про это. */
export function missingStandardEffectEntry(error) {
  const match = NOT_FOUND.exec(String(error?.message || error || ""));
  const entry = match?.[1]?.replace(/[.,;)]+$/, "");
  return entry && STANDARD_EFFECT_ENTRY.test(entry) ? entry : null;
}

/**
 * Отказ чтения записи архива — отказом со словами; всё остальное возвращается
 * как есть. Исходная строка остаётся в скобках: по ней видно, какой файл искали.
 */
export function explainForeignArchive(error) {
  const entry = missingStandardEffectEntry(error);
  if (!entry) return error;
  const explained = new Error(
    "Архив игры переделан другой сборкой: в update.rpf нет штатного файла эффектов " +
      `${entry.replace(/^update:\//i, "")}, поэтому эффекты и трассеры Astral на него не лягут. ` +
      "Верните оригинал — проверка файлов игры в Steam, Epic Games или Rockstar Games Launcher, " +
      "затем поставьте сборку из каталога Astral. " +
      `(${String(error?.message || error)})`,
  );
  explained.code = "ASTRAL_FOREIGN_ARCHIVE";
  explained.cause = error;
  return explained;
}

/*
 * Разбор `.ypt` рухнул внутри CodeWalker: помощник RPF кладёт в отказ весь
 * `ypt.ErrorMessage` (то есть `ex.ToString()`). «illegal position!» — указатель
 * ресурса вне системной и графической страниц. Узнаём по читателю ресурса в
 * стеке, а не по одной фразе: тот же текст при записи (`ResourceDataWriter`) —
 * ошибка самой сборки, а не чужого файла.
 */
const UNREADABLE_YPT =
  /CodeWalker\.GameFiles\.(?:ResourceDataReader|YptFile\.Load|ParticleEffectsList\.Read)|YPT could not be decoded|файл повреждён или нестандартный/i;
/*
 * Файл не похож на ресурс (бета 15.10.2026: ypt из редукса при распаковке
 * раздувал помощника RPF до OutOfMemoryException, и вместе с ним падало
 * окно). Теперь помощник (`ReadResourceFile`, `ResourceBuilder.Decompress`)
 * и главный процесс (`inflateRawBounded`) останавливаются на заявленном в
 * заголовке RSC7 размере или на самом заголовке и отвечают «… — файл
 * повреждён или нестандартный»; что именно — в скобках из `briefCause`.
 */
const DAMAGED_YPT = /файл повреждён или нестандартный/i;
const RSC7_MAGIC = 0x37435352;
/* Версия ресурса `.ypt` в заголовке RSC7: Legacy — 68, Enhanced (gen9) — 71
   (`YptFile.GetVersion`). */
const LEGACY_YPT_VERSION = 68;
const ENHANCED_YPT_VERSION = 71;

/** Отказ разбора `.ypt` внутри CodeWalker (а не «файла нет» и не «диск полон»). */
export function isUnreadableYpt(error) {
  return UNREADABLE_YPT.test(String(error?.message || error || ""));
}

/**
 * Что можно сказать о файле, не разбирая его: размер, sha256 (по нему опознаётся
 * сборка мода, давшая нечитаемое ядро) и версия ресурса из заголовка RSC7 —
 * `null`, если заголовка нет. Файла нет или он не читается — всё `null`.
 */
async function yptFacts(file) {
  const none = { version: null, size: null, sha256: null };
  if (!file) return none;
  try {
    const bytes = await fs.readFile(file);
    const version =
      bytes.length >= 16 && bytes.readUInt32LE(0) === RSC7_MAGIC
        ? bytes.readInt32LE(4)
        : null;
    return {
      version,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch {
    return none;
  }
}

/** Первая строка исключения и первый блок CodeWalker из стека — коротко, для скобок. */
function briefCause(error) {
  const text = String(error?.message || error || "");
  const first = text
    .split(/\r?\n/, 1)[0]
    .replace(/^System\.\w+:\s*/, "")
    .replace(/\s+at CodeWalker\..*$/, "")
    .trim();
  const block = /at CodeWalker\.GameFiles\.(?:Particle\w+|ResourcePointer\w+)\.Read\b/.exec(text);
  const where = block?.[0]?.replace(/^at CodeWalker\.GameFiles\./, "");
  return [first, where && `в ${where}`].filter(Boolean).join(" ");
}

/**
 * Отказ разбора `.ypt` — отказом со словами, в том же семействе, что и «нет
 * штатной записи» (`foreign-archive` в `installFailure.js`: текст начинается
 * с его опознавательной фразы). Остальные отказы возвращаются как есть;
 * исходное исключение остаётся в `cause`.
 *
 * @param {unknown} error отказ помощника RPF
 * @param {string} [file] абсолютный путь к извлечённому `.ypt` — по нему
 *   читаются версия ресурса, размер и sha256 (`explained.facts`, в журнал)
 */
export async function explainUnreadableYpt(error, file) {
  if (!isUnreadableYpt(error)) return error;
  const facts = await yptFacts(file);
  const { version } = facts;
  const name = file ? path.basename(String(file)) : "";
  const subject = name ? `файл эффектов ${name}` : "файл эффектов";
  let why = "он собран не так, как в штатной GTA V Legacy (чужой мод или другая версия игры)";
  if (DAMAGED_YPT.test(String(error?.message || error || "")))
    why = "он повреждён или собран нестандартно (чужой мод или редукс)";
  else if (version === ENHANCED_YPT_VERSION)
    why = `он собран для GTA V Enhanced (версия ресурса ${version}, в Legacy — ${LEGACY_YPT_VERSION})`;
  else if (version !== null && version !== LEGACY_YPT_VERSION)
    why = `он собран для другой версии игры (версия ресурса ${version}, в Legacy — ${LEGACY_YPT_VERSION})`;
  const explained = new Error(
    `Архив игры переделан другой сборкой: ${subject} из вашей игры не читается — ${why}, ` +
      "и эффекты и трассеры Astral на него не лягут. " +
      "Верните оригинал — проверка файлов игры в Steam, Epic Games или Rockstar Games Launcher, " +
      "затем поставьте сборку из каталога Astral. " +
      `(${briefCause(error)})`,
  );
  explained.code = "ASTRAL_FOREIGN_ARCHIVE";
  explained.cause = error;
  explained.facts = { name, ...facts };
  return explained;
}

/** Строка о файле для журнала: «core.ypt · 13123456 Б · версия ресурса 68 · sha256 …». */
export function describeYptFacts(facts) {
  if (!facts) return "";
  return [
    facts.name,
    facts.size !== null && facts.size !== undefined && `${facts.size} Б`,
    facts.version !== null && facts.version !== undefined && `версия ресурса ${facts.version}`,
    facts.sha256 && `sha256 ${facts.sha256}`,
  ]
    .filter(Boolean)
    .join(" · ");
}
