import * as provisioner from "./loader-provisioner.js";
import * as studioModule from "./gunpack-studio.js";
import * as install from "./gunpack-install.js";
import * as inbox from "./gunpack-catalog.js";
import * as glb from "./gunpack-glb.js";
import * as fromCatalog from "./gunpack-from-catalog.js";
import * as looks from "./attachment-looks.js";

const NO_CATALOG = "Каталог недоступен в этой сборке.";
const NO_GAME_READER = "Обвесы из игры читает Astral Desktop.";

const PICKER_GROUPS = [
  ["Ганпак", "rar zip 7z oiv rpf ydr ytd yft"],
  ["Все файлы", "*"],
];

const pickerOptions = () => ({
  title: "Ганпак: архив, dlc.rpf или файлы стволов",
  properties: ["openFile", "multiSelections"],
  filters: PICKER_GROUPS.map(([name, list]) => ({
    name,
    extensions: list.split(" "),
  })),
});

// Одно обещание на всех ждущих; отказ и пустой ответ не запоминаются.
class OnceBuilder {
  #make;
  #current = null;

  constructor(make) {
    this.#make = make;
  }

  get() {
    if (this.#current) return this.#current;
    const run = this.#make();
    const drop = () => {
      if (this.#current === run) this.#current = null;
    };
    run.then((value) => {
      if (!value) drop();
    }, drop);
    this.#current = run;
    return run;
  }
}

// Умолчание только для undefined, как у параметра функции.
const withDefault = (value, fallback) =>
  value === undefined ? fallback : value;

const isBytes = (value) =>
  value instanceof Uint8Array || value instanceof ArrayBuffer;
const textOf = (value) => (value ? String(value) : "");

// Кадр приходит без JSON-копии, поэтому разбирается отдельно.
function frameArguments(frame) {
  if (!frame || typeof frame !== "object") throw new TypeError("Нет кадра.");
  if (!isBytes(frame.bytes)) throw new TypeError("Кадр должен прийти байтами.");
  return {
    packId: textOf(frame.packId),
    key: textOf(frame.key),
    bytes:
      frame.bytes instanceof ArrayBuffer
        ? new Uint8Array(frame.bytes)
        : frame.bytes,
    meta: { length: Number(frame.meta?.length) || 0 },
  };
}

export function registerGunpackStudioIpc({ IPC, ...rest }) {
  const { handleIpc, trusted, safeInput, installOptions, dialog } = rest;
  const writeDependencies = withDefault(rest.writeDependencies, () => ({}));
  const catalogPackages = withDefault(rest.catalogPackages, null);
  const gameAttachmentFiles = withDefault(rest.gameAttachmentFiles, null);
  const createStudio = withDefault(
    rest.createStudio,
    studioModule.createGunpackStudio,
  );

  const stateDirOf = async () => (await installOptions()).stateDir;
  const builder = new OnceBuilder(async () => {
    const { stateDir } = await installOptions();
    return createStudio({
      stateDir,
      keysDirectory: () => provisioner.archiveKeysDirectory({ stateDir }),
    });
  });
  const studio = () => builder.get();
  const onStudio = (action) => async (input) => action(await studio(), input);
  // Копия входа и выбранные поля; чего нет — undefined.
  const take = (input, ...names) => {
    const source = safeInput(input);
    return Object.fromEntries(names.map((name) => [name, source[name]]));
  };

  const resolveLooks = looks.createLooksResolver({
    installOptions,
    catalogPackages,
  });

  const gameFiles = async (request) => {
    if (!gameAttachmentFiles) throw new Error(NO_GAME_READER);
    return gameAttachmentFiles(request, await stateDirOf());
  };

  // Запись «пак стоит в игре» верна, пока движок не ответил строго false.
  const vouch = async (s, pack) => {
    if (!pack || !pack.installed) return pack;
    const stateDir = await stateDirOf();
    if ((await install.gunpackInstalled(pack.installed, stateDir)) !== false)
      return pack;
    // если стереть запись не вышло, окну это не важно
    await s.setInstalled(pack.id, null).catch(() => {});
    return Object.fromEntries(
      Object.entries(pack).filter(([name]) => name !== "installed"),
    );
  };

  const writeToGame = (operation) =>
    onStudio(async (s, input) => {
      const request = await resolveLooks(safeInput(input));
      const stateDir = await stateDirOf();
      const target = String(request.targetId || "default");
      return operation(request, stateDir, {
        ...writeDependencies(target),
        studio: s,
        gameFiles,
      });
    });

  const handlers = {
    WORKSHOP_GUNPACK_STUDIO_LIST: onStudio(async (s) => {
      const packs = (await s.list()).map((pack) => vouch(s, pack));
      return Promise.all(packs);
    }),
    WORKSHOP_GUNPACK_STUDIO_CHOOSE: async () => {
      const answer = await dialog.showOpenDialog(pickerOptions());
      return answer.canceled ? null : { paths: answer.filePaths };
    },
    WORKSHOP_GUNPACK_STUDIO_OPEN: onStudio(async (s, input) =>
      vouch(s, await s.open(take(input, "paths"))),
    ),
    WORKSHOP_GUNPACK_STUDIO_READ: onStudio((s, input) =>
      s.read(take(input, "packId", "paths")),
    ),
    WORKSHOP_GUNPACK_STUDIO_SAVE_SHOT: onStudio((s, frame) =>
      s.saveShot(frameArguments(frame)),
    ),
    WORKSHOP_GUNPACK_STUDIO_SHOTS: onStudio((s, input) =>
      s.shots(take(input, "packId")),
    ),
    WORKSHOP_GUNPACK_STUDIO_SET_LOOK: onStudio((s, input) =>
      s.setLook(take(input, "packId", "key", "look")),
    ),
    WORKSHOP_GUNPACK_STUDIO_COMPOSE: onStudio((s, input) =>
      s.compose(safeInput(input)),
    ),
    WORKSHOP_GUNPACK_STUDIO_REMOVE: onStudio((s, input) =>
      s.remove(take(input, "packId")),
    ),
    WORKSHOP_GUNPACK_STUDIO_TO_INBOX: onStudio(async (s, input) => {
      const request = safeInput(input);
      return inbox.gunpackToInbox(request, await stateDirOf(), { studio: s });
    }),
    WORKSHOP_GUNPACK_STUDIO_MODEL: onStudio(async (s, input) => {
      const request = await resolveLooks(safeInput(input));
      return glb.packWeaponGlb(request, { studio: s, gameFiles });
    }),
    WORKSHOP_GUNPACK_STUDIO_FROM_CATALOG: onStudio(async (s, input) => {
      if (!catalogPackages) throw new Error(NO_CATALOG);
      const { stateDir, downloadsDir } = await installOptions();
      const trust = catalogPackages();
      const request = safeInput(input);
      const publicKey = await trust.publicKey();
      const pack = await fromCatalog.takeCatalogWeapon(request, {
        studio: s,
        stateDir,
        downloadsDir,
        publicKey,
        allowedHosts: trust.allowedHosts,
        allowInsecureLocalhost: trust.allowInsecureLocalhost,
      });
      return vouch(s, pack);
    }),
    WORKSHOP_APPLY_GUNPACK: writeToGame(install.applyGunpack),
    WORKSHOP_REMOVE_GUNPACK: writeToGame(install.removeGunpack),
    WORKSHOP_REMOVE_GUNPACK_MODEL: writeToGame(install.removeGunpackModel),
    WORKSHOP_APPLY_PACK_SKIN: writeToGame(install.applyPackSkin),
    WORKSHOP_REMOVE_PACK_SKIN: writeToGame(install.removePackSkin),
  };

  for (const [key, handler] of Object.entries(handlers)) {
    handleIpc(IPC[key], (event, input) => trusted(event, () => handler(input)));
  }

  return { studio };
}
