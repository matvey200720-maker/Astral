import { installPackSkin, uninstallPackSkin } from "../../../../components/desktop/workshop/gunpack/gunpack-bridge.js";
import { PACK_SKIN_INSTALLS_KEY } from "./pack-skin-key.js";
import { lookMemo } from "./look-memo.js";
import { createSkinInstalls as openSkinMemory } from "./skin-installs.js";

export { PACK_SKIN_INSTALLS_KEY };

// Ступень текстур грузится лениво: при каждой установке и каждом снятии.
const refreshTextures = async (report) => {
  const { refreshTexturesAfterWeaponWork } = await import("./textures.js");
  return refreshTexturesAfterWeaponWork(report);
};

// Память покраски: одна запись на ключ pack:<пак>:<вариант>:<ствол>.
const memory = openSkinMemory({
  storageKey: PACK_SKIN_INSTALLS_KEY,
  idPattern: /^local-gunpack-/,
  apply: installPackSkin,
  remove: uninstallPackSkin,
  after: refreshTextures,
});

// Умолчания настроек (действуют только для undefined); изменяемые значения делаются заново.
const FALLBACKS = {
  decorations: () => [],
  decorationImages: () => ({}),
  paintPieces: () => [],
  attachments: () => null,
  looks: () => null,
  scale: () => 1,
};
const HEAD_FIELDS = ["packId", "variantKey", "model", "name", "textures"];

// Поля, которые едут в мост только при условии: [поля, условие].
const OPTIONAL = [
  [["decorations", "decorationImages"], ({ decorations }) => decorations.length],
  [["paintPieces"], ({ paintPieces }) => paintPieces.length],
  [["attachments"], ({ attachments }) => attachments],
  [["looks"], ({ looks }) => looks && Object.keys(looks).length],
  [["scale"], ({ scale }) => scale !== 1],
];
// Тяжёлое и восстановимое в память не кладётся.
const FORGOTTEN = new Set(["textures", "decorationImages", "paintPieces", "looks"]);

const pickFields = (source, names) => Object.fromEntries(names.map((name) => [name, source[name]]));

export function installPackSkinWork(options) {
  const given = Object.fromEntries(
    Object.entries(FALLBACKS).map(([field, make]) => [field, options[field] === undefined ? make() : options[field]]),
  );
  const chosen = OPTIONAL.filter(([, applies]) => applies(given)).flatMap(([fields]) => fields);
  const request = { ...pickFields(options, HEAD_FIELDS), ...pickFields(given, chosen) };

  const memo = pickFields(request, Object.keys(request).filter((field) => !FORGOTTEN.has(field)));
  // Вид из каталога помнится как мод и версия, в конце записи.
  if (chosen.includes("looks")) memo.looks = lookMemo(request.looks);

  return memory.install({ ...pickFields(options, ["key", "state", "report"]), request, memo });
}

export function packSkinKey({ packId, variantKey, model }) {
  return ["pack", packId, variantKey, model].map(String).join(":");
}

export const {
  installOf: packSkinInstallOf,
  subscribe: subscribePackSkinInstalls,
  uninstall: removePackSkinInstall,
} = memory;
