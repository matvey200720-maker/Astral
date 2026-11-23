import { variantOf } from "@modovik/publishing";
import { isClothingCard } from "./mod-card/ModCardParts.jsx";
import { useMemo as cached } from "react";
import { variantLabelText as labelText, variantSiblings } from "../../../catalog-utils.js";
import { rememberVariant, useRememberedVariant } from "../../../features/catalog/card-variant.js";

// Операции очереди, при которых группа вариантов занята.
const BUSY_OPERATIONS = new Set(["install", "remove"]);

// Строка панели выбора: подпись из блока варианта, а без неё имя мода; полная подпись остаётся подсказкой.
function pickerRow(variant) {
  const label = labelText(variantOf(variant)?.label) || variant.name;
  return { value: variant.id, label, title: label };
}

// Одежду ведёт стоящая вещь или главная по рангу; остальное — выбор человека (он запомнен), потом стоящая, потом сам мод.
function chooseTarget({ mod, variants, standing, wanted, clothing }) {
  if (clothing) return standing || variants[0] || mod;
  return variants.find((variant) => variant.id === wanted) || standing || mod;
}

// Запись очереди касается группы: сама запись варианта, часть любой его сборки или метка сборки.
function groupQueueIds(variants) {
  const members = variants.flatMap((variant) => [variant.id, ...(variant.includedModIds || [])]);
  return { own: new Set(variants.map((variant) => variant.id)), all: new Set(members) };
}

const isBusyEntry = (entry, ids) =>
  BUSY_OPERATIONS.has(entry.operation) && (ids.all.has(entry.id) || ids.own.has(entry.bundleId));

// Всё, что хук отдаёт странице; ключи идут в порядке target, ready, active, variantChoice, shown.
function summarize({ mod, variants, installed, queue, wanted, group }) {
  const clothing = isClothingCard(mod);
  const standing = variants.find((variant) => installed.includes(variant.id)) ?? null;
  const target = chooseTarget({ mod, variants, standing, wanted, clothing });
  const ids = groupQueueIds(variants);

  const summary = { target };
  summary.ready = installed.includes(target.id);
  summary.active = queue.find((entry) => ids.own.has(entry.id) && BUSY_OPERATIONS.has(entry.operation));
  const busy = queue.some((entry) => isBusyEntry(entry, ids));
  const choose = (id) => {
    rememberVariant(group, id);
  };
  summary.variantChoice = clothing || variants.length < 2 ? null : { value: target.id, onChange: choose, options: variants.map(pickerRow), busy };
  // Страница показывает ту версию, что выбрана: обложка, кадры, состав, вес и установка — одной записи. У одежды вариант — цвет и пол, страница остаётся своей.
  summary.shown = clothing ? mod : target;
  return summary;
}

export function useModVariant(args) {
  const { mod, allMods = [], installed, queue } = args;
  const group = variantOf(mod)?.group || "";
  const wanted = useRememberedVariant(group);
  const variants = cached(() => variantSiblings(mod, allMods), [mod, allMods]);
  return summarize({ mod, variants, installed, queue, wanted, group });
}
