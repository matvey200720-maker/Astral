/*
 * Штатные листы ядра, которые Astral перекрасил.
 *
 * Окружение правит текстуры самой игры, а база для правки читается из игры —
 * где после первой установки лежит уже перекрашенный лист. Вторая установка
 * красила бы крашеное: оттенок копился, яркость уползала, а «вернуть как было»
 * не существовало вовсе — выключенное семейство так и оставалось синим.
 *
 * Поэтому перед первой правкой листа его штатные байты откладываются сюда, а
 * рядом запоминается отпечаток того, что Astral записал вместо них, и настройка
 * семейства, которой лист перекрашен. Дальше:
 *
 *   • лист в игре совпал с записанным — он наш, и базой служит отложенный
 *     оригинал: сколько ни переустанавливай, красится штатный лист;
 *   • не совпал — игру трогал кто-то ещё (редукс, откат, обновление): базой
 *     становится то, что лежит в игре, а прежний оригинал забывается;
 *   • семейство выключили, а лист всё ещё наш — оригинал возвращается в ядро.
 *
 * Под покраской может лежать лист карточки каталога («наш Core», слой текстуры
 * ядра игрока). Его кладёт сборщик ядра (`ptfx-player-core.js`), и он же держит
 * покраску сверху: настройкой из хранилища красит лист карточки, а у записи
 * помнит чистый лист — тот, что был под карточкой (`plain`), с отпечатком его
 * покраски и имя карточки. Сняли карточку — под покраской снова чистый лист.
 * «Убрать огонь» гасит лист целиком, и покраска карточки и чистого листа
 * совпадает: стоит ли карточка, мастерская узнаёт у движка (`installed`).
 *
 * Хранилище живёт в папке состояния приложения, по отпечатку пути к игре. Оно
 * меняется только после удавшейся установки: план и проверка патча его не
 * трогают.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";

const pack = promisify(gzip);
const unpack = promisify(gunzip);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const INDEX_FILE = "index.json";
const STORE_VERSION = 1;
const TEXTURE_NAME = /^[a-z0-9_]{1,64}$/i;

export function originalsDirectory(stateDir, gameRoot) {
  const key = sha256(path.resolve(String(gameRoot)).toLowerCase()).slice(0, 16);
  return path.join(path.resolve(stateDir), "ptfx-originals", key);
}

const layoutOf = (texture) => ({
  width: texture.width,
  height: texture.height,
  levels: texture.levels,
  format: texture.format,
});

const sameLayout = (left, right) =>
  left.width === right.width &&
  left.height === right.height &&
  left.levels === right.levels &&
  left.format === right.format;

async function readIndex(directory) {
  try {
    const parsed = JSON.parse(
      await fs.readFile(path.join(directory, INDEX_FILE), "utf8"),
    );
    if (parsed?.version !== STORE_VERSION || !parsed.textures) return {};
    return parsed.textures;
  } catch {
    /* Нет хранилища или оно нечитаемо — оригиналов просто нет. */
    return {};
  }
}

/**
 * Открывает хранилище оригиналов установки.
 *
 * Возвращает три действия; ни одно из них не пишет на диск до `commit()`.
 */
export async function openOriginals(stateDir, gameRoot, { installed = null } = {}) {
  const directory = originalsDirectory(stateDir, gameRoot);
  const index = await readIndex(directory);
  /* name → { payload, entry } к записи; name → null к забыванию. */
  const pending = new Map();

  const key = (name) => String(name).toLowerCase();

  async function readPayload(file, expected) {
    try {
      const payload = await unpack(await fs.readFile(path.join(directory, file)));
      if (sha256(payload) !== expected) return null;
      return new Uint8Array(payload.buffer, payload.byteOffset, payload.length);
    } catch {
      return null;
    }
  }

  async function storedOriginal(texture) {
    const entry = index[key(texture.name)];
    if (!entry || !texture.payload) return null;
    if (!sameLayout(entry, layoutOf(texture))) return null;
    const live = sha256(texture.payload);
    const plain = () => readPayload(entry.plain.file, entry.plain.sha);
    /* Карточки из-под покраски уже нет (движок так говорит) — оригинал её чистый лист. */
    if (entry.plain && installed && !installed.has(entry.plain.layer) && [entry.writtenSha, entry.plain.writtenSha].includes(live))
      return plain();
    if (entry.writtenSha === live) return readPayload(entry.file, entry.originalSha);
    /* В игре покраска чистого листа: карточку сняли без сборки ядра. */
    if (entry.plain?.writtenSha === live) return plain();
    return null;
  }

  return {
    directory,
    /** Имена листов, про которые хранилище что-то помнит. */
    known: () => Object.keys(index),
    /**
     * Штатные байты листа: отложенный оригинал, если в игре лежит наша правка,
     * иначе то, что в игре. `ours` — лежит ли в игре именно наша правка;
     * `settings` — настройка семейства, которой она сделана (у записей до 29.10 нет).
     */
    async baseFor(texture) {
      const original = await storedOriginal(texture);
      const settings = index[key(texture.name)]?.settings;
      return original
        ? { payload: original, ours: true, ...(settings ? { settings } : {}) }
        : { payload: texture.payload, ours: false };
    },
    /**
     * Покраска листа целиком — для сборщика ядра игрока: настройка, отпечаток записанного, лист под покраской
     * (`original`) и, если под ней карточка каталога, чистый лист (`plain`) с отпечатком его покраски. Совпадения с
     * игрой не требует: сборщик сверяет отпечатки с основой сам. `null` — лист не красится или запись без настройки.
     */
    async paint(texture) {
      const entry = index[key(texture.name)];
      if (!entry?.settings || !sameLayout(entry, layoutOf(texture))) return null;
      const original = await readPayload(entry.file, entry.originalSha);
      if (!original) return null;
      const plain = entry.plain ? await readPayload(entry.plain.file, entry.plain.sha) : null;
      return {
        settings: entry.settings,
        writtenSha: entry.writtenSha,
        original,
        ...(plain ? { plain, plainWrittenSha: entry.plain.writtenSha } : {}),
      };
    },
    /** Отпечаток записей листов — для отпечатка сборки ядра (покраска меняет его байты). */
    describe(names) {
      return names
        .map((name) => [key(name), index[key(name)]])
        .filter(([, entry]) => entry)
        .map(([name, entry]) => ({ name, originalSha: entry.originalSha, writtenSha: entry.writtenSha, settings: entry.settings ?? null, plain: entry.plain?.writtenSha ?? null }));
    },
    /**
     * Лист перекрашен: запомнить оригинал, отпечаток записанного и настройку; `plain` — `{ payload, writtenSha,
     * layer }` чистого листа, когда под покраской карточка каталога `layer`.
     */
    stage(texture, originalPayload, writtenPayload, settings = null, plain = null) {
      if (!TEXTURE_NAME.test(texture.name)) return;
      pending.set(key(texture.name), {
        payload: originalPayload,
        ...(plain ? { plainPayload: plain.payload } : {}),
        entry: {
          ...layoutOf(texture),
          file: `${key(texture.name)}.bin.gz`,
          originalSha: sha256(originalPayload),
          writtenSha: sha256(writtenPayload),
          ...(settings && typeof settings === "object" ? { settings: { ...settings } } : {}),
          ...(plain
            ? { plain: { file: `${key(texture.name)}.plain.bin.gz`, sha: sha256(plain.payload), writtenSha: plain.writtenSha, layer: String(plain.layer || "") } }
            : {}),
        },
      });
    },
    /** Лист возвращён штатным или больше не наш: забыть оригинал. */
    release(name) {
      pending.set(key(name), null);
    },
    /** Применить отложенное — после того как установка удалась. */
    async commit() {
      if (!pending.size) return;
      await fs.mkdir(directory, { recursive: true });
      const next = { ...index };
      for (const [name, change] of pending) {
        if (!change) {
          const gone = next[name];
          delete next[name];
          for (const file of [gone?.file, gone?.plain?.file].filter(Boolean))
            await fs.rm(path.join(directory, file), { force: true }).catch(() => {});
          continue;
        }
        await fs.writeFile(
          path.join(directory, change.entry.file),
          await pack(Buffer.from(change.payload)),
        );
        if (change.plainPayload)
          await fs.writeFile(path.join(directory, change.entry.plain.file), await pack(Buffer.from(change.plainPayload)));
        else if (next[name]?.plain?.file)
          await fs.rm(path.join(directory, next[name].plain.file), { force: true }).catch(() => {});
        next[name] = change.entry;
      }
      const temporary = path.join(directory, `${INDEX_FILE}.tmp`);
      await fs.writeFile(
        temporary,
        `${JSON.stringify({ version: STORE_VERSION, textures: next }, null, 2)}\n`,
      );
      await fs.rename(temporary, path.join(directory, INDEX_FILE));
      pending.clear();
    },
  };
}
