import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { downloadSignedPackage, trustedPackageUrl, verifyManifest } from "@modovik/install-engine";
import { BLANK_MODEL_BYTES, BLANK_MODEL_FILE } from "./arena-blank.js";

const MAX_FILES = 40;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_BLANK_CANDIDATES = 160;
const PACKAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;

const raw = String.raw;
const anyOf = (...names) => `(${names.join("|")})`;
const wholeName = (body) => new RegExp(`^${body}$`, "i");

// Белый список имён файлов по видам части (то же, что у окна и у разбора обложек): [вид, шаблон].
const KIND_PATTERNS = [
  ["timecycle", wholeName(anyOf(raw`w_[a-z0-9_]+\.xml`, raw`clouds\.xml`, raw`cloudkeyframes\.xml`, raw`timecycle_mods_\d+\.xml`, raw`visualsettings\.dat`))],
  ["kill-effects", wholeName(anyOf(raw`timecycle_mods_\d+\.xml`, raw`visualsettings\.dat`))],
  ["minimap", wholeName(raw`minimap\.gfx`)],
  ["crosshair", wholeName(raw`hud_reticle\.gfx`)],
  ["sniper-crosshair", wholeName(raw`hud_reticle\.gfx`)],
  ["large-map", wholeName(raw`minimap(_sea)?_\d+_\d+\.ytd`)],
  ["water", wholeName(raw`water\.xml`)],
  ["weather", wholeName(raw`weather\.xml`)],
  ["clouds", wholeName(anyOf("clouds", "cloudkeyframes") + raw`\.xml`)],
  ["minimap-position", wholeName(raw`frontend\.xml`)],
  ["blood-routing", wholeName(anyOf(raw`bloodfx\.dat`, raw`bloodfx-routing\.json`, raw`bloodfx-base\.dat`))],
  ["screen", wholeName(raw`graphics\.ytd`)],
  ["weapon-sounds", wholeName(raw`[a-z0-9_]+\.awc`)],
  ["arena-blank", BLANK_MODEL_FILE],
  [
    "climbing",
    wholeName(
      anyOf(
        // Имя метки может нести приставку автора через «_» или «-» (`kifin_arrow.ydr`).
        raw`([a-z0-9]+[_-])*` + anyOf(...["arrow", "stay", "jump", "firstpov", "thirdpov", "rightclick", "car", "teamneed", "hit", "q"]),
        ...["spex1", "spex3", "spex4", "spexh", "spexpov3", "spexq", "spexrgcl", "spexst"],
      ) + raw`\.ydr`,
    ),
  ],
];

export const PART_FILE_KINDS = Object.freeze(Object.fromEntries(KIND_PATTERNS));

const REFUSALS = {
  kind: ["PART_KIND", "Эту часть мастерская не открывает."],
  noPackage: ["PART_PACKAGE", "У этой части нет пакета."],
  badSignature: ["PART_PACKAGE", "Цифровая подпись пакета недействительна."],
  tooLarge: ["PART_TOO_LARGE", "Файлы части слишком большие для мастерской."],
  empty: ["PART_EMPTY", "В пакете части нет файлов для мастерской."],
};

function refusal(which) {
  const [code, message] = REFUSALS[which];
  return Object.assign(new Error(message), { code });
}

const entryOf = (file) => String(file.entry || file.target || "");
const lastSegment = (text) => text.split(/[/\\]/).pop();
const hasUsableSource = (file) => file?.source && file.action !== "delete";
const copyOut = (view) => new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice().buffer;

// Параметры загрузки пакета: порядок строк — порядок ключей и порядок чтения полей.
const DOWNLOAD_FIELDS = [
  ["manifest", ({ manifest }) => manifest],
  ["baseUrl", ({ input }) => String(input?.baseUrl || "")],
  ["publicKey", ({ deps }) => deps.publicKey],
  ["stateDir", ({ deps }) => deps.stateDir],
  ["downloadsDir", ({ deps }) => deps.downloadsDir || null],
  ["allowInsecureLocalhost", ({ deps }) => Boolean(deps.allowInsecureLocalhost)],
  ["allowedHosts", ({ deps }) => deps.allowedHosts ?? null],
  ["onProgress", ({ context }) => context?.onProgress || null],
];

const downloadRequest = (source) => Object.fromEntries(DOWNLOAD_FIELDS.map(([key, read]) => [key, read(source)]));

// Собирает файлы вида из скачанного пакета: по одному, строго внутри корня, с общим потолком размера.
class PartCollector {
  files = [];
  #total = 0;

  constructor(root, pattern) {
    this.root = root;
    this.pattern = pattern;
  }

  get full() {
    return this.files.length >= MAX_FILES;
  }

  async consider(file) {
    const { root, pattern } = this;
    if (!hasUsableSource(file)) return;
    const entry = entryOf(file);
    const name = lastSegment(entry);
    if (!pattern.test(name)) return;

    const source = resolve(root, file.source);
    if (!source.startsWith(root + sep)) return;

    const data = await readFile(source);
    this.#total += data.byteLength;
    if (this.#total > MAX_TOTAL_BYTES) throw refusal("tooLarge");
    this.files.push({ entry, name, bytes: copyOut(data) });
  }
}

async function readPlainKind({ input, context, deps, manifest, id, pattern }) {
  const source = { input, context, deps, manifest };
  const downloaded = await (deps.download || downloadSignedPackage)(downloadRequest(source));
  const collector = new PartCollector(resolve(downloaded.packageRoot), pattern);
  for (const file of downloaded.manifest?.files || manifest.files || []) {
    if (collector.full) break;
    await collector.consider(file);
  }
  if (collector.files.length === 0) throw refusal("empty");
  return { id, files: collector.files };
}

const importSheets = () => import("./part-sheets.js");

// Мелкая модель подходит в кандидаты, если у неё есть источник, хэш, имя модели и размер в пределах пустышки.
function isBlankCandidate(file) {
  if (!hasUsableSource(file) || !file.sha256) return false;
  if (!BLANK_MODEL_FILE.test(entryOf(file))) return false;
  return typeof file.size === "number" && file.size > 0 && file.size <= BLANK_MODEL_BYTES;
}

const digestOf = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bytesConfirmed = (bytes, file) => bytes.byteLength === file.size && digestOf(bytes) === file.sha256;

// Один кандидат: адрес внутри папки пакета, запрос без переходов, ответ, байты. Не подошёл — null.
async function fetchBlank(file, { base, folder, load }) {
  const address = new URL(file.source, base);
  if (!address.href.startsWith(folder)) return null;

  const response = await load(address, { redirect: "error" }).catch(() => null);
  if (!response?.ok) return null;

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytesConfirmed(bytes, file)) return null;
  const entry = entryOf(file);
  return { entry, name: lastSegment(entry), bytes };
}

// Арена: пакет в сотни мегабайт не качаем, берём по подписанному манифесту только мелкие модели-кандидаты.
async function readArenaBlanks({ input, deps, manifest, id }) {
  const verify = deps.verify || verifyManifest;
  if (!verify(manifest, deps.publicKey)) throw refusal("badSignature");

  const base = trustedPackageUrl(String(input?.baseUrl || ""), {
    allowInsecureLocalhost: Boolean(deps.allowInsecureLocalhost),
    allowedHosts: deps.allowedHosts ?? null,
  });
  const fetching = { base, folder: new URL(".", base).href, load: deps.fetch || fetch };

  const candidates = (manifest.files || []).filter(isBlankCandidate).slice(0, MAX_BLANK_CANDIDATES);
  const accepted = [];
  for (const file of candidates) {
    const found = await fetchBlank(file, fetching);
    if (found) accepted.push(found);
  }

  const { blankModelsOf } = await (deps.sheets || importSheets)();
  const blanks = new Set(await blankModelsOf({ files: accepted }));
  const isBlank = (file) => blanks.has(file.name.toLowerCase());
  return { id, files: accepted.filter(isBlank).map((file) => ({ ...file, bytes: copyOut(file.bytes) })) };
}

export async function readCatalogPartFiles(input, context, deps) {
  const kind = String(input?.kind || "");
  const pattern = PART_FILE_KINDS[kind];
  if (!pattern) throw refusal("kind");

  const manifest = input?.manifest;
  const id = String(manifest?.id || "");
  if (!PACKAGE_ID.test(id) || !manifest?.version) throw refusal("noPackage");

  const job = { input, context, deps, manifest, id };
  return kind === "arena-blank" ? readArenaBlanks(job) : readPlainKind({ ...job, pattern });
}
