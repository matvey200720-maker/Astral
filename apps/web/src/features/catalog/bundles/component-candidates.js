import { variantOf } from "@modovik/publishing";
import { isCatalogBundle } from "../../../catalog-utils.js";
import { sourceParts } from "./component-state.js";
import { slotsOf } from "./component-choices.js";
import { REDUX_BASE_SLOT } from "./component-groups.js";

/*
 * Чем можно заменить компонент сборки (ТЗ владельца 10.11.2026: «взять из другой сборки, допустим, мини-карту, взять из другой сборки тайм-циклы»).
 *
 * Компонент — слот (`catalogSlot`: мини-карта, таймцикл, арена…), поэтому и кандидат — **слот другой сборки целиком**: все её пакеты этого слота (таймцикл
 * = маршруты + облака) одной строкой, «одна сборка — одна строка». Не подходят:
 *  • сама карточка со всеми версиями («GTA 5 RP», «Majestic»): их состав и без того выбирается версией, а версии одной части («16:9», «5:4») — меню «Версии»;
 *  • не сборки (одиночный мод без сборки-владельца);
 *  • сборки с тем же составом слота, что уже предложен (версии чужой карточки с одинаковыми пакетами — одна строка).
 * Каждому кандидату приложен признак, подходит ли он под проект карточки (GTA 5 RP или Majestic): чужой проект не прячется, а подписывается — решает
 * человек. Общий архив нескольких слотов (зоны: зелёная, запретные, ВЗХ) помечен `slots`: окно предупредит, что замена займёт все.
 */

const idsOf = (bundle) => (bundle?.includedModIds || []).filter(Boolean);

// Все записи самой карточки: сами версии и состав каждой из них.
export function cardMembers(bundle, catalog) {
  const group = variantOf(bundle)?.group;
  const versions = group ? catalog.filter((mod) => isCatalogBundle(mod) && variantOf(mod)?.group === group) : [];
  return new Set([bundle?.id, ...[bundle, ...versions].flatMap(idsOf), ...versions.map((mod) => mod.id)].filter(Boolean));
}

// Проект, под который сделана запись: пустой список платформ — «для всех».
const platformsOf = (mod) => (Array.isArray(mod?.platforms) ? mod.platforms : []);

export function fitsProject(parts, bundle) {
  const wanted = platformsOf(bundle);
  if (!wanted.length) return true;
  return parts.some((part) => {
    const own = platformsOf(part);
    return !own.length || own.some((id) => wanted.includes(id));
  });
}

/**
 * Пакеты слота `key` других сборок.
 * @returns {{ source: object, parts: object[], mod: object, slots: string[], fitsProject: boolean }[]} по проекту, названию сборки и имени.
 */
export function swapCandidates({ key, part, bundle, catalog = [] }) {
  if (!key || !isCatalogBundle(bundle)) return [];
  /* «Основа редукса» (`redux-base`): чужую основу подставлять нельзя, кандидатов нет (`sourceParts` и так ничего не вернёт — это явный заслон). */
  if (key === REDUX_BASE_SLOT) return [];
  const mine = cardMembers(bundle, catalog);
  const own = variantOf(part)?.group;
  const byId = new Map(catalog.map((mod) => [mod.id, mod]));
  const seen = new Set();
  const found = [];
  for (const source of catalog) {
    if (!source || mine.has(source.id) || !isCatalogBundle(source)) continue;
    const parts = sourceParts(source, key, byId, slotsOf(part));
    if (!parts.length) continue;
    // Версии той же части (общая группа на уровне части) — меню «Версии», а не замена.
    if (own && parts.every((one) => variantOf(one)?.group === own)) continue;
    const signature = parts.map((one) => one.id).join("|");
    if (seen.has(signature)) continue;
    seen.add(signature);
    found.push({ source, parts, mod: parts[0], slots: [...new Set(parts.flatMap(slotsOf))], fitsProject: fitsProject(parts, bundle) });
  }
  return found.sort(
    (left, right) =>
      Number(right.fitsProject) - Number(left.fitsProject) ||
      String(left.source.name).localeCompare(String(right.source.name)) ||
      String(left.mod.name).localeCompare(String(right.mod.name)),
  );
}
