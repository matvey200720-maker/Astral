/*
 * Ствол без своих выстрелов — тишина на выстреле игрока, чужие слышны (владелец, 30.10.2026: «отключить звуки от себя, звуки стрельбы, чтобы от других там было слышно»).
 *
 * ПОЧЕМУ ЭТО РЕАЛЬНО. Свой звук ствола (`weapon-voice-plan.js`) уже ставится только игроку: предмет звука `AUDIO_ITEM_*` переопределяется копией, где строка категории `player` ведёт на копию
 * настроек, а запасные настройки и строки других категорий остаются прежними — по ним стреляют NPC и, как мы считаем, другие игроки. Тишина — та же копия настроек, где поля выстрела ведут на
 * `null_sound`. Звуковых деревьев, голоса и банка у неё нет: личный банк не нужен, `BankSound` остаётся банком игры, и всё, что играет банк ствола, не трогается.
 *
 * ЧТО ГЛУШИТСЯ (`WEAPON_MUTE_FIELDS`): все поля выстрела (обычный, очередью, с глушителем, замедленный и сверхзамедленный — `WEAPON_SHOT_FIELDS`, и «втягивание» перед замедленным —
 * `Presuck`), отзвук, эхо и слой помещения (`WEAPON_AFTERSHOT_FIELDS`). ЧТО ОСТАЁТСЯ: гильза, перезарядка, щелчок пустого магазина, взять и убрать ствол, удар пули о цель, анимации — всё,
 * что не выстрел.
 *
 * Чужие файлы не меняются: пакет Astral пишет два объекта звуковых метаданных (копия настроек игрока и предмет звука), общие банки (`RESIDENT`, `WEAPONS_PLAYER`) и деревья игры не тронуты.
 *
 * Модуль только для главного процесса (подпуть `@modovik/sound-studio/weapon-mute-plan`).
 */

import { hexHash, joaat } from "./rel-edit.js";
import {
  WEAPON_AFTERSHOT_FIELDS,
  WEAPON_SHOT_FIELDS,
  WEAPON_SOUND_FIELDS,
} from "./weapon-voice-plan.js";

/**
 * Способ, которым ставится тишина (формат пакета): 1 — поля выстрела игрока на `null_sound`, без своего банка и деревьев. Окно узнаёт о нём из `listSoundWorks().formats.weaponMute`; запись установки
 * хранит общий `WEAPON_SOUND_FORMAT`, поэтому менять устройство тишины — поднимать и его: по нему студия переставляет работы (`refreshOutdatedSoundKit`).
 */
export const WEAPON_MUTE_FORMAT = 1;

export const NULL_SOUND = joaat("null_sound");

/* Звук, который игра играет перед замедленным выстрелом («втягивание»), — часть выстрела: без глушения он звучал бы один. */
export const WEAPON_MUTE_PRESUCK_FIELDS = Object.freeze([
  "SlowMoFireSoundPresuck",
  "SlowMoSuppressedFireSoundPresuck",
  "SuperSlowMoFireSoundPresuck",
  "SuperSlowMoSuppressedFireSoundPresuck",
]);

/** Все поля настроек игрока, что глушит тишина: выстрел, его «втягивание», отзвук, эхо и слой помещения. */
export const WEAPON_MUTE_FIELDS = Object.freeze([
  ...WEAPON_SHOT_FIELDS,
  ...WEAPON_MUTE_PRESUCK_FIELDS,
  ...WEAPON_AFTERSHOT_FIELDS,
]);

const FIELD_OFFSET = new Map(WEAPON_SOUND_FIELDS);
const SHOT = new Set(WEAPON_SHOT_FIELDS);

/** Имя копии настроек: своё у каждого ствола и стабильное между сборками; не то, что у голоса (`astral_snd_…`) и связи глушителя. */
export const muteHash = (slug, original) =>
  joaat(`astral_mute_${String(slug).toLowerCase()}_${hexHash(original)}`);

/**
 * Копия настроек игрока ствола с тишиной на выстреле и предмет звука, где строка игрока ведёт на эту копию.
 *
 * @param {ReturnType<import("./weapon-voice-plan.js").mergeAudioChunks>} merged
 * @param {object} input
 * @param {string} input.slug  ствол (`assaultrifle`)
 * @param {ReturnType<import("./weapon-voice-plan.js").weaponAudio>} input.audio  действующие настройки игрока ствола
 * @returns {{ settings: object, item: object, fields: Array<{field: string, from: number, to: number}>, stays: string[] }}
 *   `settings` и `item` — объекты для звукового пакета (`hash`, `bytes`, `links`, `packs`); `fields` — какие поля заглушены; `stays` — поля с звуком, что остались (гильза, перезарядка…)
 */
export function planWeaponMute(merged, { slug, audio }) {
  const copy = muteHash(slug, audio.settings.hash);
  if (merged.game(copy))
    throw new Error(`Имя копии настроек ${hexHash(copy)} уже занято в настройках игры.`);
  const settings = Buffer.from(audio.settings.bytes);
  const fields = [];
  for (const field of WEAPON_MUTE_FIELDS) {
    const offset = FIELD_OFFSET.get(field);
    if (offset === undefined || offset + 4 > settings.length) continue;
    const from = settings.readUInt32LE(offset);
    /* Пустое поле и уже тихое трогать нечего: у пистолета `AutoSound` — заглушка игры, она остаётся. */
    if (!from || from === NULL_SOUND) continue;
    settings.writeUInt32LE(NULL_SOUND, offset);
    fields.push({ field, from, to: NULL_SOUND });
  }
  if (!fields.some((item) => SHOT.has(item.field)))
    throw new Error("У ствола в этой игре нет звука выстрела — глушить нечего.");
  const itemObject = merged.game(audio.item);
  if (!itemObject || itemObject.bytes.readUInt32LE(audio.playerAt) !== audio.settings.hash)
    throw new Error("Предмет звука ствола в этой игре устроен иначе — обновите Astral.");
  const item = Buffer.from(itemObject.bytes);
  item.writeUInt32LE(copy, audio.playerAt);
  const silenced = new Set(fields.map((item) => item.field));
  const stays = [];
  for (const [field, offset] of WEAPON_SOUND_FIELDS) {
    if (silenced.has(field) || offset + 4 > settings.length) continue;
    const value = settings.readUInt32LE(offset);
    if (value && value !== NULL_SOUND) stays.push(field);
  }
  return {
    settings: { hash: copy, bytes: settings, links: audio.settings.links, packs: audio.settings.packs },
    item: { hash: audio.item, bytes: item, links: itemObject.links, packs: itemObject.packs },
    fields,
    stays,
  };
}
