/*
 * Имена файлов и папок в путях мода: одно правило для установки пакета, распаковки чужого архива, сборки
 * пакета и проверки бандла (разбор безопасности 23.11.2026, находка H3-03).
 *
 * Запрет исполняемых типов смотрит на расширение имени, а Windows понимает имя шире, чем строка в списке:
 *   - двоеточие в имени — поток файловой системы NTFS, и запись в него может создать обычный файл под другим именем;
 *   - точку и пробел в конце имени Windows отбрасывает или не показывает;
 *   - имена устройств (с любым расширением) — не файлы;
 *   - знаки направления текста (U+202E и родня) переставляют на экране имя и расширение;
 *   - файл `.asi` без имени: у Windows это расширение, у `path.extname` — нет, а маска `*.asi` его находит.
 *
 * Поэтому правило — ЗАПРЕТНЫЙ список, а не белый: настоящие моды лежат в папках с кириллицей, скобками, `&`,
 * апострофом, `#`, `[`, `]`, запятыми, и разрешённый набор знаков их бы сломал. Отказ — только за то, чего в имени
 * настоящего файла быть не может или что Windows понимает иначе, чем написано.
 *
 * Тильду не запрещаем: `~` — законный знак (`PROGRA~1`, `backup~1.xml`).
 *
 * Остаточный риск 1: короткие имена 8.3 под чужим файлом. У файла с длинным именем Windows на томах с включённым
 * 8.3 создаёт второе, короткое имя (`ABCDEF~1.XML`), и запись по такому пути попадёт в УЖЕ лежащий файл, чьё длинное
 * имя эта проверка не видела; расширение короткого имени — первые три знака настоящего. По форме имени (ЧТО~ЦИФРЫ)
 * его не отличить от законного файла (`backup~1.xml`), правило по форме отвергало бы настоящие моды, поэтому здесь
 * его нет. Надёжно закрывается только на стороне записи: пакет пишет в файлы, которые создал сам, и не перезаписывает
 * по такому пути чужой файл. Запрет «продолжений» расширений (`SHORT_NAME_PREFIXES` ниже) закрывает лишь случай,
 * когда программа ищет файл по маске (`*.asi`, `*.dll`, `*.lua`).
 *
 * Остаточный риск 2: юникод-двойники точки, косых и двоеточия: U+FF0E (точка), U+FF0F и U+FF3C (косые), U+FF1A
 * (двоеточие), U+2024 («одна точка»). Правило пропускает их как есть и не нормализует имя. В вызовах Win32 с
 * юникодными путями (Node, Rust-движок) это просто знаки имени; опасны они только в вызовах с ANSI-страницей, которая по
 * «лучшему соответствию» превращает их в знаки ASCII. В пути записи таких вызовов второе чтение (23.11) не нашло;
 * появятся — имя придётся нормализовать там же, где пишут на диск.
 *
 * Модуль чистый (ни диска, ни зависимостей): его берут без побочных эффектов и главный процесс, и потоки,
 * и сборочные скрипты. То же правило — в Rust-движке (`native/astral-engine/.../paths.rs`).
 *
 * В исходнике нет ни одного знака с обратной косой и ни одного невидимого знака: границы заданы числами.
 */

/**
 * Расширения, которых нет в пакетах мода: запускаются, открываются двойным щелчком или ставят что-то в систему.
 * Второе чтение (23.11) добавило скрипты, которые берёт сама игра (`.cs`, `.vb` — ScriptHookVDotNet компилирует их при
 * старте; `.lua` — загрузчики Lua-плагинов) и общую гигиену Windows (Python, модули и манифесты PowerShell, справка,
 * макросы Office, ярлыки-описания, образы дисков). Перед включением каждое расширение сверено с опубликованными
 * пакетами и бандлами: файлов с ними там нет (разбор безопасности 23.11, «Доработка по второму чтению»).
 */
export const FORBIDDEN_EXTENSIONS = new Set([
  ".exe",
  ".dll",
  ".asi",
  ".bat",
  ".cmd",
  ".com",
  ".cpl",
  ".js",
  ".jse",
  ".msi",
  ".msp",
  ".ps1",
  ".scr",
  ".vbs",
  ".vbe",
  ".wsf",
  ".wsh",
  ".lnk",
  ".url",
  ".scf",
  ".hta",
  ".jar",
  ".reg",
  ".inf",
  ".msix",
  ".appx",
  ".sys",
  ".ocx",
  ".drv",
  ".gadget",
  ".application",
  ".pif",
  /* скрипты, которые берёт сама игра */
  ".cs",
  ".vb",
  ".lua",
  /* гигиена Windows: скрипты и модули, справка, макросы, описания ярлыков и поиска, образы дисков */
  ".py",
  ".pyw",
  ".psm1",
  ".psd1",
  ".ps1xml",
  ".psc1",
  ".msc",
  ".chm",
  ".wsc",
  ".sct",
  ".ws",
  ".xll",
  ".vsto",
  ".xbap",
  ".jnlp",
  ".job",
  ".theme",
  ".themepack",
  ".library-ms",
  ".search-ms",
  ".settingcontent-ms",
  ".appref-ms",
  ".diagcab",
  ".iso",
  ".vhd",
  ".vhdx",
]);

const BACKSLASH = String.fromCharCode(92);
/* Знаки, которых в имени файла Windows быть не может (двоеточие — отдельно: оно ещё и поток). */
const FORBIDDEN_PRINTABLE = '<>"|?*';
/* Знаки направления текста: U+061C, U+200E и U+200F, U+202A–U+202E, U+2066–U+2069. */
const DIRECTION_RANGES = [
  [0x061c, 0x061c],
  [0x200e, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
];
/* Имена устройств Windows без цифры (регистр не важен); к ним добавляются COM и LPT с одной цифрой. */
const DEVICE_WORDS = new Set(["con", "prn", "aux", "nul", "conin$", "conout$"]);
/* Цифра после COM и LPT: 0–9 и «верхние» ¹ ² ³ (U+00B9, U+00B2, U+00B3). */
const isDeviceDigit = (code) => (code >= 0x30 && code <= 0x39) || code === 0xb9 || code === 0xb2 || code === 0xb3;

/* Часть до первой точки без хвостовых пробелов: расширение и пробелы перед ним устройством быть не мешают. */
function deviceBase(segment) {
  const dot = segment.indexOf(".");
  const head = dot < 0 ? segment : segment.slice(0, dot);
  let end = head.length;
  while (end > 0 && head[end - 1] === " ") end -= 1;
  return head.slice(0, end).toLowerCase();
}

function isDeviceName(segment) {
  const base = deviceBase(segment);
  if (DEVICE_WORDS.has(base)) return true;
  const prefix = base.slice(0, 3);
  return (prefix === "com" || prefix === "lpt") && [...base].length === 4 && isDeviceDigit(base.codePointAt(3));
}

/**
 * Почему звено пути (одно имя, без косых) недопустимо; `null` — звено годится.
 * Коды: `empty`, `dots`, `separator`, `colon`, `character`, `direction`, `trailing`, `device`.
 */
export function nameSegmentProblem(segment) {
  if (typeof segment !== "string" || segment === "") return "empty";
  if (segment === "." || segment === "..") return "dots";
  if (segment.includes("/") || segment.includes(BACKSLASH)) return "separator";
  if (segment.includes(":")) return "colon";
  for (const symbol of segment) {
    const code = symbol.codePointAt(0);
    if (code < 0x20 || code === 0x7f || FORBIDDEN_PRINTABLE.includes(symbol)) return "character";
    if (DIRECTION_RANGES.some(([from, to]) => code >= from && code <= to)) return "direction";
  }
  const last = segment[segment.length - 1];
  if (last === "." || last === " ") return "trailing";
  if (isDeviceName(segment)) return "device";
  return null;
}

/** Словами, для сообщения об отказе (без самого имени: в журнал оно попадает отдельно). */
export function nameSegmentReason(code) {
  const reasons = {
    empty: "пустое звено",
    dots: "звено «.» или «..»",
    separator: "косая черта внутри звена",
    colon: "двоеточие (поток NTFS или диск)",
    character: 'управляющий знак или один из < > " | ? *',
    direction: "знак направления текста",
    trailing: "точка или пробел в конце",
    device: "имя устройства Windows",
  };
  return reasons[code] ?? "недопустимое имя";
}

/** Расширение с точкой в нижнем регистре у последнего звена: у `.asi` без имени оно `.asi`, у `x.` — `.`. */
export function extensionOfName(name) {
  const last = String(name ?? "").replaceAll(BACKSLASH, "/").split("/").pop();
  const dot = last.lastIndexOf(".");
  return dot < 0 ? "" : last.slice(dot).toLowerCase();
}

/*
 * Файл с длинным именем Windows получает ещё и короткое (8.3), у которого расширение — первые три знака настоящего, и
 * поиск по маске (`*.asi`) находит его по короткому имени: загрузчик плагинов видит `x.asix` как `x.asi`. Поэтому
 * продолжение этих расширений тоже запрещено: `.asi`, `.dll`, `.exe` и `.lua` (загрузчики Lua-плагинов берут маску
 * `*.lua`). Остальные расширения из списка не расширяем: файл с ними запускает человек или Windows по длинному имени, а
 * у них есть настоящие продолжения (`.info`, `.script`, `.region`, `.csv`), и правило отвергало бы настоящие файлы.
 */
const SHORT_NAME_PREFIXES = [".asi", ".dll", ".exe", ".lua"];

/** Исполняемого типа ли файл с таким именем. Звено должно быть уже проверено `nameSegmentProblem`: хвост и поток расширение прячут. */
export function hasForbiddenExtension(name) {
  const extension = extensionOfName(name);
  if (FORBIDDEN_EXTENSIONS.has(extension)) return true;
  return SHORT_NAME_PREFIXES.some((prefix) => extension.length > prefix.length && extension.startsWith(prefix));
}
