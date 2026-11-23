/*
 * Писатель клипов `.ycd` на JS (ТЗ 29.10-d, установка замены): клип словаря-цели начинает играть анимации клипа словаря-источника.
 *
 * Анимацию не пересобирают из каналов — её переносят как есть. У анимации нет ничего, кроме трёх указателей: заголовок на 96 байт
 * ведёт к списку блоков последовательностей и к списку дорожек костей, а сами блоки (заголовок на 32 байта и данные каналов) указателей
 * не содержат. Поэтому перенос — это копия этих кусков в хвост системной области цели и три новых указателя; значения каналов и их
 * сжатие (в том числе кэшированные кватернионы, которых писатель каналов не умеет) доезжают байт в байт.
 *
 * Правит файл цели в считанных местах: указатель анимации клипа (или массив записей клипа-списка), его время и скорость, запись карты
 * анимаций, что вела к прежней анимации, и блок страниц корня. Исходные блоки не двигаются (как у `ycd_write.rs` движка: «старые блоки
 * не перепаковываются»), прежняя анимация остаётся в файле мёртвым грузом, остальные клипы — исходные байты. Новый хвост лежит в одной
 * системной странице (флаги `1 << 17` и сдвиг по размеру) — игра читает такие файлы, так собран выход движка и правок `.ytd`.
 *
 * Формат — по `native/astral-engine/crates/rage-res/src/ycd.rs`, `ycd_pose.rs`, `ycd_write.rs`; круг запись → чтение сверяется в
 * `tests/ycd-graft.test.js` движком (`sample-anim-pose`, `read-uv-clips`).
 */

import zlib from "node:zlib";

const RSC7_MAGIC = 0x37435352;
const HEADER_BYTES = 16;
const YCD_VERSION = 46;
const SYSTEM_BASE = 0x5000_0000;
const MAX_RESOURCE = 256 * 1024 * 1024;

/* Смещения (ycd_pose.rs, ycd_write.rs). */
const ROOT_PAGES = 0x08;
const ROOT_ANIM_MAP = 0x18;
const ROOT_CLIPS = 0x28;
const ROOT_CLIPS_CAP = 0x30;
const MAP_BUCKETS = 0x18;
const MAP_CAP = 0x20;
const ENTRY_POINTER = 0x08;
const ENTRY_NEXT = 0x10;
const CLIP_TYPE = 0x10;
const CLIP_NAME = 0x18;
const CLIP_NAME_LENGTH = 0x20;
const CLIP_ANIMATION = 0x50;
const CLIP_START = 0x58;
const CLIP_END = 0x5c;
const CLIP_RATE = 0x60;
const CLIP_SINGLE = 1;
const CLIP_LIST = 2;
/* Клип-список: число и ёмкость записей (u16 и u16), длительность клипа, записи по 24 байта (начало, конец, скорость, слово, указатель). */
const LIST_COUNT = 0x58;
const LIST_CAPACITY = 0x5a;
const LIST_DURATION = 0x60;
const LIST_ENTRY_BYTES = 0x18;
const LIST_ENTRY_START = 0x00;
const LIST_ENTRY_END = 0x04;
const LIST_ENTRY_RATE = 0x08;
const LIST_ENTRY_ANIMATION = 0x10;
const MAX_LIST_ENTRIES = 16;
const ANIMATION_BYTES = 96;
const ANIM_FRAMES = 0x14;
const ANIM_LIMIT = 0x16;
const ANIM_DURATION = 0x18;
const ANIM_SEQUENCES = 0x40;
const ANIM_SEQUENCE_COUNT = 0x48;
const ANIM_BONES = 0x50;
const ANIM_BONE_COUNT = 0x58;
const SEQ_DATA_LENGTH = 4;
const SEQ_HEADER = 32;
const PAGES_BYTES = 24;
const MAX_CHAIN = 4096;
const MAX_SEQUENCE = 64 * 1024 * 1024;

/** Дорожки кости: 0 — смещение, 1 — поворот, 5 и 6 — движение корня (мувер), 17 и 18 — UV. */
export const TRACK = Object.freeze({ translation: 0, rotation: 1, moverTranslation: 5, moverRotation: 6 });

const refusal = (code, message) => Object.assign(new Error(message), { code });

/** Длина области по флагам заголовка RSC7 (`resource.rs`, `page_flag_size`). */
export function pageFlagSize(flags) {
  const counts =
    ((flags >>> 27) & 1) +
    (((flags >>> 26) & 1) << 1) +
    (((flags >>> 25) & 1) << 2) +
    (((flags >>> 24) & 1) << 3) +
    (((flags >>> 17) & 0x7f) << 4) +
    (((flags >>> 11) & 0x3f) << 5) +
    (((flags >>> 7) & 0xf) << 6) +
    (((flags >>> 5) & 3) << 7) +
    (((flags >>> 4) & 1) << 8);
  return (0x200 << (flags & 0xf)) * counts;
}

/** Флаги одной страницы на `size` байт и её длина; `null`, если больше самой большой (`ytd_edit.rs`). */
function singlePageFlags(versionNibble, size) {
  for (let shift = 0; shift <= 15; shift += 1) {
    const page = 0x2000 * 2 ** shift;
    if (page >= size) return { flags: ((versionNibble << 28) | (1 << 17) | shift) >>> 0, page };
  }
  return null;
}

const align16 = (value) => (value + 15) & ~15;

/** Разобранный словарь: распакованная системная область и флаги заголовка. */
export function parseDictionary(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < HEADER_BYTES || bytes.readUInt32LE(0) !== RSC7_MAGIC)
    throw refusal("YCD_NOT_RESOURCE", "Это не ресурс RSC7: словарь клипов не разобрать.");
  const systemFlags = bytes.readUInt32LE(8);
  const graphicsFlags = bytes.readUInt32LE(12);
  const version = (((systemFlags >>> 28) & 0xf) << 4) + ((graphicsFlags >>> 28) & 0xf);
  if (version !== YCD_VERSION) throw refusal("YCD_VERSION", `Это не словарь клипов (версия ресурса ${version}, нужна ${YCD_VERSION}).`);
  const systemSize = pageFlagSize(systemFlags);
  if (pageFlagSize(graphicsFlags) !== 0) throw refusal("YCD_GRAPHICS", "У словаря клипов не бывает графической части.");
  if (systemSize < 64 || systemSize > MAX_RESOURCE) throw refusal("YCD_SIZE", "Размеры словаря клипов невозможны.");
  let data;
  try {
    data = zlib.inflateRawSync(bytes.subarray(HEADER_BYTES), { maxOutputLength: systemSize + 1 });
  } catch (error) {
    if (error?.code === "ERR_BUFFER_TOO_LARGE") throw refusal("YCD_SIZE", "Поток словаря клипов длиннее заявленного.");
    throw refusal("YCD_BROKEN", "Поток словаря клипов не распаковался.");
  }
  if (data.length < systemSize) throw refusal("YCD_BROKEN", "Словарь клипов обрезан: правка отменена.");
  const sys = data.subarray(0, systemSize);
  /* VFT корня у сборок игры разные (0x40570818 в корпусе движка, 0x40572828 у свежих дополнений): по нему словарь не опознать. */
  if (sys.readUInt32LE(4) !== 1) throw refusal("YCD_BROKEN", "Корень файла — не словарь клипов.");
  return { sys, systemFlags, graphicsFlags, declaredVersion: bytes.readUInt32LE(4) };
}

/* Указатель на системную область: смещение или `null`. */
function pointerAt(sys, at) {
  if (at < 0 || at + 8 > sys.length) throw refusal("YCD_BROKEN", "Указатель вне словаря клипов.");
  const low = sys.readUInt32LE(at);
  const high = sys.readUInt32LE(at + 4);
  if (low === 0 && high === 0) return null;
  if (high !== 0 || low < SYSTEM_BASE || low - SYSTEM_BASE >= sys.length) throw refusal("YCD_BROKEN", "Указатель словаря клипов ведёт не в системную область.");
  return low - SYSTEM_BASE;
}

function u16(sys, at) {
  if (at < 0 || at + 2 > sys.length) throw refusal("YCD_BROKEN", "Чтение за концом словаря клипов.");
  return sys.readUInt16LE(at);
}

function u32(sys, at) {
  if (at < 0 || at + 4 > sys.length) throw refusal("YCD_BROKEN", "Чтение за концом словаря клипов.");
  return sys.readUInt32LE(at);
}

function f32(sys, at) {
  if (at < 0 || at + 4 > sys.length) throw refusal("YCD_BROKEN", "Чтение за концом словаря клипов.");
  return sys.readFloatLE(at);
}

/** Записи карты (корзины с цепочками): `[{ entry, hash, pointer }]`. */
function mapEntries(sys, bucketsAt, capacity) {
  const out = [];
  if (bucketsAt === null) return out;
  for (let bucket = 0; bucket < capacity; bucket += 1) {
    let entry = pointerAt(sys, bucketsAt + bucket * 8);
    let guard = 0;
    while (entry !== null) {
      guard += 1;
      if (guard > MAX_CHAIN) throw refusal("YCD_BROKEN", "Цепочка карты словаря клипов слишком длинная.");
      out.push({ entry, hash: u32(sys, entry), pointer: pointerAt(sys, entry + ENTRY_POINTER) });
      entry = pointerAt(sys, entry + ENTRY_NEXT);
    }
  }
  return out;
}

function clipName(sys, clip) {
  const length = u16(sys, clip + CLIP_NAME_LENGTH);
  const at = pointerAt(sys, clip + CLIP_NAME);
  if (!length || at === null || at + length > sys.length) return null;
  return sys.toString("utf8", at, at + length);
}

/* Короткое имя, как `ClipBase.ShortName`: без пути и расширения, строчными. */
function shortName(full) {
  if (!full) return null;
  const normalized = full.replaceAll("\\", "/");
  const slash = normalized.lastIndexOf("/");
  let name = slash >= 0 && slash < normalized.length - 1 ? normalized.slice(slash + 1) : normalized;
  const dot = name.indexOf(".");
  if (dot > 0) name = name.slice(0, dot);
  return name ? name.toLowerCase() : null;
}

/** Клипы словаря: `[{ at, name, short, type }]`. */
export function listClips(dictionary) {
  const { sys } = dictionary;
  const buckets = pointerAt(sys, ROOT_CLIPS);
  const capacity = u16(sys, ROOT_CLIPS_CAP);
  return mapEntries(sys, buckets, capacity)
    .filter((item) => item.pointer !== null)
    .map((item) => {
      const name = clipName(sys, item.pointer);
      return { at: item.pointer, name, short: shortName(name), type: u32(sys, item.pointer + CLIP_TYPE) };
    });
}

/** Клип по короткому или полному имени без учёта регистра. */
export function findClip(dictionary, wanted) {
  const key = String(wanted || "").toLowerCase();
  const found = listClips(dictionary).find((clip) => clip.short === key || (clip.name || "").toLowerCase() === key);
  if (!found) throw refusal("YCD_NO_CLIP", `В словаре нет клипа «${wanted}».`);
  return found;
}

/**
 * Устройство клипа. Одиночный клип несёт одну анимацию и время прямо в себе. Клип-список — массив записей по 24 байта, число и
 * ёмкость записей в клипе, длительность на 0x60. У эмоций из дополнений игры тело — список из двух анимаций: одна ведёт корень и
 * мелкие дорожки, вторая — повороты костей; играют вместе.
 */

/** Анимация по смещению заголовка: кадры, дорожки костей и блоки последовательностей — как лежат в файле. */
function readAnimationAt(sys, at) {
  if (at === null || at + ANIMATION_BYTES > sys.length) throw refusal("YCD_BROKEN", "Анимация за концом словаря клипов.");
  const frames = u16(sys, at + ANIM_FRAMES);
  const limit = u16(sys, at + ANIM_LIMIT);
  const duration = f32(sys, at + ANIM_DURATION);
  const boneCount = u16(sys, at + ANIM_BONE_COUNT);
  const bonesAt = boneCount ? pointerAt(sys, at + ANIM_BONES) : null;
  if (boneCount && (bonesAt === null || bonesAt + boneCount * 4 > sys.length)) throw refusal("YCD_BROKEN", "Список дорожек анимации вне словаря.");
  const bones = [];
  for (let index = 0; index < boneCount; index += 1) {
    const base = bonesAt + index * 4;
    bones.push({ bone: u16(sys, base), unk: sys[base + 2], track: sys[base + 3] });
  }
  const sequenceCount = u16(sys, at + ANIM_SEQUENCE_COUNT);
  const listAt = sequenceCount ? pointerAt(sys, at + ANIM_SEQUENCES) : null;
  if (sequenceCount && listAt === null) throw refusal("YCD_BROKEN", "У анимации нет блоков последовательностей.");
  const sequences = [];
  for (let index = 0; index < sequenceCount; index += 1) {
    const block = pointerAt(sys, listAt + index * 8);
    if (block === null) throw refusal("YCD_BROKEN", "Пустой блок последовательности.");
    const length = SEQ_HEADER + u32(sys, block + SEQ_DATA_LENGTH);
    if (length > MAX_SEQUENCE || block + length > sys.length) throw refusal("YCD_BROKEN", "Блок последовательности вне словаря.");
    sequences.push({ at: block, length });
  }
  return { at, frames, limit, duration, bones, boneCount, bonesAt, sequences };
}

/**
 * Клип целиком: вид, длительность и записи (`entries`) — у каждой анимация, начало, конец и скорость. Для списка у записи ещё `raw`
 * (её 24 байта как есть).
 */
export function readClip(dictionary, clip) {
  const { sys } = dictionary;
  if (clip.type === CLIP_SINGLE) {
    const at = pointerAt(sys, clip.at + CLIP_ANIMATION);
    const start = f32(sys, clip.at + CLIP_START);
    const end = f32(sys, clip.at + CLIP_END);
    return {
      kind: "single",
      at: clip.at,
      duration: Math.max(0, end - start),
      entries: [{ animation: readAnimationAt(sys, at), start, end, rate: f32(sys, clip.at + CLIP_RATE), raw: null }],
    };
  }
  if (clip.type === CLIP_LIST) {
    const count = u16(sys, clip.at + LIST_COUNT);
    const listAt = pointerAt(sys, clip.at + CLIP_ANIMATION);
    if (!count || count > MAX_LIST_ENTRIES || listAt === null || listAt + count * LIST_ENTRY_BYTES > sys.length)
      throw refusal("YCD_BROKEN", "У клипа-списка нет записей.");
    const entries = [];
    for (let index = 0; index < count; index += 1) {
      const base = listAt + index * LIST_ENTRY_BYTES;
      entries.push({
        animation: readAnimationAt(sys, pointerAt(sys, base + LIST_ENTRY_ANIMATION)),
        start: f32(sys, base + LIST_ENTRY_START),
        end: f32(sys, base + LIST_ENTRY_END),
        rate: f32(sys, base + LIST_ENTRY_RATE),
        raw: Buffer.from(sys.subarray(base, base + LIST_ENTRY_BYTES)),
      });
    }
    return { kind: "list", at: clip.at, duration: f32(sys, clip.at + LIST_DURATION), entries };
  }
  throw refusal("YCD_CLIP_TYPE", "У клипа нет анимации костей (не одиночный клип и не список).");
}

/* Кости клипа с поворотом по всем записям: по ним видно, что это анимация тела человека. */
const bodyBones = (clip) => {
  const seen = new Map();
  for (const entry of clip.entries)
    for (const item of entry.animation.bones) if (item.track === TRACK.rotation && item.bone !== 0) seen.set(item.bone, item);
  return [...seen.values()];
};

const hasMover = (clip) =>
  clip.entries.some((entry) => entry.animation.bones.some((item) => item.track === TRACK.moverTranslation || item.track === TRACK.moverRotation));

const clipSeconds = (clip) => (clip.duration > 0 ? clip.duration : Math.max(0, ...clip.entries.map((entry) => entry.animation.duration)));

/**
 * Проверка пары до записи. `pedBones` — теги костей скелета человека (`mp_m_freemode_01`), если известны: по ним видно, что обе
 * анимации — человека, а не предмета или камеры. Возвращает `{ errors, warnings, facts }`; с ошибкой писать нельзя.
 */
export function checkGraft(target, source, { pedBones = null, requireBody = true } = {}) {
  /* Строки — для журнала и тестов; коды (`errorCodes`, `noteCodes`) — окну: оно говорит на языке человека и числа вставляет само. */
  const errors = [];
  const errorCodes = [];
  const warnings = [];
  const noteCodes = [];
  const fail = (code, text) => {
    errors.push(text);
    errorCodes.push(code);
  };
  const note = (code, text) => {
    warnings.push(text);
    noteCodes.push(code);
  };
  const targetBody = bodyBones(target);
  const sourceBody = bodyBones(source);
  const frames = Math.max(...source.entries.map((entry) => entry.animation.frames));
  const sourceLength = clipSeconds(source);
  if (frames < 2 || !(sourceLength > 0.05) || sourceLength > 600) fail("duration", "Длительность анимации-источника невозможна.");
  if (source.entries.some((entry) => !entry.animation.sequences.length)) fail("sequences", "У анимации-источника нет данных кадров.");
  if (requireBody && sourceBody.length < 8) fail("source-not-body", "Источник — не анимация тела человека (меньше восьми костей с поворотом).");
  if (requireBody && targetBody.length < 8) fail("target-not-body", "Цель — не анимация тела человека (меньше восьми костей с поворотом): так заменять нельзя.");
  if (target.kind === "single" && source.entries.length > 1)
    fail("layers", "Источник — клип из нескольких анимаций, а цель — одиночный клип: слоёв не хватит.");
  if (requireBody && pedBones) {
    const known = new Set(pedBones);
    const share = (list) => (list.length ? list.filter((item) => known.has(item.bone)).length / list.length : 0);
    if (share(sourceBody) < 0.8) fail("ped-source", "Кости источника не из скелета человека игры.");
    if (share(targetBody) < 0.8) fail("ped-target", "Кости цели не из скелета человека игры.");
  }
  const targetSet = new Set(targetBody.map((item) => item.bone));
  const missing = sourceBody.filter((item) => !targetSet.has(item.bone)).length;
  if (missing && targetBody.length >= 8)
    note("missing-bones", `В целевой анимации не двигаются ${missing} из ${sourceBody.length} костей источника: игра их не покажет (бывает у анимаций верхней части тела).`);
  const targetLength = clipSeconds(target);
  if (targetLength > 0 && sourceLength > 0) {
    const ratio = sourceLength / targetLength;
    if (ratio > 2.5 || ratio < 0.4)
      note("duration", `Длительность отличается в ${ratio >= 1 ? ratio.toFixed(1) : (1 / ratio).toFixed(1)} раза (${sourceLength.toFixed(1)} с вместо ${targetLength.toFixed(1)} с): скрипт сервера считает по прежней.`);
  }
  if (hasMover(source) && !hasMover(target)) note("mover", "У источника есть движение корня, у цели нет: персонаж может уехать с места.");
  return {
    errors,
    errorCodes,
    warnings,
    noteCodes,
    facts: { targetBones: targetBody.length, sourceBones: sourceBody.length, missingBones: missing, targetSeconds: targetLength, sourceSeconds: sourceLength, frames },
  };
}

class Tail {
  constructor(sys) {
    this.parts = [Buffer.from(sys)];
    this.length = sys.length;
  }

  /** Блок в хвост с выравниванием на 16; возвращает смещение. */
  put(bytes) {
    const at = align16(this.length);
    if (at > this.length) {
      this.parts.push(Buffer.alloc(at - this.length));
      this.length = at;
    }
    this.parts.push(Buffer.from(bytes));
    this.length += bytes.length;
    return at;
  }

  buffer() {
    return Buffer.concat(this.parts, this.length);
  }
}

const pointerBytes = (offsets) => {
  const out = Buffer.alloc(offsets.length * 8);
  offsets.forEach((offset, index) => out.writeUInt32LE(SYSTEM_BASE + offset, index * 8));
  return out;
};

/* Анимация источника в хвост цели: блоки последовательностей, их список, дорожки костей и заголовок с тремя новыми указателями. */
function copyAnimation(tail, from, animation) {
  const sequenceOffsets = animation.sequences.map((block) => tail.put(from.sys.subarray(block.at, block.at + block.length)));
  const sequenceList = tail.put(pointerBytes(sequenceOffsets));
  const boneList = animation.boneCount ? tail.put(from.sys.subarray(animation.bonesAt, animation.bonesAt + animation.boneCount * 4)) : null;
  const header = Buffer.from(from.sys.subarray(animation.at, animation.at + ANIMATION_BYTES));
  header.writeUInt32LE(SYSTEM_BASE + sequenceList, ANIM_SEQUENCES);
  header.writeUInt32LE(0, ANIM_SEQUENCES + 4);
  if (boneList !== null) {
    header.writeUInt32LE(SYSTEM_BASE + boneList, ANIM_BONES);
    header.writeUInt32LE(0, ANIM_BONES + 4);
  }
  return tail.put(header);
}

/**
 * Клип `targetClip` словаря `target` играет анимации клипа `sourceClip` словаря `source`. Возвращает `{ bytes, report }`: файл RSC7
 * нового словаря и сведения проверки. Цель и источник — разные байты или один словарь (клип на клип внутри файла).
 *
 * Одиночный клип ← одиночный: анимация, начало, конец и скорость в самом клипе. Список ← список или одиночный: записи источника
 * кладутся новым массивом (число записей — как у источника), клип получает его указатель, число записей и длительность. Одиночный
 * клип ← список из нескольких анимаций не ставится: слоёв ему не хватит.
 */
export function graftClip({ target, targetClip, source, sourceClip, pedBones = null, requireBody = true }) {
  const into = parseDictionary(target);
  const from = target === source ? into : parseDictionary(source);
  const clip = findClip(into, targetClip);
  const donor = findClip(from, sourceClip);
  const before = readClip(into, clip);
  const donated = readClip(from, donor);
  const report = checkGraft(before, donated, { pedBones, requireBody });
  if (report.errors.length) throw Object.assign(refusal("YCD_INCOMPATIBLE", report.errors[0]), { report });

  const tail = new Tail(into.sys);
  const animations = donated.entries.map((entry) => copyAnimation(tail, from, entry.animation));
  /* Новый массив записей клипа-списка: записи источника как есть (4 слова, начало, конец, скорость), указатель — на скопированную анимацию. */
  let entriesAt = null;
  if (before.kind === "list") {
    const array = Buffer.alloc(donated.entries.length * LIST_ENTRY_BYTES);
    donated.entries.forEach((entry, index) => {
      const base = index * LIST_ENTRY_BYTES;
      if (entry.raw) entry.raw.copy(array, base);
      else {
        array.writeFloatLE(entry.start, base + LIST_ENTRY_START);
        array.writeFloatLE(entry.end, base + LIST_ENTRY_END);
        array.writeFloatLE(entry.rate, base + LIST_ENTRY_RATE);
      }
      array.writeUInt32LE(SYSTEM_BASE + animations[index], base + LIST_ENTRY_ANIMATION);
      array.writeUInt32LE(0, base + LIST_ENTRY_ANIMATION + 4);
    });
    entriesAt = tail.put(array);
  }

  /* Блок страниц корня — как у `pack` движка: одна системная страница на весь файл. */
  const pages = Buffer.alloc(PAGES_BYTES);
  pages[8] = 1;
  const pagesAt = tail.put(pages);
  const out = tail.buffer();
  const setPointer = (at, offset) => {
    out.writeUInt32LE(SYSTEM_BASE + offset, at);
    out.writeUInt32LE(0, at + 4);
  };
  setPointer(ROOT_PAGES, pagesAt);

  if (before.kind === "single") {
    const only = donated.entries[0];
    setPointer(clip.at + CLIP_ANIMATION, animations[0]);
    out.writeFloatLE(only.start, clip.at + CLIP_START);
    out.writeFloatLE(only.end, clip.at + CLIP_END);
    out.writeFloatLE(only.rate, clip.at + CLIP_RATE);
  } else {
    setPointer(clip.at + CLIP_ANIMATION, entriesAt);
    out.writeUInt16LE(donated.entries.length, clip.at + LIST_COUNT);
    out.writeUInt16LE(donated.entries.length, clip.at + LIST_CAPACITY);
    out.writeFloatLE(donated.duration > 0 ? donated.duration : Math.max(...donated.entries.map((entry) => entry.end - entry.start)), clip.at + LIST_DURATION);
  }

  /* Карта анимаций: запись, что вела к прежней анимации, ведёт к новой с тем же номером (клип ходит к анимации по указателю, карта — по хешу). */
  const map = pointerAt(into.sys, ROOT_ANIM_MAP);
  let remapped = 0;
  if (map !== null) {
    const entries = mapEntries(into.sys, pointerAt(into.sys, map + MAP_BUCKETS), u16(into.sys, map + MAP_CAP));
    before.entries.forEach((old, index) => {
      const replacement = animations[Math.min(index, animations.length - 1)];
      for (const entry of entries.filter((item) => item.pointer === old.animation.at)) {
        setPointer(entry.entry + ENTRY_POINTER, replacement);
        remapped += 1;
      }
    });
  }

  const total = align16(out.length);
  const padded = Buffer.alloc(total);
  out.copy(padded);
  const sized = singlePageFlags(into.systemFlags >>> 28, total);
  if (!sized) throw refusal("YCD_SIZE", "Словарь клипов больше одной страницы системной области.");
  const body = Buffer.concat([padded, Buffer.alloc(sized.page - total)]);
  const deflated = zlib.deflateRawSync(body, { level: 9 });
  const file = Buffer.alloc(HEADER_BYTES);
  file.writeUInt32LE(RSC7_MAGIC, 0);
  file.writeUInt32LE(YCD_VERSION, 4);
  file.writeUInt32LE(sized.flags, 8);
  file.writeUInt32LE(into.graphicsFlags, 12);
  return {
    bytes: Buffer.concat([file, deflated]),
    report: {
      ...report,
      remappedEntries: remapped,
      addedBytes: total - into.sys.length,
      layers: donated.entries.length,
      kind: before.kind,
    },
  };
}

/** Короткие имена клипов словаря (по возрастанию) — для сводки и проверок. */
export function clipNames(bytes) {
  return listClips(parseDictionary(bytes))
    .map((clip) => clip.short || clip.name)
    .filter(Boolean)
    .sort((a, b) => a.toUpperCase().localeCompare(b.toUpperCase()));
}

/** Сколько анимаций (слоёв) у клипа: у одиночного одна, у списка — по числу записей. */
export function layerCount(bytes, name) {
  const dictionary = parseDictionary(bytes);
  const clip = findClip(dictionary, name);
  return clip.type === CLIP_LIST ? Math.min(u16(dictionary.sys, clip.at + LIST_COUNT), MAX_LIST_ENTRIES) : 1;
}

/**
 * Словарь для чтения слоя: запись `index` клипа-списка стоит в массиве первой (две записи меняются местами, остальные байты те же).
 * Движок снимает позу только первой записи клипа; со словарём «вторая запись первой» предпросмотр собирает все слои эмоции
 * (`animation-track.js`). Играть игрой такой файл не должен — в игру он не ставится.
 */
export function layerDictionary(bytes, name, index) {
  const dictionary = parseDictionary(bytes);
  const clip = findClip(dictionary, name);
  if (clip.type !== CLIP_LIST) throw refusal("YCD_CLIP_TYPE", `Клип «${name}» — не список анимаций, слоёв у него нет.`);
  const count = u16(dictionary.sys, clip.at + LIST_COUNT);
  if (!Number.isInteger(index) || index < 1 || index >= Math.min(count, MAX_LIST_ENTRIES)) throw refusal("YCD_NO_CLIP", `У клипа «${name}» нет записи ${index}.`);
  const sys = Buffer.from(dictionary.sys);
  const listAt = pointerAt(sys, clip.at + CLIP_ANIMATION);
  if (listAt === null || listAt + count * LIST_ENTRY_BYTES > sys.length) throw refusal("YCD_BROKEN", "У клипа-списка нет записей.");
  const head = Buffer.from(sys.subarray(listAt, listAt + LIST_ENTRY_BYTES));
  sys.copy(sys, listAt, listAt + index * LIST_ENTRY_BYTES, listAt + (index + 1) * LIST_ENTRY_BYTES);
  head.copy(sys, listAt + index * LIST_ENTRY_BYTES);
  return Buffer.concat([bytes.subarray(0, HEADER_BYTES), zlib.deflateRawSync(sys, { level: 6 })]);
}

/** Сведения о клипе для окна и проверок: вид, длительность, число записей и костей тела. */
export function describeClip(bytes, name) {
  const dictionary = parseDictionary(bytes);
  const clip = readClip(dictionary, findClip(dictionary, name));
  return {
    kind: clip.kind,
    seconds: clipSeconds(clip),
    layers: clip.entries.length,
    bodyBones: bodyBones(clip).length,
    frames: Math.max(...clip.entries.map((entry) => entry.animation.frames)),
  };
}
