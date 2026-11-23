/*
 * Свой голос одного ствола — переопределением в пакете Astral.
 *
 * КАК ЗВУЧИТ СТВОЛ В ИГРЕ. `weapons.meta` → `AUDIO_ITEM_*` (dat151
 * `ItemAudioSettings`) → настройки игрока (`WeaponSettings`) → поля звуков
 * (`AutoSound` у автомата, `FireSound` у полуавтомата, замедленная стрельба,
 * глушитель, `BankSound`…) → деревья dat54 → листья-дорожки. Банк ствола
 * игра грузит по `BankSound` в слот оружия игрока (PLAYER_WEAPON, 383 588
 * байт). Деревья и банки общие: у штурмовой винтовки, булл-папа, улучшенной и
 * марксманской одни ветви и дорожки, и замена дорожки меняла звук у всех.
 *
 * ПОЧЕМУ ПЕРЕОПРЕДЕЛЕНИЕ, А НЕ ПРАВКА. Звуковые метаданные игры — не один
 * файл: база в update.rpf и файлы каждого пакета дополнения, и объект с тем
 * же именем в более позднем пакете заменяет прежний. Сама Rockstar так и
 * правит оружие: настройки карабина лежат в базе, в patchday3ng и в mpreplay
 * (обновление звука оружия), и действует последняя копия — у неё есть звук
 * сверхзамедленной съёмки, которого в базе нет (сверено 26.09.2026). Поэтому
 * правка базового файла у большинства стволов не значила бы ничего, а
 * пакет Astral, который грузится последним, переопределяет ровно настройки
 * выбранного ствола — как это делают пакеты самой игры.
 *
 * ЧТО ПОЛУЧАЕТ СТВОЛ. В пакете Astral:
 *   • свой предмет звука — копию действующего `AUDIO_ITEM_*`, где строка
 *     игрока ведёт на копию настроек, а запасные настройки и строки других
 *     категорий остаются прежними. Переопределять сами настройки по имени
 *     нельзя: у электрошокера настройки игрока — они же запасные, по ним
 *     стреляют NPC и другие игроки, и их выстрел ушёл бы в личный банк,
 *     которого у них нет (сверено 26.09.2026 по всем предметам игры);
 *   • копию своих действующих настроек игрока под своим именем — поля
 *     выстрела ведут на копии деревьев, поля отзвука, эха и слоя помещения
 *     — на тишину (`null_sound`), `BankSound` — на личный банк;
 *   • свой звук во ВСЕХ полях выстрела (владелец, 27.09.2026: «меняется и
 *     на глушители — полностью на оружие»): где у игры в дереве нет голоса
 *     ствола (выстрел с глушителем, одиночный выстрел автомата, замедленная
 *     съёмка с глушителем — общие слои RESIDENT), поле ведёт на свой звук
 *     того же вида — очередь на копию очереди ствола, одиночный на один его
 *     выстрел — с заголовком поля игры: категория и фильтры глушителя
 *     оставляют его тише и ближе, как у игры;
 *   • копии деревьев выстрела, где звучит только голос ствола: в каждом
 *     наборе одновременных слоёв остаётся одна пара голоса (левая и правая
 *     дорожки), остальные слои — сухой щелчок, низкий удар, хвосты RESIDENT,
 *     задержанные копии голоса — уходят; у случайного выбора каждый вариант
 *     ведёт на голос. Тон дерева обнуляется — свой звук играет со своей
 *     скоростью, а не на октаву выше, как голос штурмовой винтовки; громкость
 *     — как у самого громкого слоя игры в этом дереве;
 *   • нетронутые копии ветвей без голоса, которые играют банк ствола
 *     (перезарядка револьвера и двустволки):
 *     банк в слоте оружия теперь личный, и без копий они замолчали бы;
 *   • личный банк `DLC_ASTRAL_AUDIO\<СТВОЛ>` — дорожки голоса со своим звуком
 *     и дорожки таких ветвей, перенесённые из банка ствола как есть.
 * Так после выстрела не доигрывает звук игры (владелец, 26.09.2026: «у
 * снайперки слышно два звука»), и свой звук не тонет под слоями игры
 * («звук на калаш не применился»). Ни один файл игры не меняется: соседи по
 * банку, NPC и другие игроки звучат как прежде, а снятие — это удаление
 * переопределения.
 *
 * Модуль только для главного процесса (подпуть
 * `@modovik/sound-studio/weapon-voice-plan`): в кусок окна он не попадает.
 */

import {
  bankHash,
  hexHash,
  joaat,
  readRelForWalk,
  relObject,
} from "./rel-edit.js";
import {
  readSoundHeader,
  soundHeaderProblem,
  soundHeaderValue,
  writeSoundHeader,
} from "./sound-header.js";

export const WEAPON_SETTINGS_TYPE = 17;
export const ITEM_AUDIO_SETTINGS_TYPE = 50;
const SIMPLE_SOUND_TYPE = 12;
const RETRIGGERED_OVERLAPPED_TYPE = 9;
const NULL_SOUND = joaat("null_sound");
export const PLAYER_CATEGORY = joaat("player");

/* Пакет Astral со звуком стволов: имя, устройство и волновой пакет. */
export const AUDIO_DLC_NAME = "astral_audio";
export const AUDIO_DLC_WAVEPACK = "DLC_ASTRAL_AUDIO";
export const AUDIO_DLC_GAME_ENTRY = "x64/audio/astral_audio_game.dat151.rel";
export const AUDIO_DLC_SOUNDS_ENTRY = "x64/audio/astral_audio_sounds.dat54.rel";
export const AUDIO_DLC_WAVE_FOLDER = "x64/audio/sfx/dlc_astral_audio/";

/*
 * Поля-звуки `WeaponSettings` и их смещения от начала объекта (раскладка
 * CodeWalker `Dat151WeaponSettings`, сверена с живым game.dat151.rel: 276
 * байт, поля звуков — простые хеши вне таблицы ссылок).
 */
export const WEAPON_SOUND_FIELDS = Object.freeze([
  ["FireSound", 8],
  ["SuppressedFireSound", 12],
  ["AutoSound", 16],
  ["ReportSound", 20],
  ["EchoSound", 36],
  ["SuppressedEchoSound", 40],
  ["ShellCasingSound", 44],
  ["SwipeSound", 48],
  ["GeneralStrikeSound", 52],
  ["PedStrikeSound", 56],
  ["HeftSound", 60],
  ["PutDownSound", 64],
  ["RattleSound", 68],
  ["RattleLandSound", 72],
  ["PickupSound", 76],
  ["SafetyOn", 84],
  ["SafetyOff", 88],
  ["SpecialWeaponSoundSet", 92],
  ["BankSound", 96],
  ["InteriorShotSound", 100],
  ["ReloadSounds", 104],
  ["IntoCoverSound", 108],
  ["OutOfCoverSound", 112],
  ["RattleAimSound", 124],
  ["SmallAnimalStrikeSound", 128],
  ["BigAnimalStrikeSound", 132],
  ["SlowMoFireSound", 136],
  ["HitPedSound", 140],
  ["SlowMoFireSoundPresuck", 144],
  ["SlowMoSuppressedFireSound", 148],
  ["SlowMoSuppressedFireSoundPresuck", 152],
  ["SlowMoReportSound", 156],
  ["SlowMoInteriorShotSound", 160],
  ["SlowMoPedStrikeSound", 164],
  ["SlowMoPedStrikeSoundPresuck", 168],
  ["SlowMoBigAnimalStrikeSound", 172],
  ["SlowMoBigAnimalStrikeSoundPresuck", 176],
  ["SlowMoSmallAnimalStrikeSound", 180],
  ["SlowMoSmallAnimalStrikeSoundPresuck", 184],
  ["SuperSlowMoFireSound", 208],
  ["SuperSlowMoFireSoundPresuck", 212],
  ["SuperSlowMoSuppressedFireSound", 216],
  ["SuperSlowMoSuppressedFireSoundPresuck", 220],
  ["SuperSlowMoReportSound", 224],
  ["SuperSlowMoInteriorShotSound", 228],
  ["SuperSlowMoPedStrikeSound", 232],
  ["SuperSlowMoPedStrikeSoundPresuck", 236],
  ["SuperSlowMoBigAnimalStrikeSound", 240],
  ["SuperSlowMoBigAnimalStrikeSoundPresuck", 244],
  ["SuperSlowMoSmallAnimalStrikeSound", 248],
  ["SuperSlowMoSmallAnimalStrikeSoundPresuck", 252],
]);

const FIELD_OFFSET = new Map(WEAPON_SOUND_FIELDS);

/** Личный банк ствола: имя в таблице, имя банка и запись в пакете Astral. */
export function privateWeaponBank(slug) {
  const clean = String(slug || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_");
  if (!/^[a-z0-9][a-z0-9_]{0,31}$/.test(clean))
    throw new Error(`Недопустимое имя ствола для банка: ${slug}.`);
  return {
    name: `${AUDIO_DLC_WAVEPACK}\\${clean.toUpperCase()}`,
    bank: clean,
    entry: `${AUDIO_DLC_WAVE_FOLDER}${clean}.awc`,
  };
}

/** Имя копии объекта: своё у каждого ствола и стабильное между сборками. */
export const cloneHash = (slug, original) =>
  joaat(`astral_snd_${String(slug).toLowerCase()}_${hexHash(original)}`);

/*
 * Имя нетронутой копии: ветвь без голоса, которая играет банк ствола
 * (перезарядка, выстрел с глушителем), переезжает на личный банк как есть.
 * Имена свои — один узел бывает и в дереве выстрела, и в такой ветви.
 */
export const keepHash = (slug, original) =>
  joaat(`astral_keep_${String(slug).toLowerCase()}_${hexHash(original)}`);

/** Имя новой дорожки голоса (32 бита, как у листа; в AWC — младшие 29). */
export const voiceWaveName = (slug, key) =>
  joaat(`astral_wave_${String(slug).toLowerCase()}_${key}`);

export const streamKey = (container, stream) =>
  `${hexHash(container)}:${hexHash(stream & 0x1fffffff)}`;

/**
 * Звуковые метаданные игры одним видом: файлы в порядке загрузки, и у
 * каждого имени — последняя копия, как её находит игра.
 *
 * @param {Array<{name: string, buffer: Buffer}>} chunks в порядке загрузки
 */
export function mergeAudioChunks(chunks) {
  const dat54 = new Map();
  const dat151 = new Map();
  const names = new Map();
  for (const chunk of chunks) {
    const rel = readRelForWalk(chunk.buffer);
    const into = rel.type === 54 ? dat54 : dat151;
    for (const hash of rel.objects.keys())
      into.set(hash, { chunk: chunk.name, rel });
    for (const name of rel.names) names.set(bankHash(name), name);
  }
  const object = (map, hash) => {
    const place = map.get(hash >>> 0);
    return place ? { ...relObject(place.rel, hash), chunk: place.chunk } : null;
  };
  /* Кто ссылается на звук: обратный граф ссылок, строится при первом
     вопросе. */
  let parents = null;
  const soundParents = (hash) => {
    if (!parents) {
      parents = new Map();
      for (const [parent, place] of dat54) {
        const found = relObject(place.rel, parent);
        for (const at of found.links) {
          const child = found.bytes.readUInt32LE(at) >>> 0;
          if (!parents.has(child)) parents.set(child, new Set());
          parents.get(child).add(parent);
        }
      }
    }
    return [...(parents.get(hash >>> 0) || [])];
  };
  return {
    sound: (hash) => object(dat54, hash),
    game: (hash) => object(dat151, hash),
    bankName: (hash) => names.get(hash >>> 0) || null,
    soundParents,
  };
}

/* Лист: SimpleSound с одним полем банка и именем дорожки за ним. */
export function leafOf(object) {
  if (!object || object.type !== SIMPLE_SOUND_TYPE || object.packs.length !== 1)
    return null;
  const at = object.packs[0];
  if (at + 8 > object.length) return null;
  return {
    containerAt: at,
    container: object.bytes.readUInt32LE(at),
    fileAt: at + 4,
    file: object.bytes.readUInt32LE(at + 4),
    pan: panOf(object),
  };
}

/* Панорама листа из его заголовка: 0 — посередине. */
const panOf = (object) => soundHeaderValue(object.bytes, "pan") ?? 0;

const channelOf = (pan) =>
  pan > 180 && pan < 360 ? "left" : pan > 0 && pan < 180 ? "right" : "mid";

/**
 * Действующие настройки игрока ствола и корни его звуков.
 *
 * Предмет звука (`ItemAudioSettings`): запасные настройки по смещению 4,
 * число строк по 8 и строки `{категория, настройки}` с 12. Игрок — строка
 * категории `player`; без неё игрок стрелял бы запасными настройками, общими
 * с NPC, и свой голос такому стволу не дать.
 */
export function weaponAudio(merged, { item, auto = false }) {
  const itemObject = merged.game(Number(item) >>> 0);
  if (!itemObject || itemObject.type !== ITEM_AUDIO_SETTINGS_TYPE)
    throw new Error(`В настройках игры нет предмета звука ${hexHash(item)}.`);
  const count = itemObject.bytes.readUInt32LE(8);
  let playerAt = 0;
  for (let index = 0; index < count; index += 1) {
    const at = 12 + index * 8;
    if (at + 8 > itemObject.length) break;
    if (itemObject.bytes.readUInt32LE(at) === PLAYER_CATEGORY) playerAt = at + 4;
  }
  if (!playerAt)
    throw new Error(`У предмета ${hexHash(item)} нет своих настроек игрока.`);
  const settingsHash = itemObject.bytes.readUInt32LE(playerAt);
  const settings = merged.game(settingsHash);
  if (!settings || settings.type !== WEAPON_SETTINGS_TYPE)
    throw new Error(
      `У предмета ${hexHash(item)} нет настроек стрельбы игрока.`,
    );
  const roots = {};
  for (const [field, offset] of WEAPON_SOUND_FIELDS) {
    if (offset + 4 > settings.length) continue;
    const value = settings.bytes.readUInt32LE(offset);
    if (value && value !== NULL_SOUND && merged.sound(value)) roots[field] = value;
  }
  const main = auto && roots.AutoSound ? "AutoSound" : "FireSound";
  if (!roots[main])
    throw new Error(`У настроек ${hexHash(settingsHash)} нет звука выстрела.`);
  let bank = null;
  if (roots.BankSound) {
    const leaves = collectLeaves(merged, roots.BankSound);
    bank = leaves[0]?.container ?? null;
  }
  return { item: itemObject.hash, playerAt, settings, roots, main, bank };
}

/* Листья под корнем — с ролью (выстрел/хвост), родителем и каналом. */
function collectLeaves(merged, root) {
  const out = [];
  const seen = new Set();
  const visit = (hash, role, parent) => {
    const object = merged.sound(hash);
    if (!object) return;
    const leaf = leafOf(object);
    if (leaf) {
      out.push({ ...leaf, hash, role, parent, channel: channelOf(leaf.pan) });
      return;
    }
    if (seen.has(hash)) return;
    seen.add(hash);
    const children = object.links.map((at) => object.bytes.readUInt32LE(at));
    if (object.type === RETRIGGERED_OVERLAPPED_TYPE && children.length >= 3) {
      /* Начало, повтор, конец очереди: конец играет хвост. */
      visit(children[0], role, hash);
      visit(children[1], role, hash);
      visit(children[2], "tail", hash);
      for (const child of children.slice(3)) visit(child, role, hash);
      return;
    }
    for (const child of children) visit(child, role, hash);
  };
  visit(root, "shot", 0);
  return out;
}

/**
 * Голос ствола: листья главного корня в его банке и их стерео-пары — соседи
 * по тому же узлу с противоположной панорамой, в каком бы банке они ни были.
 * У ствола без своего банка голос — листья главного корня целиком.
 */
export function weaponVoiceLeaves(merged, audio) {
  const leaves = collectLeaves(merged, audio.roots[audio.main]);
  const voice = new Map();
  const add = (leaf) => {
    const key = streamKey(leaf.container, leaf.file);
    const known = voice.get(key);
    if (known) {
      if (known.role !== leaf.role && leaf.role === "shot") known.role = "shot";
      return;
    }
    voice.set(key, {
      key,
      container: leaf.container,
      stream: hexHash(leaf.file & 0x1fffffff),
      channel: leaf.channel,
      role: leaf.role,
    });
  };
  if (audio.bank === null) {
    for (const leaf of leaves) add(leaf);
  } else {
    for (const leaf of leaves) {
      if (leaf.container !== audio.bank) continue;
      add(leaf);
      for (const other of leaves) {
        if (other.parent !== leaf.parent || other.hash === leaf.hash) continue;
        if (other.container === audio.bank) continue;
        const a = leaf.channel;
        const b = other.channel;
        if (a !== "mid" && b !== "mid" && a !== b) add(other);
      }
    }
  }
  return [...voice.values()].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
}

/* Как узел играет детей: разом, на выбор или по ролям очереди. */
const MULTITRACK_TYPE = 13;
const SIMULTANEOUS_TYPES = new Set([3, 7, 10, 11, MULTITRACK_TYPE, 17]);
const ALTERNATIVE_TYPES = new Set([14, 22, 26]);

/*
 * Поля, которые звучат вокруг выстрела и после него: отзвук вдали, эхо
 * улицы (и после выстрела с глушителем), слой помещения — общие дорожки
 * RESIDENT без голоса ствола, которые игра кладёт поверх выстрела. У своего
 * звука их нет — иначе после него доигрывал бы выстрел игры.
 */
export const WEAPON_AFTERSHOT_FIELDS = Object.freeze([
  "ReportSound",
  "EchoSound",
  "SuppressedEchoSound",
  "InteriorShotSound",
  "SlowMoReportSound",
  "SlowMoInteriorShotSound",
  "SuperSlowMoReportSound",
  "SuperSlowMoInteriorShotSound",
]);
const AFTERSHOT = new Set(WEAPON_AFTERSHOT_FIELDS);

/*
 * Поля самого выстрела: обычный, очередью, с глушителем, замедленный и
 * сверхзамедленный. Свой звук ствола звучит во всех: где в дереве игры есть
 * голос ствола, копия дерева играет только его; где голоса нет (выстрел с
 * глушителем, одиночный выстрел автомата — общие слои RESIDENT), поле ведёт
 * на свой звук того же вида — очередь на очередь, одиночный на одиночный.
 */
export const WEAPON_SHOT_FIELDS = Object.freeze([
  "FireSound",
  "AutoSound",
  "SuppressedFireSound",
  "SlowMoFireSound",
  "SlowMoSuppressedFireSound",
  "SuperSlowMoFireSound",
  "SuperSlowMoSuppressedFireSound",
]);
const SHOT = new Set(WEAPON_SHOT_FIELDS);

/* Узлы, которые играют своего первого ребёнка: огибающая, обёртка,
   блок переменных, преобразование параметра. Сквозь них видно, очередь
   ли это. */
const PASS_THROUGH_TYPES = new Set([2, 6, 25, 28]);

/*
 * Громкость самого громкого листа дерева игры: сумма громкостей узлов от
 * корня до листа, сотые доли дБ. Свой звук встаёт на неё — не тише
 * выстрела игры и не громче.
 */
export function loudestLeafGain(merged, root) {
  let loudest = -Infinity;
  const visit = (hash, gain, path) => {
    const object = merged.sound(hash);
    if (!object || path.has(hash)) return;
    const here = gain + (soundHeaderValue(object.bytes, "volume") ?? 0);
    if (leafOf(object)) {
      loudest = Math.max(loudest, here);
      return;
    }
    path.add(hash);
    for (const at of object.links) visit(object.bytes.readUInt32LE(at), here, path);
    path.delete(hash);
  };
  visit(root, 0, new Set());
  return Number.isFinite(loudest) ? loudest : 0;
}

/*
 * Копия объекта: новые цели ссылок (`null` — ребёнок убран из мультитрека)
 * и поля заголовка. Смещения ссылок и поля банка сдвигаются вместе с
 * данными за заголовком.
 */
export function rebuildSoundObject(object, { targets = null, header = {} } = {}) {
  let bytes = Buffer.from(object.bytes);
  let links = [...object.links];
  if (targets) {
    const kept = targets.filter((target) => target !== null);
    if (object.type === MULTITRACK_TYPE && kept.length !== targets.length) {
      const end = readSoundHeader(bytes).end;
      const out = Buffer.alloc(end + 1 + kept.length * 4);
      bytes.copy(out, 0, 0, end);
      out[end] = kept.length;
      kept.forEach((target, index) =>
        out.writeUInt32LE(target >>> 0, end + 1 + index * 4),
      );
      bytes = out;
      links = kept.map((_, index) => end + 1 + index * 4);
    } else
      targets.forEach((target, index) =>
        bytes.writeUInt32LE((target ?? NULL_SOUND) >>> 0, links[index]),
      );
  }
  /* Заголовок без правок не пересобирается: копия остаётся байт в байт. */
  if (!Object.keys(header).length)
    return { bytes, links, packs: [...object.packs] };
  const written = writeSoundHeader(bytes, header);
  return {
    bytes: written.bytes,
    links: links.map((at) => at + written.shift),
    packs: object.packs.map((at) => at + written.shift),
  };
}

/**
 * Переопределение ствола для пакета Astral: в деревьях выстрела звучит
 * только голос ствола.
 *
 * `voice` — листья-кандидаты (`weaponVoiceLeaves`: листья банка ствола и их
 * стерео-пары). Из них в копиях остаются те, что звучат по одному на
 * выстрел: в наборе одновременных слоёв — первая левая и первая правая
 * дорожки голоса (или первая ветвь, где голос есть), остальные слои
 * убираются; варианты случайного выбора без голоса ведут на вариант с
 * голосом; роль очереди без голоса (хвост из общих слоёв) — тишина. Этот
 * набор и возвращается в `voice`: ровно его дорожки окно и рендерит.
 *
 * @param {ReturnType<typeof mergeAudioChunks>} merged
 * @param {object} input
 * @param {string} input.slug  ствол (`assaultrifle`)
 * @param {ReturnType<typeof weaponAudio>} input.audio
 * @param {Array<{key: string}>} input.voice  листья-кандидаты (`КОНТЕЙНЕР:ДОРОЖКА`)
 * @param {(key: string) => number} [input.waveName]  имя новой дорожки голоса
 */
export function planWeaponOverride(
  merged,
  { slug, audio, voice, waveName = (key) => voiceWaveName(slug, key) },
) {
  const own = privateWeaponBank(slug);
  const privateBank = bankHash(own.name);
  const candidates = new Set((voice || []).map((item) => item.key));
  if (!candidates.size) throw new Error("У ствола нет дорожек голоса.");

  const voiceLeaf = (object) => {
    const leaf = leafOf(object);
    return leaf && candidates.has(streamKey(leaf.container, leaf.file)) ? leaf : null;
  };
  const bears = new Map();
  const bearsVoice = (hash, path = new Set()) => {
    if (bears.has(hash)) return bears.get(hash);
    const object = merged.sound(hash);
    if (!object || path.has(hash)) return false;
    if (leafOf(object)) {
      const result = Boolean(voiceLeaf(object));
      bears.set(hash, result);
      return result;
    }
    path.add(hash);
    const result = object.links.some((at) =>
      bearsVoice(object.bytes.readUInt32LE(at), path),
    );
    path.delete(hash);
    bears.set(hash, result);
    return result;
  };

  /* Какие дети одновременного узла остаются: пара голоса или одна ветвь. */
  const keptTogether = (children) => {
    const leaves = children
      .map((child, index) => {
        const object = merged.sound(child);
        const leaf = object && voiceLeaf(object);
        return leaf ? { index, channel: channelOf(leaf.pan) } : null;
      })
      .filter(Boolean);
    if (leaves.length) {
      const left = leaves.find((leaf) => leaf.channel === "left");
      const right = leaves.find((leaf) => leaf.channel === "right");
      const kept = [left, right].filter(Boolean).map((leaf) => leaf.index);
      return new Set(kept.length ? kept : [leaves[0].index]);
    }
    const branch = children.findIndex((child) => bearsVoice(child));
    return new Set(branch >= 0 ? [branch] : []);
  };

  /* Ветвь, которая играет банк ствола не голосом: перезарядка, выстрел с
     глушителем. Банк в слоте оружия теперь личный, и такая ветвь без копии
     замолчала бы. */
  const touches = new Map();
  const touchesBank = (hash, path = new Set()) => {
    if (audio.bank === null || !hash) return false;
    if (touches.has(hash)) return touches.get(hash);
    const object = merged.sound(hash);
    if (!object || path.has(hash)) return false;
    const leaf = leafOf(object);
    if (leaf) {
      const result = leaf.container === audio.bank && !voiceLeaf(object);
      touches.set(hash, result);
      return result;
    }
    path.add(hash);
    const result = object.links.some((at) =>
      touchesBank(object.bytes.readUInt32LE(at), path),
    );
    path.delete(hash);
    touches.set(hash, result);
    return result;
  };

  /* Нетронутая копия: листья банка ствола — в личный банк с той же
     дорожкой (она переносится в банк как есть), остальное — как у игры. */
  const keeps = new Map();
  const kept = new Set();
  const keepOf = (hash) => {
    if (keeps.has(hash)) return keeps.get(hash).hash;
    const object = merged.sound(hash);
    const copy = keepHash(slug, hash);
    if (merged.sound(copy))
      throw new Error(`Имя копии ${hexHash(copy)} уже занято в звуках игры.`);
    const record = { hash: copy, origin: hash, chunk: object.chunk, object, targets: null };
    keeps.set(hash, record);
    const leaf = leafOf(object);
    if (leaf) {
      record.kept = { at: leaf.containerAt };
      kept.add(leaf.file & 0x1fffffff);
      return copy;
    }
    for (const at of object.packs)
      if (object.bytes.readUInt32LE(at) === audio.bank)
        throw new Error(
          `Узел ${hexHash(hash)} играет банк ствола не листом — такой звук студия не переносит.`,
        );
    record.targets = object.links.map((at) => {
      const child = object.bytes.readUInt32LE(at);
      return touchesBank(child) ? keepOf(child) : child;
    });
    return copy;
  };

  const clones = new Map();
  const used = new Map();
  let firstVoice = null;
  const cloneOf = (hash) => {
    if (clones.has(hash)) return clones.get(hash).hash;
    const object = merged.sound(hash);
    const copy = cloneHash(slug, hash);
    if (merged.sound(copy))
      throw new Error(`Имя копии ${hexHash(copy)} уже занято в звуках игры.`);
    const record = { hash: copy, origin: hash, chunk: object.chunk, object, targets: null };
    clones.set(hash, record);
    const leaf = voiceLeaf(object);
    if (leaf) {
      const key = streamKey(leaf.container, leaf.file);
      record.leaf = { at: leaf.containerAt, key };
      used.set(key, (used.get(key) || 0) + 1);
      firstVoice ??= copy;
      return copy;
    }
    for (const at of object.packs)
      if (audio.bank !== null && object.bytes.readUInt32LE(at) === audio.bank)
        throw new Error(
          `Узел ${hexHash(hash)} играет банк ствола не листом — такой звук студия не переносит.`,
        );
    const children = object.links.map((at) => object.bytes.readUInt32LE(at));
    if (SIMULTANEOUS_TYPES.has(object.type)) {
      const kept = keptTogether(children);
      record.targets = children.map((child, index) =>
        kept.has(index)
          ? cloneOf(child)
          : object.type === MULTITRACK_TYPE
            ? null
            : NULL_SOUND,
      );
    } else if (ALTERNATIVE_TYPES.has(object.type)) {
      const fallback = cloneOf(children.find((child) => bearsVoice(child)));
      record.targets = children.map((child) =>
        child && bearsVoice(child) ? cloneOf(child) : child ? fallback : child,
      );
    } else if (object.type === RETRIGGERED_OVERLAPPED_TYPE) {
      record.targets = children.map((child) =>
        child && bearsVoice(child) ? cloneOf(child) : child ? NULL_SOUND : child,
      );
    } else {
      /* Обёртки, огибающие, переключатели по переменной: голос — копией,
         запасная ветвь без голоса — как у игры (с банком ствола — своей
         нетронутой копией). */
      record.targets = children.map((child) =>
        child && bearsVoice(child)
          ? cloneOf(child)
          : child && touchesBank(child)
            ? keepOf(child)
            : child,
      );
    }
    return copy;
  };

  const settings = Buffer.from(audio.settings.bytes);
  const fields = [];
  const roots = new Map();
  const deferred = [];
  for (const [field, root] of Object.entries(audio.roots)) {
    const offset = FIELD_OFFSET.get(field);
    if (AFTERSHOT.has(field)) {
      settings.writeUInt32LE(NULL_SOUND, offset);
      fields.push({ field, from: root, to: NULL_SOUND });
      continue;
    }
    if (field === "BankSound") continue;
    if (bearsVoice(root)) {
      const to = cloneOf(root);
      roots.set(root, loudestLeafGain(merged, root));
      settings.writeUInt32LE(to, offset);
      fields.push({ field, from: root, to });
    } else deferred.push([field, root]);
  }
  if (!firstVoice)
    throw new Error("В деревьях ствола нет его голоса — игра другой версии.");

  /* Свой звук для полей выстрела без голоса — того же вида, что поле у
     игры: очередь (retrigger — начало, повтор, конец, пока держат курок)
     ведёт на копию очереди ствола, одиночный выстрел — на один выстрел
     ствола. Иначе одиночное поле играло бы очередь без конца. */
  const mainRoot = audio.roots[audio.main];
  const mainRecord = clones.get(mainRoot);
  const retrigNode = (hash, depth = 0) => {
    const object = merged.sound(hash);
    if (!object || depth > 4) return null;
    if (object.type === RETRIGGERED_OVERLAPPED_TYPE) return object;
    if (!PASS_THROUGH_TYPES.has(object.type) || !object.links.length) return null;
    return retrigNode(object.bytes.readUInt32LE(object.links[0]), depth + 1);
  };
  const mainRetrig = retrigNode(mainRoot);
  const autoDonor = mainRetrig ? mainRecord : null;
  const singleDonor = mainRetrig
    ? clones.get(
        mainRetrig.links
          .map((at) => mainRetrig.bytes.readUInt32LE(at))
          .find((child) => child && bearsVoice(child)),
      ) || null
    : mainRecord;
  const audible = (hash) => collectLeaves(merged, hash).length > 0;
  const standIns = new Map();
  for (const [field, root] of deferred) {
    const offset = FIELD_OFFSET.get(field);
    const donor = SHOT.has(field) && audible(root)
      ? retrigNode(root) ? autoDonor : singleDonor
      : null;
    if (donor) {
      if (!standIns.has(root))
        standIns.set(root, {
          hash: cloneHash(slug, root),
          origin: root,
          chunk: merged.sound(root).chunk,
          object: merged.sound(root),
          donor,
        });
      const to = standIns.get(root).hash;
      settings.writeUInt32LE(to, offset);
      fields.push({ field, from: root, to, standIn: true });
    } else if (touchesBank(root)) {
      const to = keepOf(root);
      settings.writeUInt32LE(to, offset);
      fields.push({ field, from: root, to, kept: true });
    }
  }
  /* Банк ствола игра грузит по BankSound: он ведёт на первый лист голоса, и
     в слот оружия игрока встаёт личный банк. */
  const bankFrom = settings.readUInt32LE(FIELD_OFFSET.get("BankSound"));
  settings.writeUInt32LE(firstVoice, FIELD_OFFSET.get("BankSound"));
  fields.push({ field: "BankSound", from: bankFrom, to: firstVoice });

  /* Байты копий: цели ссылок, лист — в личный банк, тон — ноль, громкость
     — у корня дерева (самый громкий слой игры), ниже — ноль. */
  const objects = [...clones.values()].map((record) => {
    const present = readSoundHeader(record.object.bytes).fields;
    const header = {};
    for (const name of ["pitch", "pitchVariance"])
      if (present.has(name)) header[name] = 0;
    if (roots.has(record.origin)) {
      const target = roots.get(record.origin);
      if (target !== 0 || present.has("volume")) header.volume = target;
    } else if (present.has("volume")) header.volume = 0;
    const built = rebuildSoundObject(record.object, { targets: record.targets, header });
    if (record.leaf) {
      const at = record.leaf.at + (built.packs[0] - record.object.packs[0]);
      built.bytes.writeUInt32LE(privateBank, at);
      built.bytes.writeUInt32LE(waveName(record.leaf.key) >>> 0, at + 4);
    }
    return { hash: record.hash, origin: record.origin, chunk: record.chunk, ...built };
  });
  /* Нетронутые копии: те же байты, листья — в личный банк. */
  for (const record of keeps.values()) {
    const built = rebuildSoundObject(record.object, { targets: record.targets });
    if (record.kept) built.bytes.writeUInt32LE(privateBank, record.kept.at);
    objects.push({ hash: record.hash, origin: record.origin, chunk: record.chunk, ...built });
  }
  /* Свой звук вместо поля без голоса: заголовок — поля игры (категория,
     фильтры, дальность, задержка: выстрел с глушителем остаётся тише и
     короче слышен, как у игры), тело — копия выстрела ствола того же вида,
     флаги поведения — того же вида, что тело, громкость — как у своего
     выстрела, тон — ноль. */
  const builtByHash = new Map(objects.map((object) => [object.hash, object]));
  const mainTarget = roots.get(mainRoot);
  for (const record of standIns.values()) {
    const donor = builtByHash.get(record.donor.hash);
    const donorEnd = readSoundHeader(donor.bytes).end;
    const body = donor.bytes.subarray(donorEnd);
    /* Заголовок без полей: флаги 0, как у игры (`sound-header.js`). */
    const bare = Buffer.alloc(5 + body.length);
    bare[0] = donor.bytes[0];
    body.copy(bare, 5);
    const values = Object.fromEntries(
      [...readSoundHeader(record.object.bytes).fields].map(([name, field]) => [
        name,
        field.value,
      ]),
    );
    /* Флаги поведения у каждого вида звука свои: у корня поля того же вида,
       что тело, — его флаги (так это поле звучит у игры), у корня другого
       вида — флаги донора. У одиночного выстрела карабина корень — обёртка
       без флагов, и мультитрек с её заголовком остался бы без них — такой
       звук роняет игру (`sound-header.js`, 27.09.2026). */
    delete values.flags2;
    const flagsOf = record.object.bytes[0] === donor.bytes[0] ? record.object : donor;
    const flags = readSoundHeader(flagsOf.bytes).fields.get("flags2");
    if (flags) values.flags2 = flags.value;
    for (const name of ["pitch", "pitchVariance"]) if (name in values) values[name] = 0;
    if (mainTarget !== 0 || "volume" in values) values.volume = mainTarget;
    const written = writeSoundHeader(bare, values);
    const shift = 5 + written.shift - donorEnd;
    objects.push({
      hash: record.hash,
      origin: record.origin,
      chunk: record.chunk,
      bytes: written.bytes,
      links: donor.links.map((at) => at + shift),
      packs: donor.packs.map((at) => at + shift),
    });
  }
  for (const object of objects) {
    const problem = soundHeaderProblem(object.bytes);
    if (problem)
      throw new Error(`Звук ствола не собрать: ${hexHash(object.hash)} — ${problem}.`);
  }

  /* Настройки — копией под своим именем, предмет — переопределением, где
     на копию ведёт одна строка игрока. Ссылки предмета (запасные настройки
     и строки категорий) лежат в таблице ссылок файла — копия несёт их. */
  const settingsCopy = cloneHash(slug, audio.settings.hash);
  if (merged.game(settingsCopy))
    throw new Error(`Имя копии настроек ${hexHash(settingsCopy)} уже занято в настройках игры.`);
  const itemObject = merged.game(audio.item);
  const item = Buffer.from(itemObject.bytes);
  if (item.readUInt32LE(audio.playerAt) !== audio.settings.hash)
    throw new Error(`Строка игрока предмета ${hexHash(audio.item)} ведёт не на его настройки.`);
  item.writeUInt32LE(settingsCopy, audio.playerAt);

  return {
    bank: own,
    oldBank: audio.bank,
    settings: {
      hash: settingsCopy,
      origin: audio.settings.hash,
      chunk: audio.settings.chunk,
      bytes: settings,
      links: audio.settings.links,
      packs: audio.settings.packs,
    },
    item: {
      hash: audio.item,
      chunk: itemObject.chunk,
      bytes: item,
      links: itemObject.links,
      packs: itemObject.packs,
    },
    fields,
    objects: objects.sort((left, right) => left.hash - right.hash),
    voice: [...used.entries()]
      .map(([key, leaves]) => ({ key, leaves }))
      .sort((left, right) => left.key.localeCompare(right.key)),
    /* Дорожки банка ствола, которые переезжают в личный банк как есть. */
    kept: [...kept].sort((left, right) => left - right).map(hexHash),
  };
}

