/*
 * Из списка тронутых файлов — в находки, которые понятны человеку.
 *
 * Модератор не должен читать восемнадцать тысяч путей. Ему нужен ответ на
 * другом языке: «здесь мини-карта, трассеры, четыре ствола и залазы». Поэтому
 * классификатор не просто помечает файлы, а собирает их в находки: одна
 * находка — один будущий мод в каталоге, со своим слотом и своими файлами.
 *
 * Три вещи, которые здесь важнее полноты.
 *
 * 1. Уверенность видна всегда. `exact` — совпал проверенный маршрут каталога,
 *    `likely` — сработал структурный признак, `unknown` — не подошло ничего.
 *    Находка всегда показывает, чем именно опознана.
 *
 * 2. Спорные маршруты не разрешаются молча. `timecycle_mods_*.xml` правят и
 *    таймцикл, и килл-эффект, и одна из оптимизаций: какой именно модификатор
 *    тронут, по имени файла не узнать. Находка перечисляет всех претендентов
 *    и оставляет выбор человеку.
 *
 * 3. Публикуемость считается по таблице целей, а не по уверенности. Уверенно
 *    опознанная категория без доказанного маршрута установки к публикации не
 *    предлагается: опознать — не то же самое, что уметь поставить.
 *
 * Разница — вторая опора разбора, не первая. Файлы авторских контейнеров
 * сюда не попадают: их разбирает опора контейнеров (`containers.js`). А когда
 * архив собран под другую сборку игры, разница честна только по известным
 * маршрутам, и то с оговоркой: остальное — отличия версий, не моды.
 */

import { getLegacyModTarget } from "@modovik/mod-targets";
import { GRAPHICS_ENTRY, graphicsIsSky } from "@modovik/mod-targets/sky-files";
import { touchedEntries } from "./diff.js";
import { containerFileNames } from "./containers.js";
import {
  FINDING_CATEGORIES,
  NEVER_PUBLISHABLE,
  exactRouteIndex,
  matchStructuralRule,
} from "./rules.js";

const CONFIDENCE_ORDER = { exact: 0, likely: 1, unknown: 2 };
const VERDICT_ORDER = { ready: 0, review: 1, no: 2 };

const DRIFT_REASON =
  "Архив от другой сборки игры: файл отличается от вашей игры, но причиной " +
  "может быть версия игры, а не правка автора. Проверьте перед публикацией.";

function verdictFor(category, target) {
  if (NEVER_PUBLISHABLE.has(category))
    return {
      publishable: "no",
      reason:
        category === "scripts"
          ? "Игровые скрипты меняют правила сервера — решение принимается отдельно, а не разбором архива."
          : category === "unknown"
            ? "Категория не опознана: публиковать файл, о котором ничего не известно, нельзя."
            : category === "build-drift"
              ? "Отличия версий игры, а не мод: архив собран под другую сборку."
              : category === "world-lod"
                ? "Только дальние модели (LOD) места, без самого места — частью не бывают."
                : category === "stock-copy"
                  ? "Копии файлов игры — те же байты, что в игре: правки нет."
                  : "Это след установки, а не мод.",
    };
  if (!target)
    return {
      publishable: "no",
      reason: "Для этой категории нет проверенного маршрута установки.",
    };
  if (target.readiness === "ready")
    return {
      publishable: "ready",
      reason: "Маршрут установки проверен — пакет можно собирать.",
    };
  if (target.readiness === "candidate")
    return {
      publishable: "review",
      reason:
        "Маршрут реализован, но игровой smoke-тест не пройден — нужна ручная проверка.",
    };
  return {
    publishable: "no",
    reason: "Маршрут установки заблокирован.",
  };
}

function findingTitle(category, group) {
  const label = FINDING_CATEGORIES[category]?.label || category;
  if (!group) return label;
  if (category === "weapon-model") return `Оружие · ${group}`;
  if (category === "clothing") return `Одежда · ${group}`;
  return `${label} · ${group}`;
}

const shapeTarget = (target) =>
  target
    ? {
        id: target.id,
        label: target.label,
        strategy: target.strategy,
        readiness: target.readiness || "blocked",
      }
    : null;

/**
 * Пересобирает находку под другую категорию — после того, как содержимое
 * файла показало, кому она на самом деле принадлежит.
 *
 * Вердикт и слот пересчитываются вместе с категорией: та же находка под другой
 * категорией может оказаться и готовой к сборке, и непубликуемой, и оставить
 * старый вердикт значило бы соврать дважды.
 */
export function recategorizeFinding(
  finding,
  category,
  evidence,
  { targetLookup = getLegacyModTarget, group = finding.group, ...extra } = {},
) {
  const target = targetLookup(category) || null;
  return {
    ...finding,
    ...extra,
    group,
    id: group ? `${category}:${group}` : category,
    category,
    title: findingTitle(category, group),
    label: FINDING_CATEGORIES[category]?.label || category,
    section: FINDING_CATEGORIES[category]?.section || null,
    slot: FINDING_CATEGORIES[category]?.slot || null,
    evidence,
    candidates: null,
    refinedFrom: finding.category,
    target: shapeTarget(target),
    ...verdictFor(category, target),
  };
}

/** Порядок карточек — порядок пользы: готовое выше неопознанного, крупное выше. */
export function sortFindings(findings) {
  return [...findings].sort(
    (left, right) =>
      VERDICT_ORDER[left.publishable] - VERDICT_ORDER[right.publishable] ||
      CONFIDENCE_ORDER[left.confidence] - CONFIDENCE_ORDER[right.confidence] ||
      right.bytes - left.bytes ||
      left.title.localeCompare(right.title, "ru"),
  );
}

/** Сводка по находкам — для шапки отчёта. */
export function summarizeFindings(findings, diff) {
  return {
    findings: findings.length,
    ready: findings.filter((item) => item.publishable === "ready").length,
    review: findings.filter((item) => item.publishable === "review").length,
    rejected: findings.filter((item) => item.publishable === "no").length,
    unknownFiles: findings
      .filter((item) => item.category === "unknown")
      .reduce((total, item) => total + item.files, 0),
    driftFiles: findings
      .filter((item) => item.category === "build-drift")
      .reduce((total, item) => total + item.files, 0),
    files: diff.totals.added + diff.totals.changed + diff.totals.removed,
    bytes: diff.totals.touchedBytes,
  };
}

/**
 * Собирает находки из разницы отпечатков.
 *
 * `targetLookup` подменяется в тестах, чтобы проверять классификатор без
 * таблицы целей; в бою это она и есть. `containers` — авторские контейнеры,
 * чьи файлы разбираются отдельно; `buildMatch` — совпадение сборок: при
 * расхождении разница сжимается до известных маршрутов с оговоркой.
 */
const VECTOR_MAP_CONTAINER = "x64/levels/gta5/minimap.rpf";

export function classifyChanges(
  diff,
  {
    targetLookup = getLegacyModTarget,
    containers = [],
    buildMatch = null,
  } = {},
) {
  const routes = exactRouteIndex();
  /* Маршрут-контейнер (`x64/levels/gta5/minimap.rpf` — векторная большая
     карта): правки внутри штатного архива — одна находка «контейнер
     целиком», как у авторского контейнера (containers.js). Без этого плитки
     радара по одной не находили маршрута: у COMPETITIVE терялись (перепись
     11.10), у GNEV уходили в «Оптимизацию объектов». */
  const containerRoutes = [...routes.keys()]
    .filter((key) => key.endsWith(".rpf"))
    .map((key) => ({ key, prefix: `${key}/`, route: routes.get(key) }));
  /* Что автор менял (добавил или изменил): `graphics.ytd` — небо или «убрать частицы», решают соседи (`graphicsIsSky`). */
  const changedPaths = new Set(
    touchedEntries(diff)
      .filter((entry) => entry.change !== "removed")
      .map((entry) => entry.path.replaceAll("\\", "/").toLowerCase()),
  );
  const buckets = new Map();
  const drift = Boolean(buildMatch?.comparable && !buildMatch.same);
  const foreign = containers
    .filter((item) => !item.astral)
    .map((item) => `${String(item.path).toLowerCase()}/`);
  const brought = containerFileNames(containers);

  const place = (
    entry,
    { category, group = null, confidence, evidence, candidates, uncertain, container = null },
  ) => {
    const id = container ? `${category}@${container}` : group ? `${category}:${group}` : category;
    if (!buckets.has(id))
      buckets.set(id, {
        id,
        category,
        group,
        ...(container ? { container } : {}),
        title: findingTitle(category, group),
        confidence,
        evidence,
        candidates: candidates || null,
        uncertain: Boolean(uncertain),
        entries: [],
      });
    const bucket = buckets.get(id);
    /* Уверенность находки — лучшая из её файлов: если хотя бы один совпал с
       точным маршрутом, находка точная, а не «возможно». */
    if (CONFIDENCE_ORDER[confidence] < CONFIDENCE_ORDER[bucket.confidence]) {
      bucket.confidence = confidence;
      bucket.evidence = evidence;
    }
    bucket.entries.push(entry);
  };

  for (const entry of touchedEntries(diff)) {
    const path = entry.path.replace(/\\/g, "/").toLowerCase();
    /* Авторский контейнер разобран целиком другой опорой. */
    if (foreign.some((prefix) => path.startsWith(prefix))) continue;
    const name = path.split("/").pop();
    /* Файл переехал в авторский контейнер: автор вырезал штатный
       `minimap.gfx` и положил свой в `core.rpf`. Это одна правка, и она уже
       учтена контейнером; удаление штатного файла публиковать нельзя. */
    if (entry.change === "removed" && brought.has(name)) continue;
    let exact = routes.get(path);
    if (exact?.length && path === GRAPHICS_ENTRY) {
      const sky = graphicsIsSky(changedPaths);
      exact = exact.filter((item) => (item.id === "timecycle") === sky);
    }
    const whole =
      !exact?.length && entry.change !== "removed"
        ? containerRoutes.find((item) => path.startsWith(item.prefix))
        : null;
    if (whole) {
      place(entry, {
        category: whole.route[0].id,
        container: whole.key,
        confidence: drift ? "likely" : "exact",
        evidence: drift
          ? "архив-маршрут каталога, но архив от другой сборки — правка может быть не авторской"
          : `правки внутри ${whole.key.split("/").pop()} — архив ставится целиком`,
        uncertain: drift,
      });
      continue;
    }
    /* При другой сборке вырезанное — не правка автора, а отсутствие того,
       что Rockstar добавил позже; а штатный файл, который автор принёс в
       своём контейнере, отличается от базы версией, не содержимым. */
    if (
      drift &&
      (entry.change === "removed" || (exact?.length && brought.has(name)))
    ) {
      place(entry, {
        category: "build-drift",
        confidence: "unknown",
        evidence: buildMatch.reason,
      });
      continue;
    }
    if (exact?.length) {
      const ids = [...new Set(exact.map((item) => item.id))];
      /* У категории с опциями маршрут принадлежит конкретному переключателю:
         восемь оптимизаций — это восемь слотов каталога, и складывать их в
         одну находку значило бы предложить публиковать их одним модом. */
      const option = ids.length === 1 ? exact[0].option || null : null;
      place(entry, {
        category: ids[0],
        group: option,
        confidence: drift ? "likely" : "exact",
        evidence: drift
          ? "маршрут каталога, но архив от другой сборки — правка может быть не авторской"
          : "точный маршрут каталога",
        candidates: ids.length > 1 ? ids : null,
        uncertain: drift,
      });
      continue;
    }
    /* При другой сборке структурные признаки изменённого файла не значат
       ничего: каждый ствол и каждая текстура отличаются версией. Всё это —
       одна строка отчёта. Новый файл — другое дело (17.10): его нет в
       штатном архиве, версией он быть не может. У kray v2 redux так
       тонули вода (`water.xml`, `water.ytd`), блики, трава, таблицы
       эффектов. Такой файл идёт своим правилом, но под взгляд человека. */
    const structural = matchStructuralRule(path);
    if (drift && !(entry.change === "added" && structural)) {
      place(entry, {
        category: "build-drift",
        confidence: "unknown",
        evidence: buildMatch.reason,
      });
      continue;
    }
    if (structural) {
      place(entry, {
        category: structural.rule.category,
        group: structural.rule.group?.(structural.normalized) || null,
        confidence: "likely",
        evidence: drift
          ? `${structural.rule.evidence} — новый файл, в штатном архиве его нет (архив от другой сборки)`
          : structural.rule.evidence,
        ...(drift ? { uncertain: true } : {}),
      });
      continue;
    }
    place(entry, {
      category: "unknown",
      confidence: "unknown",
      evidence: "не подошло ни одно правило",
    });
  }

  const findings = [...buckets.values()].map((bucket) => {
    const target = targetLookup(bucket.category) || null;
    const verdict = verdictFor(bucket.category, target);
    /* Неуверенная правка публикуется только после взгляда человека. */
    if (bucket.uncertain && verdict.publishable === "ready") {
      verdict.publishable = "review";
      verdict.reason = DRIFT_REASON;
    } else if (bucket.uncertain && verdict.publishable === "review") {
      verdict.reason = DRIFT_REASON;
    }
    const changes = { added: 0, changed: 0, removed: 0 };
    let bytes = 0;
    for (const entry of bucket.entries) {
      changes[entry.change] += 1;
      bytes += Number(entry.size) || 0;
    }
    /* Контейнер целиком — как в containers.js: ставится одним файлом. */
    const whole = bucket.container
      ? {
          delivery: "route-container",
          installEntry: bucket.container,
          installAction: routes.get(bucket.container)?.[0]?.action || "import",
          container: { path: bucket.container },
          ...(bucket.container === VECTOR_MAP_CONTAINER ? { variant: "vector" } : {}),
          title: `${FINDING_CATEGORIES[bucket.category]?.label || bucket.category}${bucket.container === VECTOR_MAP_CONTAINER ? " · векторная" : ""}`,
        }
      : {};
    return {
      ...bucket,
      ...whole,
      label: FINDING_CATEGORIES[bucket.category]?.label || bucket.category,
      section: FINDING_CATEGORIES[bucket.category]?.section || null,
      slot: FINDING_CATEGORIES[bucket.category]?.slot || null,
      origin: "diff",
      files: bucket.entries.length,
      bytes,
      changes,
      target: shapeTarget(target),
      ...verdict,
    };
  });

  const sorted = sortFindings(findings);
  return { findings: sorted, summary: summarizeFindings(sorted, diff) };
}

/**
 * Категории, в которые находку можно переназначить руками.
 *
 * Разбор честно говорит, чего не знает: `.ymap` залаза, интерьера и маппинга
 * выглядят одинаково, и по пути их не разделить. Зато это знает человек,
 * который принёс редукс. Список — те категории, для которых приложение умеет
 * собрать пакет; переназначить находку в тупик нельзя.
 */
export function assignableCategories({
  targetLookup = getLegacyModTarget,
} = {}) {
  return Object.entries(FINDING_CATEGORIES)
    .filter(([id]) => !NEVER_PUBLISHABLE.has(id))
    .map(([id, meta]) => ({
      id,
      label: meta.label,
      readiness: targetLookup(id)?.readiness || null,
    }))
    .filter(
      (item) => item.readiness === "ready" || item.readiness === "candidate",
    )
    .sort((left, right) => left.label.localeCompare(right.label, "ru"));
}
