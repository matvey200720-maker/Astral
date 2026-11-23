// Собственные .glb человека: файл лежит в хранилище мастерской под ключом из SHA-256,
// а короткий список записей (хеш, имя, профиль, место) — в localStorage.
import { forgetModelThumbnail } from "./gun-images.js";
import { customModelHash, createCustomModel } from "@modovik/gun-studio";
import * as assets from "../workshop-assets.js";
import { tr } from "../../../../locales/ui.js";

const OWN_MODELS_KEY = "astral.gun-studio.own-models.v1";

const ownModels = (profileId, storage = globalThis.localStorage) =>
  Array.from(new RowBook(storage).select(forProfile(profileId)), toRegistryEntry);

const storeOwnModel = async (file, { profile, slot }, storage = globalThis.localStorage) => {
  const prepared = await assets.prepareWorkshopAsset(file, { extensions: new Set(["glb"]) });
  const { hash } = prepared.metadata;
  await assets.putWorkshopAsset(assetKey(hash), new Blob([prepared.blob], { type: GLB_MIME }));

  const book = new RowBook(storage);
  const fresh = { hash, name: file.name.replace(LAST_EXTENSION, ""), profile, slot };
  book.replace(book.without(hash, profile).concat([fresh]));
  return toRegistryEntry(fresh);
};

const resolveOwnModelUrl = async (entry) => {
  const hash = customModelHash(entry);
  return hash ? (issuedUrls.get(hash) ?? mintUrl(hash)) : entry?.url || "";
};

const removeOwnModel = async (entry, profile, storage = globalThis.localStorage) => {
  const hash = customModelHash(entry);
  if (!hash) return;

  const book = new RowBook(storage);
  const rest = book.without(hash, profile);
  book.replace(rest);
  if (rest.findIndex(holdsHash(hash)) === -1) await purgeFiles(hash, entry.key);
};

// Список записей в localStorage. Порча (не массив, чужой JSON, записи без хеша) молча теряется.
class RowBook {
  #storage;

  constructor(storage) {
    this.#storage = storage;
  }

  all() {
    const parsed = this.#parse();
    return Array.isArray(parsed) ? parsed.filter(hasValidHash) : [];
  }

  *select(test) {
    for (const row of this.all()) {
      if (test(row)) yield row;
    }
  }

  without(hash, profile) {
    const owned = isOwnedBy(hash, profile);
    return Array.from(this.select((row) => !owned(row)));
  }

  replace(rows) {
    try {
      this.#storage.setItem(OWN_MODELS_KEY, JSON.stringify(rows));
    } catch {
      // переполнение или нет хранилища: список просто не обновится
    }
  }

  #parse() {
    try {
      return JSON.parse(this.#storage.getItem(OWN_MODELS_KEY) || "[]");
    } catch {
      return null;
    }
  }
}

async function mintUrl(hash) {
  const blob = await assets.getWorkshopAsset(assetKey(hash));
  if (!blob) throw new Error(tr(MISSING_FILE_TEXT));
  const url = URL.createObjectURL(blob);
  issuedUrls.set(hash, url);
  return url;
}

// Модель больше никем не занята: адрес отзывается, файл и снимок плитки стираются.
async function purgeFiles(hash, thumbnailKey) {
  if (issuedUrls.has(hash)) {
    URL.revokeObjectURL(issuedUrls.get(hash));
    issuedUrls.delete(hash);
  }
  const jobs = [() => assets.deleteWorkshopAsset(assetKey(hash)), () => forgetModelThumbnail(thumbnailKey)];
  for (const job of jobs) {
    try {
      await job();
    } catch {
      // файл или снимок остались — не страшно
    }
  }
}

function toRegistryEntry({ name, slot, hash }) {
  return createCustomModel({ name, slot, hash });
}

const assetKey = (hash) => `gunmodel:${hash}`;
const hasValidHash = (row) => HASH_PATTERN.test(String(row?.hash));
const forProfile = (profile) => (row) => row.profile === profile;
const holdsHash = (hash) => (row) => row.hash === hash;
const isOwnedBy = (hash, profile) => (row) => row.hash === hash && row.profile === profile;

const GLB_MIME = "model/gltf-binary";
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const LAST_EXTENSION = /\.[^.]*$/;
const MISSING_FILE_TEXT = "Файла этой модели на компьютере больше нет — принеси .glb заново.";

// Адреса, уже сделанные в этом окне: хеш -> blob:-адрес.
const issuedUrls = new Map();

export { OWN_MODELS_KEY, ownModels, removeOwnModel, resolveOwnModelUrl, storeOwnModel };
