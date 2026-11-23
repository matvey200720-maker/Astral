// Разбор ствола из пака: байты файлов берутся у моста окна и уходят в общий Worker,
// ответ ищет свой запрос по номеру. Кэша моделей нет: каждый вызов читает заново.
import { tr } from "../../../../locales/ui.js";
import { readPackFiles } from "./gunpack-bridge.js";

export async function loadWeaponModel(packId, weapon, { maxTexture = DEFAULT_MAX_TEXTURE } = {}) {
  const wanted = pickParsedFiles(weapon);
  const answer = await readPackFiles(
    packId,
    wanted.map(({ path }) => path),
  );
  return desk.submit(withBytes(wanted, indexByPath(answer)), maxTexture);
}

// Записи описи с ролями, которые понимает разбор, в порядке описи.
function pickParsedFiles(weapon) {
  const wanted = weapon.files.filter(({ role }) => PARSED_ROLES.has(role));
  if (wanted.length === 0) throw new Error(tr("У ствола нет модели в паке."));
  return wanted;
}

// Ответ моста -> «путь -> байты»; при повторе пути побеждает последний.
function indexByPath(answer) {
  const index = new Map();
  for (const { path, bytes } of answer) index.set(path, bytes);
  return index;
}

const withBytes = (wanted, index) =>
  wanted.map(({ name, role, path }) => ({ name, role, bytes: index.get(path) }));

// Окно держит один Worker разбора и общий счётчик номеров запросов.
class ParseDesk {
  #worker = null;
  #lastId = 0;
  #waiting = new Map();

  submit(files, maxTexture) {
    return new Promise((resolve, reject) => {
      const id = ++this.#lastId;
      const worker = this.#workerOrNew();
      this.#waiting.set(id, { resolve, reject });
      const buffers = new Set(files.map((file) => file.bytes.buffer));
      worker.postMessage({ id, files, maxTexture }, [...buffers]);
    });
  }

  #workerOrNew() {
    if (this.#worker === null) {
      const worker = new Worker(new URL("./gunpack-model-worker.js", import.meta.url), { type: "module" });
      worker.onmessage = this.#handleReply;
      worker.onerror = this.#handleCrash;
      this.#worker = worker;
    }
    return this.#worker;
  }

  #handleReply = ({ data }) => {
    const request = this.#waiting.get(data.id);
    if (request === undefined) return;
    this.#waiting.delete(data.id);
    if (!data.ok) {
      request.reject(Object.assign(new Error(data.message), { code: data.code }));
      return;
    }
    request.resolve(data);
  };

  #handleCrash = (event) => {
    for (const { reject } of this.#waiting.values()) {
      reject(new Error(event.message || tr("Разбор модели упал.")));
    }
    this.#waiting.clear();
    this.#worker?.terminate();
    this.#worker = null;
  };
}

const DEFAULT_MAX_TEXTURE = 1024;
const PARSED_ROLES = new Set(["model", "model-hi", "texture", "texture-hi"]);
const desk = new ParseDesk();
