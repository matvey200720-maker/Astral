// Сборка файлов погоды w_<погода>.xml из проекта неба поверх базовых файлов
// игрока, отчёт о сборке и манифест патча для нативного установщика.
import { createHash } from "node:crypto";
import { parseKeyframeXml, serializeKeyframeXml } from "./keyframe-xml.js";
import { applyProject, changedWeathers } from "./project.js";
import { findWeather, weatherArchivePath } from "./samples.js";

const NO_CHANGES = "В проекте неба нет изменений — устанавливать нечего.";
const noBaseFiles = (missing) => `В архиве игры не нашлось ни одного нужного файла таймцикла: ${missing.join(", ")}.`;

// Сумма поля обычным сложением JavaScript от нуля: строковое значение
// превращает сумму в склейку строк, как в старом коде.
function total(files, field) {
  let sum = 0;
  for (const file of files) sum += file[field];
  return sum;
}

export function compileWeather({ weather, baseXml, project }) {
  const entry = findWeather(weather);
  if (entry === null) throw new Error(`Неизвестный тип погоды: ${weather}`);

  const patched = applyProject(parseKeyframeXml(baseXml), project, entry.id);
  const xml = serializeKeyframeXml(patched.document);
  const bytes = Buffer.from(xml, "utf8");
  return {
    weather: entry.id,
    file: entry.file,
    target: weatherArchivePath(entry.id),
    xml,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    applied: patched.applied,
    skipped: patched.skipped,
    regions: patched.document.regions.map(({ name }) => name),
  };
}

// Погоды по одной: прочитать базу, собрать файл. Нет базы — имя файла в
// пропавшие. Ошибка сборки одной погоды обрывает весь обход.
async function* weatherOutcomes(weathers, readBaseXml, project) {
  for (const weather of weathers) {
    const baseXml = await readBaseXml(weather);
    yield baseXml
      ? { built: compileWeather({ weather, baseXml, project }) }
      : { missing: findWeather(weather)?.file ?? weather };
  }
}

export async function compileProject({ project, readBaseXml }) {
  const weathers = changedWeathers(project);
  if (!weathers.length) throw new Error(NO_CHANGES);

  const report = { files: [], missing: [] };
  for await (const outcome of weatherOutcomes(weathers, readBaseXml, project)) {
    if (outcome.built) report.files.push(outcome.built);
    else report.missing.push(outcome.missing);
  }
  if (!report.files.length) throw new Error(noBaseFiles(report.missing));

  return {
    ...report,
    skipped: report.files.flatMap(({ file, skipped }) => skipped.map((reason) => `${file}: ${reason}`)),
    applied: total(report.files, "applied"),
    totalBytes: total(report.files, "size"),
  };
}

// Поле манифеста → откуда значение. Порядок строк — порядок ключей в манифесте.
const ACTION_FIELDS = [
  ["Type", () => "Replace"],
  ["TargetPath", (file) => file.target],
  ["SourcePath", (file) => `payload/${file.file}`],
  ["Size", (file) => file.size],
  ["Sha256", (file) => file.sha256],
  ["IsWholeReplaceNestedRpf", () => false],
];

const MANIFEST_FIELDS = [
  ["ReduxName", ({ name }) => name || "Astral sky"],
  ["ParsedAt", () => new Date().toISOString()],
  ["TotalPatchSize", ({ files }) => total(files, "size")],
  ["Actions", ({ files }) => files.map((file) => fill(ACTION_FIELDS, file))],
];

function fill(fields, source) {
  const record = {};
  for (const [key, valueOf] of fields) record[key] = valueOf(source);
  return record;
}

export function timecyclePatchManifest({ name, files }) {
  return fill(MANIFEST_FIELDS, { name, files });
}
