/*
 * Сводная страница разбора редукса (пакет Р3г, проект `REDUX-SYSTEM-1011.md`, §4.7; Хелпер 28, 10.11.2026).
 *
 * Одна страница на редукс: что нашёл разбор и куда это легло. Её показывают владельцу, поэтому только факты и слова:
 *   • компоненты по слотам — пакеты, записи и файлы автора, порядок включения;
 *   • что не вошло: «данные версии игры», `unverified` поимённо, пропущенные ганпаки и одежда, «не подключено автором», нет архива;
 *   • компоненты с отметкой `boundToBuild` (привязаны к версии игры) и ядро эффектов без проверки точности;
 *   • `.meta` внутри архивов автора, которых он не подключил строкой `content.xml`: «лежит в архиве, автором не подключено»;
 *   • «Основа редукса» — файлы автора без своего раздела в каталоге, которые ставятся вместе с редуксом по его путям, и что в основу не идёт (с причиной);
 *   • «Нет своего способа установки» — файлы компонентов, для которых у игры нет пути установки (отдельно от прочих отчётных строк), с отметкой «в основе»;
 *   • «Заявки поста вне разбора анатомии» (прежние разборы того же поста: звуки, ганпаки…) и пометка у `unverified`: тот же файл у других разобранных
 *     редуксов — вероятно, штатный прежней версии игры (по слепкам, `annotatePeers`);
 *   • замечания разбора (слой таймцикла, расхождения ядра…) и файлы, названные в отчёте с причиной.
 *
 * Чистый модуль: берёт результат `analyzeAnatomy`, заявки трёх сборщиков и замечания; пишет Markdown.
 */

import { plural } from "./anatomy-drafts.js";

const CORE_UNVERIFIED = "проверка точности не подключена";
const LOOSE_LIMIT = 40;

const filesWord = (n) => `${n} ${plural(n, "файл", "файла", "файлов")}`;
const bytesWord = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1).replace(".", ",")} МБ` : bytes >= 1024 ? `${Math.round(bytes / 1024)} КБ` : `${bytes} Б`);
const cell = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

/** Файлов автора в заявке: запись архива-контейнера считается по составу. */
export function authorFilesOf(draft) {
  return (draft.files || []).reduce((sum, file) => sum + (Array.isArray(file.contains) ? file.contains.length : 1), 0);
}

function componentRows(drafts) {
  const rows = new Map();
  for (const draft of drafts) {
    const block = draft.domain?.anatomy;
    if (!block) continue;
    /* Арена двух серверов — две части одного слота разбора: строка своя у каждой (`split` — сервер части). */
    const key = block.split ? `${block.slot}|${block.split}` : block.slot;
    if (!rows.has(key)) rows.set(key, { slot: block.slot, label: block.label, order: block.order, packages: [], files: 0, records: 0, bound: false });
    const row = rows.get(key);
    row.packages.push(block.package ?? block.slot);
    row.files += authorFilesOf(draft);
    row.records += (draft.spec?.files || []).length;
    row.bound ||= block.boundToBuild === true;
  }
  return [...rows.values()].sort((left, right) => (left.order ?? 1e9) - (right.order ?? 1e9) || left.slot.localeCompare(right.slot));
}

function groupProblems(problems) {
  const groups = new Map();
  for (const problem of problems) {
    if (["needs-media", "anatomy-reported", "anatomy-summary", "rest-refused"].includes(problem.code)) continue;
    if (!groups.has(problem.code)) groups.set(problem.code, { code: problem.code, severity: problem.severity, items: [] });
    groups.get(problem.code).items.push(problem.message);
  }
  const rank = { block: 0, warn: 1, info: 2 };
  return [...groups.values()].sort((left, right) => (rank[left.severity] ?? 3) - (rank[right.severity] ?? 3) || left.code.localeCompare(right.code));
}

/** Строки `unverified` для пометки «тот же файл у других редуксов»: путь и первые 12 знаков sha256, как их печатает страница. */
export const unverifiedRows = (anatomy) => (anatomy?.skipped?.unverified || []).map((item) => [item.path, String(item.sha256 || "").slice(0, 12)]);

const UNVERIFIED_HEADING = /^### Не названо в проекте/;
const UNVERIFIED_LINE = /^- `(.+?)` \((?:.+?), ([0-9a-f]{12})\) — /;

/**
 * Пометка у `unverified`: «тот же файл у N разобранных редуксов — вероятно, штатный прежней версии игры». `countOf(путь, sha12)` — у скольких ДРУГИХ разобранных
 * редуксов такая же запись (тот же путь и тот же sha256): совпадение у разных авторов и разных версий игры значит штатный файл старой версии, а не правку.
 * Первый шаг «согласия авторов» (Р4) без библиотеки версий.
 */
export function annotatePeers(page, countOf) {
  let inside = false;
  return String(page)
    .split("\n")
    .map((line) => {
      if (/^#{2,3} /.test(line)) inside = UNVERIFIED_HEADING.test(line);
      if (!inside) return line;
      const match = UNVERIFIED_LINE.exec(line);
      const count = match ? countOf(match[1], match[2]) : 0;
      return count > 0 ? `${line} Тот же файл у ${count} ${plural(count, "разобранного редукса", "разобранных редуксов", "разобранных редуксов")} — вероятно, штатный прежней версии игры.` : line;
    })
    .join("\n");
}

/**
 * Заявки поста, собранные не разбором анатомии (прежние разборы того же поста: звуки оружия, ганпаки, одежда…): страница и заявки обязаны совпадать, поэтому они
 * названы отдельным разделом. `entries` — `{ id, kind, name }`.
 */
export function outsideSection(entries) {
  const lines = [`## Заявки поста вне разбора анатомии (${entries.length})`, ""];
  if (!entries.length) return `${lines.join("\n")}\nНет.\n`;
  lines.push("Эти заявки собрали прежние разборы того же поста, до или помимо анатомии; в таблице компонентов их нет.", "");
  for (const entry of entries) lines.push(`- \`${entry.id}\` — ${cell(entry.kind || "?")}: ${cell(entry.name)}`);
  return `${lines.join("\n")}\n`;
}

/**
 * Страница редукса.
 *
 * @param {{ title: string, anatomy: object, drafts: object[], problems?: object[], reported?: object[], variant?: string, source?: string }} input
 * @returns {string} Markdown
 */
export function summaryPage({ title, anatomy, drafts, problems = [], reported = [], variant = "", source = "" }) {
  const lines = [];
  const out = (...rows) => lines.push(...rows);
  const rows = componentRows(drafts);
  const totals = anatomy.totals || {};
  out(`# ${title}${variant ? ` · ${variant}` : ""} — сводка разбора`, "");
  if (source) out(`_${source}_`, "");
  out(`Сборка игры автора: \`${anatomy.build?.key ?? "не определена"}\`. Записей в \`update.rpf\`, отличных от штатных: ${totals.nonStock ?? "?"}; в компонентах — ${totals.inComponents ?? "?"}; данные версии игры — ${totals.gameData ?? 0}; не названо в проекте (\`unverified\`) — ${totals.unverified ?? 0}; ганпак — ${totals.gunpack ?? 0}; одежда — ${totals.clothing ?? 0}; не подключено автором — ${totals.unregistered ?? 0}; **не разобрано — ${totals.unresolved ?? 0}**.`, "");

  /* Сверка без потерь (§4.7): каждый файл автора в компонентах — в заявке, в списке дублей или в отчёте. */
  const placed = new Set();
  for (const draft of drafts) {
    for (const file of draft.files || []) {
      if (Array.isArray(file.contains)) for (const inner of file.contains) placed.add(inner.path);
      else if (typeof (file.from ?? file.source) === "string") placed.add(file.from ?? file.source);
    }
  }
  const duplicates = new Set(drafts.flatMap((draft) => (draft.domain?.anatomy?.omitted || []).map((item) => item.path)));
  /* В сверку идут только файлы компонентов: привязки трассеров читаются из мет игрока вне компонентов, их отчёт печатается ниже, но в сумму не входит. */
  const componentPaths = Array.isArray(anatomy.units) ? new Set(anatomy.units.flatMap((unit) => (unit.files || []).map((file) => file.path))) : null;
  const named = new Set(reported.filter((item) => !componentPaths || componentPaths.has(item.path)).map((item) => item.path));
  const accounted = new Set([...placed, ...duplicates, ...named]);
  const sum = accounted.size;
  const total = totals.inComponents ?? sum;
  out(`Сверка без потерь: в компонентах автора ${total} ${plural(total, "файл", "файла", "файлов")} = в заявках ${placed.size} + в списке дублей ${duplicates.size} + в отчёте ${named.size}${placed.size + [...duplicates].filter((path) => !placed.has(path)).length + [...named].filter((path) => !placed.has(path) && !duplicates.has(path)).length === total ? " — **сходится**" : ` — **не сходится: учтено ${sum}**`}.`, "");

  out("## Компоненты по слотам", "");
  out("| Порядок | Слот | Компонент | Пакетов | Записей | Файлов автора | Отметки |", "|---|---|---|---|---|---|---|");
  for (const row of rows) {
    const marks = [row.bound ? "boundToBuild" : "", row.packages.length > 1 ? `пакеты: ${row.packages.join(", ")}` : ""].filter(Boolean).join("; ");
    out(`| ${row.order ?? "—"} | \`${row.slot}\` | ${cell(row.label)} | ${row.packages.length} | ${row.records} | ${row.files} | ${cell(marks)} |`);
  }
  if (!rows.length) out("| — | — | заявок компонентов нет | 0 | 0 | 0 | |");
  out("");

  const bound = drafts.filter((draft) => draft.domain?.anatomy?.boundToBuild);
  out("## Привязано к версии игры (`boundToBuild`)", "");
  if (bound.length) {
    out("Эти файлы автора ставятся целиком и перепроверяются после обновления игры (Р4):", "");
    for (const draft of bound) out(`- \`${draft.domain.anatomy.package}\` — ${filesWord(authorFilesOf(draft))}`);
  } else out("Таких компонентов нет.");
  out("");

  const cores = drafts.filter((draft) => (draft.domain?.anatomy?.discrepancies || []).length > 0);
  out("## Ядро эффектов", "");
  if (cores.length) {
    for (const draft of cores) {
      const why = draft.domain.anatomy.discrepancies;
      const unverified = why.some((item) => item.includes(CORE_UNVERIFIED));
      out(`- \`core.ypt\` идёт записью целиком (\`boundToBuild\`)${unverified ? " — **проверка точности не подключена**: разницей ядро пока не собирается" : `, расхождения: ${why.slice(0, 5).map(cell).join("; ")}`}.`);
    }
  } else out("Ядра эффектов как отдельного пакета нет, либо оно ставится разницей.");
  out("");

  /* Висящие ссылки крови, заменённые на «нет эффекта» (решение ведущей 10.11.2026): каждая замена — строкой, чтобы автор и ведущая видели, что в слое не так, как в файле. */
  const replacedRules = drafts.flatMap((draft) => draft.domain?.anatomy?.effects?.bloodRulesReplaced || []);
  if (replacedRules.length) {
    out(`## Ссылки крови на несуществующие правила, заменённые на «нет эффекта» (${replacedRules.length})`, "");
    for (const item of replacedRules) out(`- у автора ссылка на несуществующее правило \`${item.rule}\`, запись ${item.id} (поле \`${item.field}\`) — эффекта нет и у него; в слое поле «-».`);
    out("");
  }

  /* `.meta` в архиве автора, не подключённый его `content.xml`: едет в компонент как лежит, DATA_FILE не регистрируем (игра не читает его и у автора). */
  const loose = anatomy.unconnectedMeta || [];
  out(`## \`.meta\` в архивах автора: лежит в архиве, автором не подключено (${loose.length})`, "");
  if (loose.length) {
    out("Файлы `.meta` внутри архивов автора, которых нет среди строк `content.xml` (DATA_FILE). Они едут в компонент как лежат, регистрацию им не делаем: игра не читает их и у автора.", "");
    for (const item of loose.slice(0, LOOSE_LIMIT)) out(`- \`${item.path}\` — лежит в архиве, автором не подключено (${bytesWord(item.size)}; архив \`${item.container}\`${item.order === null || item.order === undefined ? "" : `, место ${item.order}`})`);
    if (loose.length > LOOSE_LIMIT) out(`- … и ещё ${loose.length - LOOSE_LIMIT}`);
  } else out("Таких файлов нет.");
  out("");

  out("## Что не вошло в заявки", "");
  const skipped = anatomy.skipped || {};
  out(`### Не подключено автором (${(skipped.unregistered || []).length})`, "");
  for (const item of skipped.unregistered || []) out(`- \`${item.path}\` — ${filesWord(item.count)}: ${cell(item.why)}`);
  if (!(skipped.unregistered || []).length) out("Нет.");
  out("", `### Пропущены ганпаки (${(skipped.gunpack || []).length}) и одежда (${(skipped.clothing || []).length})`, "");
  for (const item of [...(skipped.gunpack || []), ...(skipped.clothing || [])]) out(`- \`${item.path}\` — ${filesWord(item.count)}: ${cell(item.why)}`);
  if (!(skipped.gunpack || []).length && !(skipped.clothing || []).length) out("Нет.");
  out("", `### Строка в \`content.xml\` есть, архива нет (${(skipped.missing || []).length})`, "");
  for (const item of skipped.missing || []) out(`- \`${item.path}\` — ${cell(item.why)}`);
  if (!(skipped.missing || []).length) out("Нет.");
  out("", `### Данные версии игры (${(skipped.gameData || []).length}) — не берём никогда (§4.5)`, "");
  const reasons = new Map();
  for (const item of skipped.gameData || []) reasons.set(item.why, (reasons.get(item.why) || 0) + 1);
  for (const [why, count] of [...reasons].sort((left, right) => right[1] - left[1])) out(`- ${count} — ${cell(why)}`);
  if (!reasons.size) out("Нет.");
  /* Основа редукса: что из остатка ставится вместе с редуксом по путям автора (служебный пакет), а что не идёт и почему. */
  const base = drafts.find((draft) => draft.domain?.anatomy?.kind === "redux-base");
  const based = new Set();
  for (const file of base?.files || []) for (const inner of file.contains || []) based.add(String(inner.path).toLowerCase());
  for (const source of Object.values(base?.domain?.anatomy?.sources || {})) based.add(String(source.author || "").toLowerCase());
  const inBase = (item) => (based.has(String(item.path).toLowerCase()) ? " — **в основе редукса**" : "");
  out("", `### Не названо в проекте — \`unverified\` (${(skipped.unverified || []).length}), поимённо`, "");
  for (const item of skipped.unverified || []) out(`- \`${item.path}\` (${bytesWord(item.size)}, ${String(item.sha256 || "").slice(0, 12)}) — ${cell(item.why)}${inBase(item)}`);
  if (!(skipped.unverified || []).length) out("Нет.");
  out("");

  const refused = problems.filter((problem) => problem.code === "rest-refused");
  out(`## Основа редукса: файлы автора без своего раздела в каталоге (${based.size ? based.size - (base?.domain?.anatomy?.rest?.containers || []).length : 0})`, "");
  if (base) {
    out(`Пакет \`${base.id}\` ставится вместе с редуксом, теми же путями, что у автора, байт в байт; карточкой на полки не идёт.`, "");
    for (const group of base.domain.anatomy.rest?.containers || []) out(`- архив целиком: \`${group.path}\` (${group.files} файлов)`);
    for (const file of base.files || []) if (!file.contains) out(`- \`${base.spec.files.find((item) => item.source === file.path)?.entry ?? file.path}\` (${bytesWord(file.size)}, ${String(file.sha256 || "").slice(0, 12)})`);
  } else out("Нет.");
  out("", `### В основу не идёт (${refused.length}), с причиной`, "");
  for (const problem of refused) out(`- \`${problem.reported?.path ?? ""}\` — ${cell(problem.reported?.why ?? problem.message)}`);
  if (!refused.length) out("Нет.");
  out("");

  /* Файлы, для которых у игры нет пути установки, — отдельно от прочих отчётных строк («как в игре», «не разобрать»…). */
  const noInstall = reported.filter((item) => item.noInstall === true);
  const rest = reported.filter((item) => item.noInstall !== true);
  out(`## Нет своего способа установки (${noInstall.length}): в основе редукса — ${noInstall.filter((item) => inBase(item)).length}`, "");
  for (const item of noInstall) out(`- \`${item.path}\` — ${cell(item.why)}${inBase(item)}`);
  if (!noInstall.length) out("Нет.");
  out("");

  out("## Файлы, названные в отчёте с причиной", "");
  const overlapped = drafts.flatMap((draft) => (draft.domain?.anatomy?.omitted || []).map((item) => ({ ...item, pack: draft.domain.anatomy.package })));
  for (const item of rest) out(`- \`${item.path}\` — ${cell(item.why)}`);
  if (!rest.length) out("Нет.");
  out("", `Дубли внутри пакетов (то же содержимое или перекрыто подключённым автором файлом): ${overlapped.length}${overlapped.length ? ` — например \`${overlapped[0].path}\` (${cell(overlapped[0].why)})` : ""}.`, "");

  out("## Замечания разбора", "");
  const groups = groupProblems(problems);
  for (const group of groups) {
    out(`- **${group.code}** (${group.severity}, ${group.items.length}): ${cell(group.items[0])}${group.items.length > 1 ? ` … и ещё ${group.items.length - 1}` : ""}`);
  }
  if (!groups.length) out("Нет.");
  out("", `Обложек нет у всех заявок (${drafts.length}): их снимает печь обложек по \`scene\` из \`part.json\`.`, "");
  return `${lines.join("\n")}\n`;
}
