import { createGameReadHost } from "./game-read-host.js";

const READER_MODULE = new URL("./game-archive-reader.js", import.meta.url).href;
const READER_FUNCTION = "readerCall";
// Порядок ключей результата openGameOffThread.
const METHOD_NAMES = ["verify", "has", "sizeOf", "read", "list", "close"];

let hostSlot = null;

// Хозяин потока один на модуль, создаётся при первом обращении;
// если создание бросило, слот остаётся пустым и следующий вызов пробует снова.
function sharedHost() {
  return (hostSlot ??= createGameReadHost({ module: READER_MODULE }));
}

// Байты из потока приходят видом Uint8Array: оборачиваем в Buffer над той же памятью.
function asBuffer(reply) {
  return Buffer.from(reply.buffer, reply.byteOffset, reply.byteLength);
}

class OffThreadReader {
  #gameRoot;
  #keysDirectory;

  constructor(gameRoot, keysDirectory) {
    this.#gameRoot = gameRoot;
    this.#keysDirectory = keysDirectory;
  }

  #call(method, args) {
    return sharedHost().call(READER_FUNCTION, this.#gameRoot, this.#keysDirectory, method, args);
  }

  verify() {
    return this.#call("verify", []);
  }

  has(at) {
    return this.#call("has", [at]);
  }

  sizeOf(at) {
    return this.#call("sizeOf", [at]);
  }

  async read(at) {
    const reply = await this.#call("read", [at]);
    return reply ? asBuffer(reply) : null;
  }

  list(at) {
    return this.#call("list", [at]);
  }

  close() {
    return this.#call("close", []);
  }
}

export function openGameOffThread(gameRoot, keysDirectory = "") {
  const reader = new OffThreadReader(gameRoot, keysDirectory);
  return Object.fromEntries(METHOD_NAMES.map((name) => [name, reader[name].bind(reader)]));
}
