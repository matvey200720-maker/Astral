import { modWeapons } from "./search-concepts.js";
import { isSoundMod } from "./sound-packs.js";

const NO_VOICE = "SOUND_VOICE";
const NOT_DOWNLOADED = "SOUND_FETCH";

// Тексты отказов: язык окна → сообщение. Нет такого языка — английский.
const NO_VOICE_TEXT = {
  ru: "У этих стволов нет своего голоса в игре — мастерской звуков нечего открыть.",
  uk: "У цих стволів немає власного голосу в грі — майстерні звуків нічого відкрити.",
  en: "These weapons have no voice of their own in the game — the sound workshop has nothing to open.",
  de: "Diese Waffen haben im Spiel keine eigene Stimme — die Sound-Werkstatt kann nichts öffnen.",
  pl: "Ta broń nie ma w grze własnego głosu — warsztat dźwięków nie ma czego otworzyć.",
  fr: "Ces armes n’ont pas de voix propre dans le jeu — l’atelier de sons n’a rien à ouvrir.",
};

const NOT_DOWNLOADED_TEXT = {
  ru: "Звук не скачался. Проверьте соединение и нажмите ещё раз.",
  uk: "Звук не завантажився. Перевірте з’єднання і натисніть ще раз.",
  en: "The sound did not download. Check your connection and try again.",
  de: "Der Sound wurde nicht geladen. Prüfe die Verbindung und versuche es erneut.",
  pl: "Dźwięk się nie pobrał. Sprawdź połączenie i spróbuj ponownie.",
  fr: "Le son n’a pas pu être téléchargé. Vérifiez votre connexion et réessayez.",
};

const NAME_LIMIT = 72;
const FILE_EXTENSION = ".wav";
const DEFAULT_TYPE = "audio/wav";
const UNKNOWN_TYPE = "application/octet-stream";

function refusal(code, locale) {
  const texts = code === NO_VOICE ? NO_VOICE_TEXT : NOT_DOWNLOADED_TEXT;
  // Язык ищется среди собственных ключей и читается вторым обращением: так видно снаружи.
  const error = new Error(Object.hasOwn(texts, locale) ? texts[locale] : texts.en);
  error.code = code;
  return error;
}

function isPack(mod) {
  return mod.includedModIds?.length > 0;
}

// Адрес первой записи с непустой строкой; пустая строка — звука нет.
function firstAudioUrl(mod) {
  const clips = mod.audio;
  if (!Array.isArray(clips)) return "";
  for (const clip of clips) {
    const url = clip?.url;
    if (typeof url === "string" && url !== "") return url;
  }
  return "";
}

export function isEditableSound(mod) {
  if (!isSoundMod(mod) || isPack(mod)) return false;
  return modWeapons(mod).length > 0 && firstAudioUrl(mod) !== "";
}

// Тяжёлые соседи грузятся только по кнопке «Редактировать», все сразу.
async function loadNeighbours() {
  const [studio, knobs, importer, model, editors, memory] = await Promise.all([
    import("@modovik/sound-studio"),
    import("@modovik/sound-studio/sound-knobs"),
    import("../../components/desktop/workshop/sound/sound-kit-import.js"),
    import("../../components/desktop/workshop/sound/sound-kit-model.js"),
    import("../workshop/useWorkshopEditors.jsx"),
    import("../../section-memory.js"),
  ]);
  return {
    weaponHasVoice: studio.weaponHasVoice,
    voiceMap: studio.WEAPON_SOUND_MAP,
    fxDefaults: knobs.FX_DEFAULTS,
    importKitSound: importer.importKitSound,
    loadSoundKit: model.loadSoundKit,
    storeSoundKit: model.storeSoundKit,
    presetWorkshopEditor: editors.presetWorkshopEditor,
    remember: memory.remember,
  };
}

// Названный ствол берётся, если он есть у мода и у него есть голос; иначе первый со своим голосом.
function pickWeapon(mod, wanted, { weaponHasVoice, voiceMap }) {
  const ofMod = modWeapons(mod);
  const voiced = (id) => weaponHasVoice(voiceMap[id]);
  if (wanted && ofMod.includes(wanted) && voiced(wanted)) return wanted;
  return ofMod.find(voiced);
}

async function readSoundFile(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("bad response");
  return response.blob();
}

// Сбой запроса, статус не ok и сбой чтения тела — один и тот же отказ; исходная ошибка не сохраняется.
async function downloadSound(url, locale) {
  try {
    return await readSoundFile(url);
  } catch {
    throw refusal(NOT_DOWNLOADED, locale);
  }
}

function fileBaseName(rawName) {
  return rawName
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_LIMIT);
}

function studioFile(mod, blob) {
  const baseName = fileBaseName(String(mod.name || "sound"));
  const declared = blob.type;
  const type = declared && declared !== UNKNOWN_TYPE ? declared : DEFAULT_TYPE;
  return new File([blob], baseName + FILE_EXTENSION, { type });
}

// Новая правка: копия прочитанной; запись выбранного ствола заменяется целиком.
function draftWith(current, weapon, imported, fxDefaults) {
  const entry = {
    source: imported.source,
    preset: "",
    fx: { ...fxDefaults, trimStart: imported.trimStart, trimEnd: imported.trimEnd },
  };
  return {
    ...current,
    tab: "weapons",
    weapon,
    weapons: { ...current.weapons, [weapon]: entry },
  };
}

// Студия при запуске читает память раздела раньше сохранённого черновика.
function rememberTarget(remember, weapon) {
  remember("sound-kit:tab", "weapons");
  remember("sound-kit:weapon", weapon);
  remember("sound-kit:tool", "source");
}

export async function openSoundInWorkshop(mod, options = {}) {
  const { navigate, locale = "ru", weapon = "", returnPage = "detail" } = options;
  const kit = await loadNeighbours();

  const picked = pickWeapon(mod, weapon, kit);
  if (!picked) throw refusal(NO_VOICE, locale);

  const blob = await downloadSound(firstAudioUrl(mod), locale);
  const file = studioFile(mod, blob);
  const imported = await kit.importKitSound([file]);

  const current = kit.loadSoundKit();
  kit.storeSoundKit(draftWith(current, picked, imported, kit.fxDefaults));
  rememberTarget(kit.remember, picked);

  const opened = kit.presetWorkshopEditor(
    { slotId: "weapon-sounds", section: "sounds" },
    { locale, returnPage },
  );
  if (!opened) return false;

  navigate("workshop");
  return true;
}
