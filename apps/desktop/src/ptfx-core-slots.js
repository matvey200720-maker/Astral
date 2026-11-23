/*
 * Слоты Astral в ядре эффектов игрока: что уже есть, что строится при
 * установке и почему иногда нельзя ни то ни другое.
 *
 * След из мастерской живёт в правилах astral_tracer_NNN. Если в core.ypt игрока
 * они уже есть (системное ядро Astral или прошлая установка мастерской) — ими
 * и пользуемся. Если нет — помощник RPF строит слот из штатного донора прямо
 * в ядре игрока (`tools/rpf-helper/YptSlotReservations.cs`), тем же проходом,
 * что патч текстур. Подписанный пакет ядра для этого не нужен: он остаётся
 * условием публикации трассеров и текстур каталога, а не правки своей игры.
 *
 * Эффекты попадания слотами больше не живут: каждый — клон штатного правила
 * ядра целиком (`YptEffectClones.cs`), и семейство astral_impact_* собирается
 * заново при каждой установке. От ядра им нужно одно — чтобы правило-донор в
 * нём было: редукс мог вырезать «лишние» эффекты.
 *
 * Отказ здесь всегда называет, чего не хватило и что с этим сделать: без
 * донора слот не построить, а наполовину собранный слот — след чужого
 * инструмента, поверх которого строить нельзя.
 */
import {
  ASTRAL_CORE_SLOT_DONORS,
  ASTRAL_TRACER_SLOTS,
} from "@modovik/tracer-contract";

export const CORE_SLOT_KINDS = Object.freeze({
  tracer: Object.freeze({ slots: ASTRAL_TRACER_SLOTS, label: "след пули" }),
});

/** Семейство клонов эффектов попадания: имена правил и текстур под приставкой. */
export const IMPACT_CLONE_PREFIX = "astral_impact_";

/** Опись ядра из ответа `ypt-inspect`. */
function inventory(inspection) {
  const resource = inspection?.resource || {};
  const detailed =
    Array.isArray(resource.emitterRules) &&
    Array.isArray(resource.particleRules);
  return {
    detailed,
    textures: new Set((resource.textures || []).map((item) => item?.name)),
    effects: new Set(resource.effectRules || []),
    emitters: new Set(resource.emitterRules || []),
    particles: new Set(resource.particleRules || []),
  };
}

/*
 * Слот целиком — это правило эффекта, эмиттер и частицы с именем слота и
 * текстура слота. Опись без списков эмиттеров и частиц (старый помощник)
 * судит по правилу эффекта и текстуре — так было и раньше.
 */
function slotParts(inv, slot) {
  const parts = [
    ["правило эффекта", inv.effects.has(slot.rule)],
    ["текстура", inv.textures.has(slot.texture)],
  ];
  if (inv.detailed) {
    parts.push(["эмиттер", inv.emitters.has(slot.rule)]);
    parts.push(["правило частиц", inv.particles.has(slot.rule)]);
  }
  const present = parts.filter(([, has]) => has).length;
  return {
    state:
      present === parts.length ? "present" : present ? "partial" : "absent",
    missing: parts.filter(([, has]) => !has).map(([label]) => label),
  };
}

function missingDonors(inv, kind) {
  const donor = ASTRAL_CORE_SLOT_DONORS[kind];
  /* У следа правило эффекта и частицы донора называются одинаково —
     в сообщении имя не повторяется. */
  const missing = new Set();
  if (!inv.effects.has(donor.effect)) missing.add(donor.effect);
  if (inv.detailed && !inv.particles.has(donor.particle))
    missing.add(donor.particle);
  return [...missing];
}

function donorMessage(kind, missing) {
  const { label } = CORE_SLOT_KINDS[kind];
  return (
    `В ядре эффектов вашей игры нет штатного правила ${missing.join(", ")} — ` +
    `из него Astral строит ${label}. Скорее всего core.ypt заменён редуксом, ` +
    "из которого оно вырезано. Верните штатный core.ypt (откатите редукс) " +
    "или поставьте редукс с полным ядром и повторите."
  );
}

function partialMessage(slot, missing) {
  return (
    `Слот ${slot.rule} в ядре эффектов собран не полностью: нет ${missing.join(", ")}. ` +
    "Так бывает, когда core.ypt правил сторонний инструмент. Откатите последнюю " +
    "установку эффектов или верните исходный update.rpf — Astral построит слот сам."
  );
}

/**
 * Доноры клонов, которых в ядре игрока нет.
 *
 * Клон строится из штатного правила ядра, и если редукс его вырезал, эффекта
 * не будет. Узнать об этом надо до сборки трёх тринадцатимегабайтных ядер.
 */
export function missingCloneDonors(inspection, donors) {
  const inv = inventory(inspection);
  return [...new Set(donors || [])]
    .filter((name) => !inv.effects.has(name))
    .sort((left, right) => left.localeCompare(right));
}

export function cloneDonorMessage(missing) {
  return (
    `В ядре эффектов вашей игры нет штатного правила ${missing.join(", ")} — ` +
    "из него Astral собирает выбранный эффект попадания. Скорее всего core.ypt " +
    "заменён редуксом, из которого оно вырезано. Выберите другой эффект или " +
    "верните штатный core.ypt (откатите редукс) и повторите."
  );
}

/** Слоты, которые нужны собранному проекту: по одному на правило. */
export function requiredCoreSlots(compiled) {
  const slots = new Map();
  for (const item of compiled?.textures || []) {
    if (!CORE_SLOT_KINDS[item?.kind]) continue;
    slots.set(item.rule, {
      kind: item.kind,
      rule: item.rule,
      texture: item.texture,
    });
  }
  return [...slots.values()].sort((left, right) =>
    left.rule.localeCompare(right.rule),
  );
}

/**
 * План слотов для установки: какие уже в ядре, какие строить и из чего.
 * Бросает понятную ошибку, если слот не построить.
 */
export function planCoreSlots(inspection, slots) {
  const inv = inventory(inspection);
  const present = [];
  const reservations = [];
  for (const slot of slots) {
    const parts = slotParts(inv, slot);
    if (parts.state === "present") {
      present.push(slot);
      continue;
    }
    if (parts.state === "partial") {
      throw new Error(partialMessage(slot, parts.missing));
    }
    const missing = missingDonors(inv, slot.kind);
    if (missing.length) throw new Error(donorMessage(slot.kind, missing));
    const donor = ASTRAL_CORE_SLOT_DONORS[slot.kind];
    reservations.push({
      effect: slot.rule,
      texture: slot.texture,
      donorEffect: donor.effect,
      donorParticle: donor.particle,
      sheet: { columns: donor.sheet.columns, rows: donor.sheet.rows },
      frames: { ...donor.frames },
    });
  }
  return { present, reservations };
}

/** Сетки листов слотов для ptxclipregions.dat. */
export function slotSheets(slots) {
  return slots.map((slot) => {
    const { sheet } = ASTRAL_CORE_SLOT_DONORS[slot.kind];
    return {
      texture: slot.texture,
      columns: sheet.columns,
      rows: sheet.rows,
    };
  });
}

/**
 * Состояние слотов для окна мастерской.
 *
 *  • `present` — слоты уже лежат в ядре;
 *  • `derived` — каких-то нет, но Astral построит их при установке;
 *  • `unavailable` — хотя бы один вид не построить: нет донора или слот
 *    собран наполовину. `message` говорит, что делать.
 *
 * `available` — правила, на которые мастерская может рассчитывать при
 * установке: уже лежащие и те, что будут построены. У каждого вида в `kinds`
 * своё `message`: окно называет причину только того вида, который нужен
 * проекту, — вырезанный донор следа не касается перекрашенного огня.
 */
export function describeCoreSlots(inspection) {
  const inv = inventory(inspection);
  const kinds = {};
  const available = [];
  const messages = [];
  let derived = false;
  for (const [kind, { slots }] of Object.entries(CORE_SLOT_KINDS)) {
    const present = [];
    const absent = [];
    const partial = [];
    const kindMessages = [];
    for (const slot of slots) {
      const { state, missing } = slotParts(inv, slot);
      if (state === "present") present.push(slot.rule);
      else if (state === "absent") absent.push(slot.rule);
      else {
        partial.push(slot.rule);
        if (partial.length === 1)
          kindMessages.push(partialMessage(slot, missing));
      }
    }
    const donors = absent.length ? missingDonors(inv, kind) : [];
    if (donors.length) kindMessages.push(donorMessage(kind, donors));
    const derivable = donors.length ? [] : absent;
    if (derivable.length) derived = true;
    available.push(...present, ...derivable);
    messages.push(...kindMessages);
    kinds[kind] = {
      present,
      derivable,
      partial,
      missingDonors: donors,
      donor: ASTRAL_CORE_SLOT_DONORS[kind].effect,
      message: kindMessages.join(" "),
    };
  }
  const status = messages.length
    ? "unavailable"
    : derived
      ? "derived"
      : "present";
  return {
    status,
    available: available.sort(),
    kinds,
    message: messages.join(" "),
  };
}
