/*
 * Вещи одного архива — общим паком, как стволы ганпака (задача 5 ТЗ 08.10,
 * вечер).
 *
 * Ганпак — заявка-пак со стволами-детьми: каждый ствол — своя карточка в
 * своём подразделе, пак — карточка со списком членов, который ставит их все
 * разом. Одежда устроена так же: архив «Nike Tech» с худи, штанами и
 * кроссовками — пак «Комплект» (`outfit-pack`, полка «Комплекты») и три вещи
 * в «Верх», «Низ», «Обувь».
 *
 * Пак ставит своим пакетом вещи, у которых в игре есть место: замены вещей
 * игры, DLC Rockstar и вещей сервера, перекраски и наборы перчаток. Новой
 * вещи своего DLC места нет (её ставят вместо выбранной вещи — «На что
 * поставить?»), и сломанную вещь (заявка с блоком) пак не ставит: обе
 * остаются в составе своими карточками, пакет пака их не везёт. Если ставить
 * пакетом нечего (все вещи новые), пака нет: «поставить всё» ничего бы не
 * показало в игре — вещи идут своими карточками, и это сказано словами.
 *
 * Мужская и женская копия одной вещи — не комплект: пак появляется от двух
 * разных мест (вид и номер).
 */

import { COMPONENTS } from "./taxonomy.js";

const problem = (code, message, severity = "info") => ({
  code,
  message,
  severity,
});

/* Короткий хвост id — FNV-1a, как у отпечатков работника (чистый JS). */
function digest(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const plural = (count, one, few, many) => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
};

/** Вещь, которую пак может поставить на её же место в игре. */
export function installableAtOwnPlace(draft) {
  const clothing = draft?.domain?.clothing || {};
  if ((draft?.problems || []).some((item) => item.severity === "block"))
    return false;
  if (clothing.origin === "addon") return false;
  return (draft?.spec?.files || []).length > 0;
}

const placeOf = (draft) => {
  const clothing = draft.domain?.clothing || {};
  return `${clothing.prop ? "p" : ""}${clothing.component}|${clothing.drawable}`;
};

const GENDER_SHORT = { male: "м", female: "ж" };

/* «Худи (м)», «Штаны (ж)» — для описания и подписей кадров. */
const itemWord = (draft) => {
  const clothing = draft.domain?.clothing || {};
  const kind = clothing.garmentLabel || draft.card?.catalogCategory || "Вещь";
  const gender = GENDER_SHORT[clothing.gender];
  return gender ? `${kind} (${gender})` : kind;
};

const listed = (words, shown = 6) =>
  words.length > shown
    ? `${words.slice(0, shown).join(", ")} и ещё ${words.length - shown}`
    : words.join(", ");

/**
 * Пак вещей архива. `drafts` — заявки работника одежды по архиву (вещи,
 * опция «спрятать», пак тату). Возвращает `{ drafts, problems }`: вещи —
 * детьми пака, прочее — как было.
 */
export function outfitPackOf(drafts, { title = "", author = "", slug } = {}) {
  const items = drafts.filter((draft) => draft.kind === "clothing");
  const others = drafts.filter((draft) => draft.kind !== "clothing");
  if (items.length < 2 || new Set(items.map(placeOf)).size < 2)
    return { drafts, problems: [] };
  const installable = items.filter(installableAtOwnPlace);
  const addon = items.filter(
    (draft) => draft.domain?.clothing?.origin === "addon",
  );
  const name = String(title || "").trim() || "Комплект";
  if (!installable.length)
    return {
      drafts,
      problems: [
        problem(
          "outfit-pack-none",
          `${items.length} ${plural(items.length, "вещь", "вещи", "вещей")} архива — ${
            addon.length === items.length
              ? "все новые вещи своего DLC"
              : "ни одну нельзя поставить на её место"
          }: общий пак ставить нечем, каждая вещь — своей карточкой («На что поставить?»).`,
        ),
      ],
    };
  const children = items.map((draft) => draft);
  const ids = children.map((draft) => draft.id).sort();
  const id = `clothing-pack-${(slug?.(name) || "").slice(0, 40) || "set"}-${digest(ids.join("|"))}`;
  /* Пакет пака — вещи, которые встают на свои места; одно место — один файл. */
  const seen = new Set();
  const files = [];
  const specFiles = [];
  for (const draft of installable)
    for (const [index, file] of (draft.files || []).entries()) {
      if (seen.has(file.path)) continue;
      seen.add(file.path);
      files.push(file);
      const entry = draft.spec.files.find((item) => item.source === file.path);
      if (entry) specFiles.push(entry);
      else if (draft.spec.files[index]) specFiles.push(draft.spec.files[index]);
    }
  const first = installable[0];
  const spec = {
    ...first.spec,
    id,
    ...(author ? { author } : {}),
    slots: [...new Set(installable.flatMap((draft) => draft.spec.slots || []))],
    files: specFiles,
  };
  const genders = [
    ...new Set(
      items.map((draft) => draft.domain?.clothing?.gender).filter(Boolean),
    ),
  ];
  const genderWords =
    genders.length === 2
      ? "мужское и женское"
      : genders[0] === "female"
        ? "женское"
        : genders[0] === "male"
          ? "мужское"
          : "пол уточнить";
  const words = items.map(itemWord);
  const left = items.filter((draft) => !installable.includes(draft));
  const description = [
    `Комплект «${name}» — ${items.length} ${plural(items.length, "вещь", "вещи", "вещей")} из одного архива (${genderWords}): ${listed(words)}.`,
    "Каждая вещь — своя карточка в своей категории одежды.",
    left.length
      ? `Пак ставит ${installable.length} из них на их места; ${left.length} — ${
          addon.length === left.length
            ? "новые вещи своего DLC"
            : "своими карточками"
        }: их ставят по одной («На что поставить?»).`
      : "Пак ставит их все разом, каждую — на её место.",
  ].join(" ");
  /* Кадры пака — обложки его вещей (тот же съёмщик, что у мастерской). */
  const gallery = items
    .filter((draft) => draft.media?.cover?.bytes)
    .slice(0, 32)
    .map((draft, index) => ({
      bytes: draft.media.cover.bytes,
      name: `item-${index + 1}`,
      caption: `${draft.card?.name || itemWord(draft)} — рендер вещи из архива`,
      origin: { kind: "render" },
    }));
  const cover = items.find((draft) => draft.media?.cover?.bytes)?.media.cover;
  const platforms = [
    ...new Set(items.flatMap((draft) => draft.card?.platforms || [])),
  ];
  const fingerprints = items
    .map((draft) => draft.fingerprint?.value)
    .filter(Boolean)
    .sort();
  const pack = {
    id,
    kind: "outfit-pack",
    delivery: "package",
    files,
    spec,
    card: {
      name,
      description,
      author,
      category: "clothing",
      categoryLabel: "Одежда",
      section: "clothing",
      slot: "outfit-pack",
      mode: "pack",
      catalogCategory: "Одежда",
      catalogSubcategory: "Комплекты",
      platforms: platforms.length ? platforms : ["gta5rp", "majestic"],
      tags: [
        "комплект",
        ...new Set(
          items
            .map((draft) => draft.domain?.clothing?.garmentLabel)
            .filter(Boolean),
        ),
      ],
    },
    media: { cover: cover || null, gallery, model: null },
    ...(fingerprints.length
      ? {
          fingerprint: {
            algo: "outfit-pack-v1",
            value: digest(fingerprints.join("|")),
            parts: fingerprints,
          },
        }
      : {}),
    children,
    problems: [
      problem(
        "outfit-pack",
        `${items.length} ${plural(items.length, "вещь", "вещи", "вещей")} из одного архива — пак, как у ганпака: вещи — своими карточками (${listed(words, 8)}), пак ставит ${installable.length} разом.`,
      ),
      ...(left.length
        ? [
            problem(
              "outfit-pack-partial",
              `В пакет пака не входят: ${listed(
                left.map((draft) => draft.card?.name || draft.id),
                4,
              )} — ${
                addon.length === left.length
                  ? "новые вещи своего DLC, их места в игре нет"
                  : "у них нет места в игре или вещь не готова"
              }. Они в составе своими карточками.`,
            ),
          ]
        : []),
      ...(cover
        ? []
        : [
            problem(
              "needs-media",
              "Обложка пака — кадр его вещи: снимается в окне Astral вместе с вещами.",
              "warn",
            ),
          ]),
    ],
  };
  return { drafts: [...others, pack], problems: [] };
}

/*
 * Мод тела и кожи одной карточкой (19.10, канал body: «Spiderman Body by
 * GamboHub» — 133 вещи: головы обоих полов, пропы глаз, перчатки, обувь).
 * Человеку нужен сам мод — «тело», а не сотня «Голова №N»: у такого поста
 * одна карточка в «Татуировках» (там же лежит канал body), в её пакете —
 * файлы всех вещей и наложений кожи, которые встают на свои места.
 *
 * Основа — пак тату поста, если он есть (его обложка — рисунок на коже, его
 * галерея), иначе карточка собирается из первой вещи. Вещи без места в игре
 * (новые вещи своего DLC) в пакет не едут — об этом сказано словами.
 */
export function bodyPackOf(
  drafts,
  { title = "", author = "", owner = "", slug, showcase = null } = {},
) {
  const items = drafts.filter((draft) => draft.kind === "clothing");
  const tattoos = drafts.filter((draft) => draft.kind === "clothing-tattoo");
  const others = drafts.filter(
    (draft) => draft.kind !== "clothing" && draft.kind !== "clothing-tattoo",
  );
  /* Кожа и вещи в одном пакете манифест не пускает («тату — своя форма»,
     потолок 64 наложения): Spiderman Body — 36 наложений кожи и 133 вещи.
     Две карточки с одним кадром «тело целиком»: «· кожа» и «· вещи»
     (19.10, ведущая). */
  if (items.length && tattoos.length) {
    const head =
      String(title || "").trim() ||
      (owner ? `Тело · ${owner}` : "Тело персонажа");
    const options = { title, author, owner, slug, showcase };
    const skin = bodyPackOf(tattoos, options).drafts;
    const wear = bodyPackOf([...items, ...others], options).drafts;
    const renamed = (list, tail) =>
      list.map((draft) =>
        draft.kind === "clothing-tattoo"
          ? { ...draft, card: { ...draft.card, name: `${head} · ${tail}` } }
          : draft,
      );
    return {
      drafts: [...renamed(skin, "кожа"), ...renamed(wear, "вещи")],
      problems: [],
    };
  }
  if (!items.length) {
    /* Одна кожа без вещей («Full black body»): карточка уже одна, ей только
       обложка — тело целиком вместо плашки цвета. */
    if (!showcase?.cover || !tattoos.length) return { drafts, problems: [] };
    return {
      drafts: drafts.map((draft) =>
        draft === tattoos[0]
          ? {
              ...draft,
              media: {
                ...draft.media,
                cover: showcase.cover,
                gallery: [
                  ...(showcase.gallery || []),
                  ...(draft.media?.gallery || []),
                ].slice(0, 12),
              },
              /* Кожа сплошного цвета («Full black body») — «рисунка нет» верно
                 для листа, но кадр «тело целиком» у карточки уже есть. */
              problems: (draft.problems || []).filter(
                (item) =>
                  item.code !== "needs-media" &&
                  item.code !== "tattoo-blank" &&
                  item.code !== "tattoo-plates",
              ),
            }
          : draft,
      ),
      problems: [],
    };
  }
  const base = tattoos[0] || items[0];
  const name =
    String(title || "").trim() ||
    (owner ? `Тело · ${owner}` : "Тело персонажа");
  const installable = items.filter(installableAtOwnPlace);
  const left = items.length - installable.length;
  const seen = new Set();
  const files = [];
  const specFiles = [];
  const slots = new Set();
  for (const draft of [...tattoos, ...installable]) {
    const entries = draft.spec?.files || [];
    for (const [index, file] of (draft.files || []).entries()) {
      if (seen.has(file.path)) continue;
      seen.add(file.path);
      files.push(file);
      const entry =
        entries.find((item) => item.source === file.path) || entries[index];
      if (entry) specFiles.push(entry);
    }
    for (const slot of draft.spec?.slots || []) slots.add(slot);
  }
  if (!files.length) return { drafts, problems: [] };
  const ids = [...tattoos, ...items].map((draft) => draft.id).sort();
  const id = `clothing-body-${(slug?.(name) || "").slice(0, 40) || "body"}-${digest(ids.join("|"))}`;
  const genders = [
    ...new Set(
      items.map((draft) => draft.domain?.clothing?.gender).filter(Boolean),
    ),
  ];
  const genderWords =
    genders.length === 2
      ? "мужское и женское"
      : genders[0] === "female"
        ? "женское"
        : genders[0] === "male"
          ? "мужское"
          : "оба пола";
  /* Из чего тело — по компонентам: голова, перчатки, обувь… */
  const parts = [
    ...new Set(
      items.map((draft) =>
        String(
          COMPONENTS[draft.domain?.clothing?.component]?.label ||
            draft.card?.name ||
            "вещь",
        ).toLowerCase(),
      ),
    ),
  ];
  const cover =
    showcase?.cover ||
    tattoos[0]?.media?.cover ||
    items.find((draft) => draft.media?.cover?.bytes)?.media.cover ||
    null;
  const gallery = [
    ...(showcase?.gallery || []),
    ...(tattoos[0]?.media?.gallery || []),
    /* По кадру на вид вещи, а не на каждый номер (29.10.2026, владелец: «десятки одинаковых кадров»): шесть голов одного мода — шесть почти одинаковых лиц, голова одна. */
    ...items
      .filter((draft) => draft.media?.cover?.bytes)
      .filter(
        (draft, at, list) =>
          list.findIndex(
            (other) => other.domain?.clothing?.component === draft.domain?.clothing?.component,
          ) === at,
      )
      .slice(0, 6)
      .map((draft, index) => ({
        bytes: draft.media.cover.bytes,
        name: `body-${index + 1}`,
        caption: `${draft.card?.name || "Вещь"} — рендер из архива`,
        origin: { kind: "render" },
      })),
  ].slice(0, 12);
  const fingerprints = [...tattoos, ...items]
    .map((draft) => draft.fingerprint?.value)
    .filter(Boolean)
    .sort();
  /* Галерея мода тела собрана заново (кадры тела, тату и вещей): пути кадров вариантов, что несла основа, в ней не существуют — ссылка на несуществующий кадр не даёт ни
     пересобрать галерею, ни показать расцветку. Расцветки остаются, кадра у них нет. */
  const noPreviews = base.domain?.clothing?.sets
    ? {
        domain: {
          ...base.domain,
          clothing: {
            ...base.domain.clothing,
            sets: base.domain.clothing.sets.map((set) => ({
              ...set,
              variants: (set.variants || []).map((variant) => ({
                ...variant,
                preview: null,
                ...("previewAlt" in variant ? { previewAlt: null } : {}),
              })),
            })),
          },
        },
      }
    : {};
  const pack = {
    ...base,
    ...noPreviews,
    id,
    kind: "clothing-tattoo",
    delivery: "package",
    files,
    spec: {
      ...base.spec,
      id,
      ...(author ? { author } : {}),
      slots: [...slots],
      files: specFiles,
    },
    card: {
      ...base.card,
      name,
      description: `Тело и кожа персонажа: ${files.length} ${plural(files.length, "файл", "файла", "файлов")} (${genderWords}) — ${listed(parts, 8)}. Одна карточка на весь мод: файлы встают на свои места в игре.${
        left
          ? ` ${left} ${plural(left, "вещь", "вещи", "вещей")} без места в игре (новые вещи DLC) в пакет не входят.`
          : ""
      }`,
      author,
      category: "clothing",
      categoryLabel: "Одежда",
      section: "clothing",
      slot: "tattoos",
      catalogCategory: "Татуировки",
      mode: "selective",
      tags: ["Татуировки", "тело"],
    },
    media: {
      cover,
      gallery,
      model: tattoos[0]?.media?.model || null,
    },
    ...(fingerprints.length
      ? {
          fingerprint: {
            algo: "body-pack-v1",
            value: digest(fingerprints.join("|")),
            parts: fingerprints,
          },
        }
      : {}),
    problems: [
      ...(tattoos[0]?.problems || []).filter(
        (item) =>
          !(
            cover &&
            (item.code === "tattoo-blank" || item.code === "tattoo-plates")
          ),
      ),
      problem(
        "body-pack",
        `${items.length} ${plural(items.length, "вещь", "вещи", "вещей")} и ${tattoos.length ? "наложения кожи" : "ничего больше"} поста — мод тела одной карточкой, вещи отдельными карточками не заводятся.`,
      ),
      ...(left
        ? [
            problem(
              "body-pack-partial",
              `${left} ${plural(left, "вещь", "вещи", "вещей")} без места в игре в пакет не вошли.`,
            ),
          ]
        : []),
      ...(cover
        ? []
        : [
            problem(
              "needs-media",
              "Обложка тела — кадр целиком: снимается в окне Astral вместе с вещами.",
              "warn",
            ),
          ]),
    ],
  };
  return { drafts: [...others, pack], problems: [] };
}
