/*
 * Файлы набора рядом с приложением против описи (перекраска, прострелы).
 *
 * Своему входу установщик не верит: каждый файл сверяется с описью — повреждённый
 * или чужой файл уехал бы в игру молча. Причин отказа три, и у каждой свой
 * текст: файла нет, размер другой, содержимое (sha256) другое.
 *
 * beta.51 (22.10.2026): опись арены в app.asar новая (83 файла), а файлы набора
 * в базе остались от прежней версии (41) — «переустановите Astral» человеку не
 * помогало, сборка та же. Теперь отказ называет набор, файл, ожидаемое и
 * фактическое (размер и 12 знаков sha256), сколько ещё файлов не сошлось, и
 * говорит, что нужно обновить Astral. Окно узнаёт отказ по первой фразе
 * (`utils/installFailure.js`, семейство `set-outdated`): менять её только вместе
 * с ним.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const SET_FILES_OUTDATED = "SET_FILES_OUTDATED";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const short = (hash) => `${hash.slice(0, 12)}…`;

function problemText({ expected, reason, actual }) {
  const want = `${expected.size} байт, sha256 ${short(expected.sha256)}`;
  if (reason === "missing") return `нет файла ${expected.name} (или он не читается), ждали ${want}`;
  if (reason === "size")
    return `у файла ${expected.name} размер ${actual.size} байт вместо ${expected.size}, sha256 ${short(actual.sha256)} вместо ${short(expected.sha256)}`;
  return `содержимое файла ${expected.name} не совпало с описью: sha256 ${short(actual.sha256)} вместо ${short(expected.sha256)} при верном размере ${actual.size} байт`;
}

/**
 * Отказ сверки. `reason` — `missing` (нет файла), `size` (другой размер) или
 * `sha` (другое содержимое); `actual` — что нашли (`null`, если файла нет);
 * `others` — сколько остальных файлов набора тоже не сошлись по размеру или
 * отсутствуют (весь набор старый или один файл битый — по этому числу видно).
 */
export class SetFilesOutdatedError extends Error {
  constructor({ title, expected, reason, actual = null, others = 0, total = 0 }) {
    const more = others ? ` Всего в наборе ${total} файлов, кроме этого не сходятся по размеру или отсутствуют ${others}.` : "";
    super(
      `Файлы набора «${title}» не той версии, что код Astral: ${problemText({ expected, reason, actual })}.${more} Нужно обновить Astral — переустановка той же сборки не поможет.`,
    );
    this.code = SET_FILES_OUTDATED;
    this.title = title;
    this.file = expected.name;
    this.reason = reason;
    this.expected = { size: expected.size, sha256: expected.sha256 };
    this.actual = actual;
    this.others = others;
    this.total = total;
  }
}

function problemOf(expected, bytes) {
  if (!bytes) return { reason: "missing", actual: null };
  const actual = { size: bytes.length, sha256: sha256(bytes) };
  if (actual.size !== expected.size) return { reason: "size", actual };
  return actual.sha256 === expected.sha256 ? null : { reason: "sha", actual };
}

/* Остальные файлы набора — только по наличию и размеру: сказать, один файл не сошёлся или весь набор. */
async function countOthers(root, rest) {
  let count = 0;
  for (const expected of rest) {
    const stat = await fs.stat(path.join(root, expected.name)).catch(() => null);
    if (!stat?.isFile() || stat.size !== expected.size) count += 1;
  }
  return count;
}

/**
 * Файлы набора под опись `[{ name, size, sha256 }]`: имя → байты. Первый же
 * несошедшийся файл — `SetFilesOutdatedError`.
 */
export async function readSetFiles(root, expectedFiles, title) {
  const files = new Map();
  for (const [index, expected] of expectedFiles.entries()) {
    const bytes = await fs.readFile(path.join(root, expected.name)).catch(() => null);
    const problem = problemOf(expected, bytes);
    if (problem) {
      const others = await countOthers(root, expectedFiles.slice(index + 1));
      throw new SetFilesOutdatedError({ title, expected, total: expectedFiles.length, others, ...problem });
    }
    files.set(expected.name, bytes);
  }
  return files;
}
