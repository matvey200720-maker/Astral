/*
 * Перекладка выложенного каталога одежды по воротам качества (ТЗ владельца 11.11.2026): что с каждой вещью — оставить, урезать или снять с выдачи.
 *
 * Вход — запись переписи вещи (`scripts/clothing-defects-census.mjs`: какие расцветки пакета штатные, пустые, с дырами) и карточка каталога. Правило то же, что у разбора нового
 * поста (`quality-gate.js`): штатные, пустые, не ложащиеся на модель расцветки не идут ни в карточку, ни в пакет; вещь, у которой своих расцветок не осталось, снимается с выдачи.
 * Доказательства глазами идут отдельной таблицей `manual` (`{ slug: { drop: ["d"], why } }`): выбившийся лист сам отказом не бывает.
 *
 * Модуль чистый: запись переписи, карточка и ручная таблица приходят параметрами.
 */

import { repairPlaces } from "./places-fix.js";
import { itemVerdict, textureVerdict, verdictMessage } from "./quality-gate.js";
import { ownColourSets } from "./stock-textures.js";

/**
 * @param {object} input
 * @param {object} input.card карточка каталога (`domain.clothing.sets`, `media.gallery`, `domain.clothing.coverLetter`)
 * @param {object} input.record запись переписи вещи: `source`, `textures.stockLetters`, `ownTextures`, `flatReason`
 * @param {{ drop?: string[], why?: string, reshoot?: boolean, hand?: boolean }|null} [input.manual] решение человека по вещи: `drop` — расцветки (буквы файлов пакета) долой, `reshoot` — обложку и кадры снять заново,
 *   `hand` — снимать на штатной руке игры (ногти, `handShowcase`)
 * @param {Record<string, string>|null} [input.verified] проверка по хэшу содержимого (`scripts/clothing-stock-verify.mjs`): буква расцветки → `confirmed:<файл игры>` | `refuted` | `unreadable:…`.
 *   Расцветку режут только по `confirmed`: совпадение размера — признак, а не доказательство (два сжатых листа бывают одной длины при разном рисунке). Без `verified` ни одна штатная
 *   расцветка не режется — все «не доказаны»; `refuted` — размер совпал, содержимое нет: это расцветка автора, она остаётся
 * @param {Record<string, string>|null} [input.swatches] кадр (`source`) → цвет `#rrggbb` для расцветки, которую пакет несёт, а карточка не знала (`places-fix.js`)
 * @returns {{ action: "keep"|"trim"|"fix"|"unpublish"|"unknown", reasons: string[], dropLetters: string[], ownLetters: string[], sets?: object[], dropFrames?: string[],
 *   coverLetter?: string, reshoot?: boolean, evidence: string, places?: object }}
 *   trim — пакет урезается и карточка правится; fix — пакет прежний, правится карточка (кадры, расцветки).
 */
export function planRebuild({ card, record, manual = null, verified = null, swatches = {} }) {
  if (!record || (record.source !== "cdn" && record.source !== "local"))
    return { action: "unknown", reasons: ["нет пакета в переписи: хэш каталога пакета неизвестен"], dropLetters: [], ownLetters: [], evidence: "none" };
  /* Кэш лаунчера хранит для просмотра не больше четырёх расцветок: список файлов в нём неполон, решать по нему нельзя. */
  if (record.source === "local")
    return { action: "unknown", reasons: ["пакет известен только по кэшу лаунчера (неполный): нужен mod.json с CDN"], dropLetters: [], ownLetters: [], evidence: "local-cache" };

  /* Тату и вещи без расцветок `<компонент>_diff_…` в пакете (рисунки наложений, голая модель) — у них своя схема файлов: ворота расцветок их не касаются. */
  if (card?.placement?.slot === "tattoos" || card?.domain?.clothing?.category === "tattoos" || !(record.textures?.inPackage > 0))
    return { action: "keep", reasons: [], dropLetters: [], ownLetters: [], evidence: "no-colour-files" };
  const bySize = String(record.textures?.stockLetters || "").split("").filter(Boolean);
  const stock = new Set(bySize.filter((letter) => String(verified?.[letter] || "").startsWith("confirmed")));
  /* Совпал размер, а хэш — нет или проверить нечем: не режем, говорим об этом словами. */
  const unproven = bySize.filter((letter) => !stock.has(letter) && verified?.[letter] !== "refuted");
  const refuted = bySize.filter((letter) => verified?.[letter] === "refuted");
  const forced = new Set(manual?.drop || []);
  const verdicts = new Map();
  const reasons = [];
  const suspects = [];
  const kinds = new Map();
  for (const letter of [...unproven, ...refuted]) kinds.set(letter, { kind: "own" });
  for (const entry of record.ownTextures || []) {
    const verdict = forced.has(entry.letter)
      ? { keep: false, code: "texture-layout", detail: "manual" }
      : textureVerdict({ empty: entry.empty, holes: entry.holes, outlier: entry.outlier });
    if (verdict.suspect) suspects.push(`${entry.letter.toUpperCase()}: ${verdictMessage(entry.letter.toUpperCase(), { code: verdict.suspect }, { holes: entry.holes })}`);
    verdicts.set(entry.letter, verdict);
    kinds.set(entry.letter, { kind: verdict.keep ? "own" : "dropped" });
    if (!verdict.keep) reasons.push(forced.has(entry.letter) ? `${verdictMessage(entry.letter.toUpperCase(), verdict)} ${manual?.why || ""}`.trim() : verdictMessage(entry.letter.toUpperCase(), verdict, { holes: entry.holes }));
  }
  for (const letter of stock) {
    const verdict = textureVerdict({ stock: true });
    verdicts.set(letter, verdict);
    kinds.set(letter, { kind: "stock" });
    reasons.push(verdictMessage(letter.toUpperCase(), verdict));
  }
  const decision = itemVerdict({ flatReason: record.flatReason || null, verdicts: [...verdicts.values()] });
  const ownLetters = [...kinds].filter(([, value]) => value.kind === "own").map(([letter]) => letter).sort();
  const dropLetters = [...kinds].filter(([, value]) => value.kind !== "own").map(([letter]) => letter).sort();
  const evidence = stock.size ? "hash" : "census";
  const proof = { unproven, refuted };
  if (!decision.pass) return { action: "unpublish", reasons: [decision.message, ...reasons], suspects, ...proof, dropLetters, ownLetters, evidence };

  const sets = ownColourSets(card?.domain?.clothing?.sets || [], kinds);
  const before = (card?.domain?.clothing?.sets || []).reduce((sum, set) => sum + (set.variants?.length || 0), 0);
  const gone = new Set(
    (card?.domain?.clothing?.sets || []).flatMap((set) => (set.variants || []).filter((variant) => !ownLetters.includes(variant.letter)).flatMap((variant) => [variant.preview, variant.previewAlt])).filter(Boolean),
  );
  /* Места карточки (ссылки на кадры, двойники, расцветки пакета без записи, кадры без расцветки) — `places-fix.js`: карточка, кадры и пакет должны говорить об одном и том же. */
  const repair = repairPlaces({
    sets: sets.sets,
    gallery: (card?.media?.gallery || []).filter((frame) => !gone.has(frame.source)),
    letters: ownLetters,
    swatches,
  });
  const places = { repointed: repair.repointed, deduped: repair.deduped, adopted: repair.adopted, droppedFrames: repair.dropFrames, unresolved: repair.unresolved };
  /* Расцветки карточки без файла в пакете тоже уходят (штатные цвета, нарисованные по номеру) — но у вещи, где пакет и карточка сходятся, их нет. */
  if (!dropLetters.length && sets.dropped === 0 && !repair.changed && !manual?.reshoot) return { action: "keep", reasons: [], suspects, ...proof, places, dropLetters: [], ownLetters, evidence };

  const first = card?.domain?.clothing?.sets?.[0]?.variants?.[0]?.letter;
  const coverLetter = card?.domain?.clothing?.coverLetter || "";
  const coverGone = Boolean(coverLetter) && !ownLetters.includes(coverLetter);
  return {
    /* Пакет урезается — `trim` (новая версия пакета); только карточка (кадры, расцветки) — `fix`: пакет остаётся прежним. */
    action: dropLetters.length ? "trim" : "fix",
    reasons: dropLetters.length ? reasons : [...reasons, ...describePlaces(places)],
    suspects,
    ...proof,
    places,
    dropLetters,
    ownLetters,
    sets: repair.sets,
    dropFrames: [...gone, ...repair.dropFrames],
    coverLetter: coverGone || !coverLetter ? repair.sets[0]?.variants?.[0]?.letter || "" : coverLetter,
    /* Обложка нарисована расцветкой, которой больше нет, либо первая расцветка (по ней собирается «3D») сменилась — обложка и GLB снимаются заново. */
    reshoot: coverGone || first !== repair.sets[0]?.variants?.[0]?.letter || manual?.reshoot === true,
    /* Вещь снимается на руке (ногти): `manual.hand` — штатная рука игры под вещью, `stock-body.js` → `handShowcase`. */
    ...(manual?.hand === true ? { hand: true } : {}),
    evidence,
    droppedVariants: before - sets.kept,
  };
}

/** Что починено в местах карточки — словами, для таблицы плана. */
export function describePlaces(places) {
  const lines = [];
  if (places.repointed) lines.push(`ссылок расцветок на кадры переведено: ${places.repointed}`);
  if (places.deduped) lines.push(`двойников расцветок убрано: ${places.deduped}`);
  if (places.adopted?.length) lines.push(`расцветок пакета добавлено в карточку: ${places.adopted.map((one) => one.letter.toUpperCase()).join(", ")}`);
  if (places.droppedFrames?.length) lines.push(`кадров без расцветки убрано: ${places.droppedFrames.length}`);
  return lines;
}
