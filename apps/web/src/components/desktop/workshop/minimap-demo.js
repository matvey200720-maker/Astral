import { useEffect } from "react";

/*
 * Демонстрация урона мини-карты — один ход на редактор и на предпросмотр в карточке каталога (владелец, 16.11.2026: «когда нажимаю
 * „Получение урона“, должно идти как в мастерской: сначала уходит броня, потом HP»).
 *
 * Каждый тик отнимает долю запаса (`DEMO_DAMAGE_STEPS`: 34, 33, 33): пока есть броня — у неё, потом у здоровья; после третьего тика здоровья
 * демонстрация заканчивается, и следующий щелчок начинает всё заново. Тик заводит хвост урона, вспышку (с новым номером — играет с начала,
 * как в игре) и вылетающую цифру. Хвост и вспышка гаснут каждый в своё время (`useDemoDecay`).
 *
 * Модуль без разметки и без картинок: предпросмотр и редактор берут отсюда и числа, и сам ход, а не пишут свой.
 */

export const DEMO_HEALTH_MAX = 100;
export const DEMO_ARMOR_MAX = 100;
export const DEMO_DAMAGE_STEPS = [34, 33, 33];
/** Период ходьбы «Запустить демонстрацию урона», мс. */
export const DEMO_TICK_MS = 900;

/**
 * Период хода демонстрации при скорости анимации `speed` (проценты, `effects.vitalAnimSpeed`): 100 — `DEMO_TICK_MS`, 200 — вдвое чаще.
 * Не короче 150 мс: быстрее хвост урона и вспышка не успевают начаться.
 */
export function demoTickMs(speed = 100) {
  const percent = Number.isFinite(speed) && speed > 0 ? speed : 100;
  return Math.max(150, Math.round((DEMO_TICK_MS * 100) / percent));
}

/* Вылетающая цифра демонстрации: по три на полосу, как слоты в игре. */
const DEMO_FLOAT_SLOTS = 3;
let demoFloatSeq = 0;
export function withFloat(state, kind, value) {
  demoFloatSeq += 1;
  return [...(state.floats || []), { id: demoFloatSeq, kind, value }].slice(
    -DEMO_FLOAT_SLOTS * 2,
  );
}

/** Состояние демонстрации в покое: здоровье и броня полные (или без брони), урона и вспышки нет. */
export function restedDemo({ armor = DEMO_ARMOR_MAX, ...rest } = {}) {
  return {
    health: DEMO_HEALTH_MAX,
    armor,
    trail: 0,
    trailTarget: "armor",
    flash: false,
    playing: false,
    armorTick: 0,
    healthTick: 0,
    completed: false,
    ...rest,
  };
}

/**
 * Жилет (владелец, 21.11.2026: посмотреть индикатор с бронёй и без неё): «надеть» — броня сразу полная, «снять» — ноль; здоровье как
 * есть. Хвост и вспышка гаснут, а счёт ударов по броне начинается заново: новая броня снова принимает три тика, снятая —
 * уступает удары здоровью. С этого запаса брони демонстрация начнётся сначала, когда закончится (`armorStart`, см. `nextDemoTick`).
 * Идёт ли демонстрация и остальное состояние не трогаются.
 */
export function vestDemo(current, on) {
  const armor = on ? DEMO_ARMOR_MAX : 0;
  return {
    ...current,
    armor,
    armorStart: armor,
    armorTick: 0,
    trail: 0,
    trailTarget: "armor",
    flash: false,
  };
}

/** Следующий тик урона: броня, потом здоровье; закончившаяся демонстрация начинается сначала. */
export function nextDemoTick(current) {
  const base = current.completed
    ? {
        ...current,
        health: DEMO_HEALTH_MAX,
        armor: current.armorStart ?? DEMO_ARMOR_MAX,
        armorTick: 0,
        healthTick: 0,
        completed: false,
      }
    : current;
  const damagesArmor = base.armor > 0;
  const tick = damagesArmor ? base.armorTick : base.healthTick;
  const damage = DEMO_DAMAGE_STEPS[tick] ?? 0;
  const armor = damagesArmor ? Math.max(0, base.armor - damage) : base.armor;
  const health = damagesArmor ? base.health : Math.max(0, base.health - damage);
  const armorTick = damagesArmor ? Math.min(3, tick + 1) : base.armorTick;
  const healthTick = damagesArmor ? base.healthTick : Math.min(3, tick + 1);
  const completed = healthTick === 3;
  const lost = damagesArmor ? base.armor - armor : base.health - health;
  return {
    ...base,
    armor,
    health,
    armorTick,
    healthTick,
    trailTarget: damagesArmor ? "armor" : "health",
    trail: damage,
    flash: true,
    /* Каждый удар — новая вспышка с начала, как в игре. */
    flashId: (base.flashId || 0) + 1,
    playing: completed ? false : base.playing,
    completed,
    floats:
      lost > 0
        ? withFloat(base, damagesArmor ? "armour" : "damage", lost)
        : base.floats,
  };
}

/**
 * Хвост урона и вспышка гаснут каждый в своё время: длительность вспышки — настройка, хвост — как у игры.
 * `effects` — `config.effects` мини-карты (`damageTrailDurationMs`, `damageFlashDurationMs`).
 */
export function useDemoDecay(demo, setDemo, effects) {
  const { damageTrailDurationMs, damageFlashDurationMs } = effects;
  useEffect(() => {
    if (!demo.flashId) return undefined;
    const trail = window.setTimeout(
      () => setDemo((current) => ({ ...current, trail: 0 })),
      damageTrailDurationMs,
    );
    const flash = window.setTimeout(
      () => setDemo((current) => ({ ...current, flash: false })),
      damageFlashDurationMs,
    );
    return () => {
      window.clearTimeout(trail);
      window.clearTimeout(flash);
    };
  }, [demo.flashId, damageTrailDurationMs, damageFlashDurationMs, setDemo]);
}
