/*
 * Звук попадания пули: в голову и в тело — отдельно.
 *
 * ОТКУДА ЭТО ИЗВЕСТНО. Не с форумов, а из метаданных самой игры
 * (`update.rpf/x64/audio/config/sounds.dat54.rel` и `game.dat151.rel` Legacy,
 * разобранные CodeWalker'ом; сверено 25.09.2026):
 *
 *   • Материалы пешехода называются `AM_BASE_<кость>` — `AM_BASE_HEAD`,
 *     `AM_BASE_SPINE2`, `AM_BASE_THIGH_LEFT` и ещё восемнадцать. Их поле
 *     `BulletImpactSound` и есть «звук пули в эту часть тела».
 *   • У головы это мультитрек 0xB5DE6514 из четырёх одновременных слоёв; у
 *     всех остальных костей — один и тот же случайный выбор 0x17F64522.
 *   • Одежда говорит то же самое: набор `BulletImpacts` всех 82 настроек
 *     одежды (ClothAudioSettings) ведёт `head` на 0xB5DE6514, а `torso`,
 *     `arms`, `legs` — на 0x17F64522.
 *
 * Значит, в игре ровно два звука попадания по человеку: голова и тело. Их и
 * меняет эта студия.
 *
 * КАК. Удар по голове и по телу переопределяется в звуковом пакете Astral
 * целиком (`hit-voice-plan.js`): в нём звучит только звук человека. Сам звук
 * лежит в банке `collision` резидентного архива — удар пули звучит где угодно
 * и когда угодно, и банк, который игра грузит по требованию, для него не
 * годится.
 *
 * МЕСТО В БАНКЕ. Банк `collision` грузится в слот COLLISION
 * (audioconfig.dat4.rel), и слот сделан ровно по штатному банку трижды: сами
 * звуки — 17 635 320 байт, таблица дорожек — 20 480, служебные чанки (формат
 * и пики каждой дорожки) — 21 388, ровно как у штатного банка. Банк больше
 * слота — вне того, на что рассчитана игра. (27.09.2026 лишние 4 байта пиков
 * длинного звука головы сочли было причиной краша при попадании — нет:
 * сборка 26.09 выходила за слот так же и не падала, а роняли игру слои удара
 * без флагов поведения — `sound-header.js`.) Поэтому звук человека ложится
 * на место дорожек игры:
 *
 *   • носители — две дорожки слоя плоти тела (их листья больше ни в одном
 *     дереве игры не звучат);
 *   • освобождённые — ещё две дорожки плоти и пять дорожек её хвоста: они
 *     сжимаются до тишины, и их место отдаётся звукам человека;
 *   • запасные — мёртвые дорожки банка, на которые не ведёт ни один звук
 *     игры (`HIT_SOUND_SPARE_WAVES`, снимается скриптом по всей очереди
 *     загрузки): звук длиннее 8192 сэмплов несёт пики, и место для них есть
 *     только на месте убранной запасной дорожки — план убирает их ровно
 *     столько, сколько нужно.
 *
 * Освобождать можно только дорожку, которую после установки не играет ни
 * одно дерево игры. Хвост плоти звучит ещё и в пакетах дополнений (байкеры,
 * mpsum2), третья дорожка плоти — в звуке байкеров (сверено по всей очереди
 * загрузки 26.09.2026): все, кто ведёт на освобождённый или несущий лист,
 * переводятся на штатный лист того же выбора, а третья дорожка плоти не
 * освобождается вовсе — без неё у байкеров не осталось бы ни одной своей.
 */

import { relHash } from "./rel-patch.js";
import { AWC_FORMAT_CHUNK_BYTES, awcPeakBytes, waveSlotOf } from "./wave-slots.js";

export const HIT_SOUND_ARCHIVE = "x64/audio/sfx/RESIDENT.rpf";
export const HIT_SOUND_BANK = "collision";

/*
 * Способ установки звука попадания: 1 — правка ссылок update.rpf (звук тонул
 * в штатном ударе), 2 — удар переопределён в звуковом пакете Astral
 * (26.09.2026, вечер), 3 — банк сверяется со слотом памяти COLLISION целиком:
 * пики длинного звука ложатся на место мёртвых дорожек, а не за край слота
 * (27.09.2026), 4 — слои удара с заголовком как у мультитрека игры
 * (27.09.2026: слой тела форм 2 и 3 — флаги 0xAAAAAAAA и без флагов
 * поведения — ронял игру при попадании, ERR_MEM_EMBEDDEDALLOC_FREE_2 и
 * 0xC0000005), 5 — слой звучит так же громко, как штатный удар целиком, и в
 * категории его самого громкого слоя (27.09.2026: в форме 4 громкость
 * категорий не учитывалась, и владелец не слышал ни головы, ни тела),
 * 6 — слой звучит на уровне отметки попадания (`HIT_SOUND_LEVEL`, громче
 * штатного удара) и не затухает 100 м (27.09.2026, вечер: на уровне
 * штатного удара короткий звук тонул в выстреле — «после убийства маленький
 * писк», по телу ничего), 7 — слой тела в категории слоя плоти игры, а не
 * `weapons_guns_bullet_impacts_body` (28.09.2026: категорию ударов пули
 * сцены микса глушат в бою, категорию плоти — никогда; голова в `melee`
 * слышалась, тело — нет), 8 — слой тела звучит на `HIT_SOUND_BODY_DELAY_MS`
 * позже (28.09.2026, запись звука самой игры: удар по телу игра играет в эхо
 * выстрела игрока, и эхо его накрывает; голову — позже, после эха, поэтому
 * её было слышно, а тело — нет), 9 — ещё и на 6 дБ громче головы
 * (`HIT_SOUND_LEVELS`: у пистолета тело тонуло и после задержки — в его
 * отзвуке). Главный процесс называет способ в ответе установки.
 */
export const HIT_SOUND_FORMAT = 9;

/*
 * Громкость звука человека в игре, сотые дБ, вместе с категорией — как у
 * отметки попадания в шутерах: его должно быть слышно сквозь собственную
 * стрельбу. Мерки по звукам Legacy (громкости узлов плюс цепочка
 * категорий, 27.09.2026): первый выстрел игрока −2…−9 дБ, очередь АК −15,
 * отзвук снайперки до +5; штатный удар по голове −4, по телу −14,5. Слой на
 * уровне штатного удара (форма 5) владелец не слышал: «Щелчок» — 12 мс на
 * 1100 Гц — целиком совпадает с выстрелом и тонет в нём, а звук вдесятеро
 * короче удара игры слышится на 10 дБ тише при той же громкости. Тише —
 * ручкой «Громкость» студии: она печётся в дорожку.
 */
export const HIT_SOUND_LEVEL = 0;

/*
 * Громкость слоя каждой части в игре. Голова — `HIT_SOUND_LEVEL`: игра сама
 * играет её через 0,2–0,4 с после выстрела, когда хлопок уже стих, и её
 * слышно. Тело — на 6 дБ громче: запись звука игры (28.09.2026, выстрелы
 * игрока с 6 м) показала, что даже после задержки звук тела попадает в хвост
 * выстрела пистолета — эхо и отзвук держатся около 0,3 с почти на уровне
 * слоя, — а у живых ещё и в крик боли. Громче ручкой «Громкость» можно лишь
 * на 6 дБ, и то с мягким пределом (она печётся в дорожку), тише — сколько
 * угодно. Числа нужны и окну: по ним студия меряет, слышно ли звук в бою
 * (`hit-masking.js`).
 */
export const HIT_SOUND_LEVELS = Object.freeze({
  head: HIT_SOUND_LEVEL,
  body: HIT_SOUND_LEVEL + 600,
});

/* Объекты дерева — для плана и для объяснений в тестах. */
export const HIT_SOUND_OBJECTS = Object.freeze({
  /** AM_BASE_HEAD.BulletImpactSound — мультитрек из четырёх слоёв. */
  headImpact: "0XB5DE6514",
  /** Слой хруста головы: случайный из трёх общих волн. */
  headCrunch: "0X520395A0",
  /**
   * «Шлепок» головы (+9 дБ, категория `melee`): то, что слышно при
   * попадании в голову в штатной игре — его дорожки HEADBUTT и меняют
   * чужие моды «звука хедшота».
   */
  headSplat: "0XF663AC66",
  /** BulletImpactSound всех костей, кроме головы: выбор из двух вариантов. */
  bodyImpact: "0X17F64522",
  /** Полный вариант тела (вес 0,3): в нём есть слой только тела. */
  bodyFull: "0XA91304C2",
  /** Лёгкий вариант тела (вес 1): только общие слои. */
  bodyLight: "0XC042BBA3",
  /** Слой плоти: случайный из пяти волн, только в полном варианте тела. */
  fleshLayer: "0XE4C51247",
  /** Хвост плоти (задержка 150 мс): случайный из шести. */
  fleshTail: "0XE902D420",
  /** Набор `BulletImpacts` одежды: голова, туловище, руки, ноги. */
  clothImpacts: "0X2F91D046",
});

/*
 * Простые звуки (листья) и их волны в банке `collision`. Порядок — как в
 * случайных выборах игры.
 */
const FLESH_LEAVES = Object.freeze([
  Object.freeze({ leaf: "0X9A45DA29", wave: "0X02675B3F" }),
  Object.freeze({ leaf: "0X1A385A10", wave: "0X0F4934FB" }),
  Object.freeze({ leaf: "0X2C8FFEBF", wave: "0X1CED9044" }),
  Object.freeze({ leaf: "0XF71593CB", wave: "0X0A8CEB82" }),
  Object.freeze({ leaf: "0X090437A8", wave: "0X0058D71A" }),
]);

const TAIL_LEAVES = Object.freeze([
  Object.freeze({ leaf: "0X89886C2E", wave: "0X0AF989C2" }),
  Object.freeze({ leaf: "0X2C3EB19C", wave: "0X1CB82D3F" }),
  Object.freeze({ leaf: "0XD47081F5", wave: "0X067740BD" }),
  Object.freeze({ leaf: "0XE8B2AA79", wave: "0X1828E420" }),
  Object.freeze({ leaf: "0X42F4DEFC", wave: "0X069240EF" }),
  Object.freeze({ leaf: "0X452FE372", wave: "0X1843E452" }),
]);

/**
 * Листья выборов, чьи дорожки идут под звук человека. Кто ведёт на занятый
 * лист, переводится на первый штатный лист своей группы.
 */
export const HIT_SOUND_LEAF_GROUPS = Object.freeze({
  flesh: Object.freeze(FLESH_LEAVES.map((item) => item.leaf)),
  tail: Object.freeze(TAIL_LEAVES.map((item) => item.leaf)),
});

/*
 * Части звука попадания. `carrier` — дорожка, в которую ложится звук
 * человека; `leaf` — лист, который на неё ссылается.
 */
export const HIT_SOUND_PARTS = Object.freeze({
  head: Object.freeze({
    id: "head",
    title: "Голова",
    carrier: FLESH_LEAVES[1].wave,
    leaf: FLESH_LEAVES[1].leaf,
    hint: "Звучит вместо штатного удара, когда пуля попадает в голову",
  }),
  body: Object.freeze({
    id: "body",
    title: "Тело",
    carrier: FLESH_LEAVES[0].wave,
    leaf: FLESH_LEAVES[0].leaf,
    hint: "Звучит вместо штатного удара, когда пуля попадает в туловище, руки или ноги",
  }),
});

export const HIT_SOUND_PART_IDS = Object.freeze(Object.keys(HIT_SOUND_PARTS));

/*
 * Сколько секунд звука человека принимает часть. Дорожки банка — 24 кГц PCM;
 * место (две дорожки-носителя и семь освобождённых) — около 1,75 с на двоих
 * на живой Legacy. Предел один, даже когда поставлена одна часть: человек
 * знает его заранее, а не узнаёт отказом установки.
 */
export const HIT_SOUND_MAX_SECONDS = 0.9;

/* Запас на выравнивание потоков при пересборке банка, байт. */
const ALIGNMENT_RESERVE = 512;

/*
 * Длина тишины на месте освобождённой дорожки, в сэмплах. Не один сэмпл:
 * дорожка остаётся настоящей — с заголовком и данными, которые любой
 * декодер прочтёт без оговорок, — просто беззвучной и почти пустой.
 */
export const HIT_SOUND_SILENCE_SAMPLES = 32;

/*
 * Освобождённые листья и их дорожки: две последние дорожки плоти и пять
 * вариантов хвоста. Третья дорожка плоти и первый вариант хвоста остаются
 * игровыми — на них переводится всё, что вело на занятые.
 */
const FREED = Object.freeze([...FLESH_LEAVES.slice(3), ...TAIL_LEAVES.slice(1)]);

/** Дорожки, которые установка освобождает: они становятся тишиной. */
export const HIT_SOUND_FREED_WAVES = Object.freeze(FREED.map((item) => item.wave));

/** Листья освобождённых дорожек: после установки на них не ведёт ни одно дерево. */
export const HIT_SOUND_FREED_LEAVES = Object.freeze(FREED.map((item) => item.leaf));

const normalizeParts = (parts) => {
  const list = (Array.isArray(parts) ? parts : [])
    .map((part) => String(part || ""))
    .filter((part) => HIT_SOUND_PARTS[part]);
  return HIT_SOUND_PART_IDS.filter((part) => list.includes(part));
};

/**
 * Что и куда ляжет в банк `collision`, и сколько места у каждой части.
 *
 * `bank` — опись банка collision из игры игрока (awc-inspect): дорожки
 * (`hash`, `samples`, `sampleRate`, `codec`, `chunks`, `metadataBytes`) и
 * три числа банка (`headerBytes`, `metadataBytes`, `contentBytes`). План
 * считается по ним, а не по числам из комментариев, — у другой сборки игры
 * банк может отличаться, и тогда план честно откажет, а не запишет мимо.
 * `spare` — запасные (мёртвые) дорожки банка, `HIT_SOUND_SPARE_WAVES`.
 *
 * @returns {{
 *   carriers: Array<{part: string, stream: string, sampleRate: number, maxSamples: number}>,
 *   silence: Array<{stream: string, sampleRate: number}>,
 *   budgetBytes: number,
 *   slot: {name: string, bytes: number, header: number, metadata: number},
 *   bank: {header: number, metadata: number, content: number, indexBytes: number},
 *   touched: Record<string, {metadata: number, chunks: number}>,
 *   spare: Array<{stream: string, metadata: number, chunks: number}>,
 * }}
 */
export function hitSoundBankPlan(parts, bank, { spare = [] } = {}) {
  const chosen = normalizeParts(parts);
  if (!chosen.length) throw new Error("Выберите голову или тело.");
  const streams = Array.isArray(bank?.streams) ? bank.streams : [];
  const totals = {
    header: Number(bank?.headerBytes),
    metadata: Number(bank?.metadataBytes),
    content: Number(bank?.contentBytes),
    /* У банка с индексом первого чанка (флаг 1) каждая дорожка — ещё 2 байта таблицы. */
    indexBytes: Number(bank?.flags) & 1 ? 2 : 0,
  };
  if (![totals.header, totals.metadata, totals.content].every((value) => value > 0))
    throw new Error(
      "Опись банка collision без таблицы дорожек и служебных чанков — помощник Astral старше приложения, обновите его.",
    );
  const slot = waveSlotOf(HIT_SOUND_ARCHIVE, `${HIT_SOUND_BANK}.awc`);
  const byHash = new Map(
    streams.map((stream) => [relHash(stream?.hash || stream?.name), stream]),
  );
  const need = [
    ...FLESH_LEAVES.map((item) => item.wave),
    ...TAIL_LEAVES.map((item) => item.wave),
  ];
  const missing = need.filter((wave) => !byHash.has(wave));
  if (missing.length)
    throw new Error(
      `В банке collision нет дорожек ${missing.join(", ")} — эта сборка игры устроена иначе, звук попадания на неё не встанет.`,
    );
  const bytesOf = (wave) => {
    const stream = byHash.get(wave);
    const codec = String(stream.codec || "").toUpperCase();
    if (codec !== "PCM")
      throw new Error(
        `Дорожка ${wave} сжата (${codec || "кодек неизвестен"}) — звук попадания ставится только на PCM.`,
      );
    return (Number(stream.samples) || 0) * 2;
  };
  /* Место под звуки людей: дорожки-носители выбранных частей и все
     освобождённые, минус тишина на месте освобождённых и запас на
     выравнивание. Носитель части, которой в наборе нет, остаётся игровым и
     своё место не отдаёт. */
  const pool =
    [
      ...chosen.map((part) => HIT_SOUND_PARTS[part].carrier),
      ...HIT_SOUND_FREED_WAVES,
    ].reduce((sum, wave) => sum + bytesOf(wave), 0) -
    HIT_SOUND_FREED_WAVES.length * HIT_SOUND_SILENCE_SAMPLES * 2 -
    ALIGNMENT_RESERVE;
  const share = Math.floor(pool / chosen.length / 2);

  /* Служебные чанки дорожек, которых касается слой. Счёт ниже верен, только
     пока дорожка — формат, пики и данные, как у всех дорожек плоти игры;
     иначе банк устроен не так, как план его понимает, и честнее отказать. */
  const touched = {};
  for (const wave of [
    ...chosen.map((part) => HIT_SOUND_PARTS[part].carrier),
    ...HIT_SOUND_FREED_WAVES,
  ]) {
    const stream = byHash.get(wave);
    const metadata = Number(stream.metadataBytes);
    const chunks = Array.isArray(stream.chunks) ? stream.chunks.length : 0;
    const plain =
      metadata ===
      AWC_FORMAT_CHUNK_BYTES + (stream.peak === false ? 0 : awcPeakBytes(stream.samples));
    if (!plain || chunks !== 2 + (awcPeakBytes(stream.samples) ? 1 : 0))
      throw new Error(
        `Дорожка ${wave} банка collision устроена иначе, чем у Legacy, — звук попадания на эту сборку игры не встанет.`,
      );
    touched[wave] = { metadata, chunks };
  }
  /* Запасные дорожки, что есть в этом банке: чистые (формат и данные) и не
     из тех, что слой и так занимает. Порядок — по имени, чтобы одна и та
     же установка всегда убирала одни и те же. */
  const spareStreams = [...new Set((spare || []).map((wave) => relHash(wave)))]
    .sort()
    .filter((wave) => byHash.has(wave) && !touched[wave] && !need.includes(wave))
    .map((wave) => {
      const stream = byHash.get(wave);
      return {
        stream: wave,
        metadata: Number(stream.metadataBytes) || 0,
        chunks: Array.isArray(stream.chunks) ? stream.chunks.length : 0,
      };
    })
    .filter((item) => item.metadata > 0 && item.chunks > 0);
  /* Сколько служебных байт останется на пики звуков людей, если убрать все
     запасные: штатный банк занимает слот до байта, поэтому пики есть только
     на месте убранных. Дорожка короче 8192 сэмплов пиков не несёт. */
  const peakRoom =
    slot.metadata -
    totals.metadata +
    Object.values(touched).reduce((sum, item) => sum + item.metadata, 0) -
    Object.keys(touched).length * AWC_FORMAT_CHUNK_BYTES +
    spareStreams.reduce((sum, item) => sum + item.metadata, 0);
  if (peakRoom < 0)
    throw new Error(
      "Банк collision уже больше своего слота в памяти игры — звук попадания на него не ляжет. Проверьте файлы игры в Steam.",
    );
  const peakShare = Math.floor(peakRoom / chosen.length / 2);
  const peakSamples = 4096 * (peakShare + 1) + 4095;

  const carriers = chosen.map((part) => {
    const stream = byHash.get(HIT_SOUND_PARTS[part].carrier);
    const sampleRate = Number(stream.sampleRate) || 0;
    if (!sampleRate)
      throw new Error(`У дорожки ${HIT_SOUND_PARTS[part].carrier} нет частоты.`);
    const maxSamples = Math.min(
      share,
      peakSamples,
      Math.floor(HIT_SOUND_MAX_SECONDS * sampleRate),
    );
    if (maxSamples < sampleRate * 0.05)
      throw new Error("В банке collision не осталось места под звук попадания.");
    return {
      part,
      stream: HIT_SOUND_PARTS[part].carrier,
      sampleRate,
      maxSamples,
    };
  });
  const silence = HIT_SOUND_FREED_WAVES.map((wave) => ({
    stream: wave,
    sampleRate: Number(byHash.get(wave).sampleRate) || 0,
  }));
  return {
    carriers,
    silence,
    /* Сколько байт данных эти дорожки занимают в банке сейчас: собранный
       слой не имеет права занять больше. */
    budgetBytes: [
      ...chosen.map((part) => HIT_SOUND_PARTS[part].carrier),
      ...HIT_SOUND_FREED_WAVES,
    ].reduce((sum, wave) => sum + bytesOf(wave), 0),
    slot,
    bank: totals,
    touched,
    spare: spareStreams,
  };
}

/**
 * Каким банк станет после слоя, и какие запасные дорожки уйдут под пики.
 *
 * `samples` — сэмплов в звуке каждой части (`{head, body}`). Запасные
 * убираются по одной, пока служебные чанки и таблица дорожек не лягут в
 * слот COLLISION: короткому звуку (без пиков) не уходит ни одна.
 *
 * @returns {{drop: string[], header: number, metadata: number}}
 */
export function hitSoundBankLayout(plan, samples) {
  const { slot, bank, touched } = plan;
  const streamBytes = (chunks) => 4 + bank.indexBytes + 8 * chunks;
  let metadata = bank.metadata;
  let header = bank.header;
  for (const carrier of plan.carriers) {
    const count = Number(samples?.[carrier.part]);
    if (!Number.isInteger(count) || count <= 0)
      throw new Error(`Нет длины звука части «${HIT_SOUND_PARTS[carrier.part].title}».`);
    const peaks = awcPeakBytes(count);
    metadata += AWC_FORMAT_CHUNK_BYTES + peaks - touched[carrier.stream].metadata;
    header += 8 * (2 + (peaks ? 1 : 0) - touched[carrier.stream].chunks);
  }
  for (const item of plan.silence) {
    metadata += AWC_FORMAT_CHUNK_BYTES - touched[item.stream].metadata;
    header += 8 * (2 - touched[item.stream].chunks);
  }
  const drop = [];
  for (const item of plan.spare) {
    if (metadata <= slot.metadata && header <= slot.header) break;
    drop.push(item.stream);
    metadata -= item.metadata;
    header -= streamBytes(item.chunks);
  }
  if (metadata > slot.metadata || header > slot.header)
    throw new Error(
      "Звуки головы и тела не помещаются в служебную память банка collision — сократите более длинный из них.",
    );
  return { drop: drop.sort(), header, metadata };
}

/** Дорожки слоя попаданий: носители частей и освобождённые, по порядку. */
export function hitSoundLayerStreams(parts) {
  const chosen = normalizeParts(parts);
  return [
    ...chosen.map((part) => HIT_SOUND_PARTS[part].carrier),
    ...HIT_SOUND_FREED_WAVES,
  ].sort();
}
