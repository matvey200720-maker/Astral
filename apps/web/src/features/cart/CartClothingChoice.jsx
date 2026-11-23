import { Suspense, lazy, useEffect } from "react";
import { clothingInstallKind } from "@modovik/clothing/install-kind";
import { clothingOf } from "../clothing/clothing-catalog.js";
import { tattooSetOf } from "../clothing/tattoo-set.js";
import { useDefaultTarget } from "../clothing/useDefaultTarget.js";

/*
 * Выбор цели для вещи одежды из корзины (владелец, 16.11.2026: «у одежды при установке человек выбирает, на что именно ставить»). Те же окна и тот же выбор, что у «Установить» на карточке
 * вещи (`useInstallFlow` в `ModDetailPage.jsx`): «Сделать заменёнку» для одной вещи на замену, «На что ставится» для вещи со своим местом, «Куда поставить татуировки» для набора тату. Подтверждённый выбор
 * превращается в те же записи установки, что у карточки: `{ ...мод, clothingChoice }`, `{ ...мод, tattooSetChoice }` или сам мод; ставит их оболочка (`onInstall`), как и там.
 *
 * Окна грузятся отдельным куском и только когда человек нажал «Установить» у вещи: корзина в стартовый кусок окна их не тянет.
 */

const ClothingInstallDialog = lazy(
  () => import("../../components/desktop/catalog/ClothingInstallDialog.jsx"),
);
const ClothingPlaceDialog = lazy(
  () => import("../../components/desktop/catalog/ClothingPlaceDialog.jsx"),
);
const TattooSetDialog = lazy(
  () => import("../../components/desktop/catalog/TattooSetDialog.jsx"),
);

const isClothingCard = (mod) =>
  mod?.catalogCategory === "clothing" || mod?.catalogSection === "clothing";

/** Какое окно нужно вещи: `"install"`, `"place"`, `"tattoo"` или пусто — окна нет (тогда установка идёт с карточки). Правило то же, что `dialogFor` у карточки. */
export function clothingDialogFor(mod) {
  const kind = clothingInstallKind(mod);
  if (["pick", "gloves"].includes(kind) && clothingOf(mod)?.component)
    return "install";
  if (kind === "tattoo" && tattooSetOf(mod)) return "tattoo";
  return kind || isClothingCard(mod) ? "place" : "";
}

/** Записи установки по подтверждённому выбору: как `confirmations` карточки, по одной на вещь. */
export function installRequests(dialog, mod, catalog, selection) {
  if (dialog === "install") {
    const { installs = [], ...choice } = selection;
    const steps = installs.length
      ? installs.map(({ modId, ...record }) => ({
          mod: catalog.find((entry) => entry.id === modId) ?? mod,
          choice: {
            ...choice,
            ...record,
            targets: record.targets ?? [record.target],
          },
        }))
      : [{ mod, choice }];
    return steps.map((step) => ({ ...step.mod, clothingChoice: step.choice }));
  }
  if (dialog === "tattoo")
    return [{ ...mod, tattooSetChoice: { picks: selection.picks } }];
  return [mod];
}

/**
 * `mod` — вещь из корзины, `catalog` — весь каталог (окна ищут в нём штатные вещи и соседей), `onDone(записи)` — выбор подтверждён, `onClose` — окно закрыто без выбора,
 * `onNoDialog` — у вещи окна выбора нет (её ставят с карточки): корзина открывает карточку.
 */
export default function CartClothingChoice({
  mod,
  catalog = [],
  onDone,
  onClose,
  onNoDialog,
}) {
  const dialog = clothingDialogFor(mod);
  useEffect(() => {
    if (!dialog) onNoDialog?.();
  }, [dialog, onNoDialog]);
  const block = clothingOf(mod);
  const tattooParts = tattooSetOf(mod);
  /* Цель по умолчанию — как у карточки: предложение, а не тихая установка; ставит человек, нажав «Установить» в окне. */
  const preset = useDefaultTarget(block ? mod : null, catalog, "off:");
  const confirm = (selection) =>
    onDone(installRequests(dialog, mod, catalog, selection));
  return (
    <Suspense fallback={null}>
      {dialog === "install" && Boolean(block) && (
        <ClothingInstallDialog
          mod={mod}
          mods={catalog}
          preset={
            preset.state === "ready" ? (preset.target?.key ?? null) : null
          }
          onClose={onClose}
          onConfirm={confirm}
        />
      )}
      {dialog === "place" && (
        <ClothingPlaceDialog
          mod={mod}
          mods={catalog}
          onClose={onClose}
          onConfirm={confirm}
        />
      )}
      {dialog === "tattoo" && Boolean(tattooParts) && (
        <TattooSetDialog
          mod={mod}
          parts={tattooParts}
          onClose={onClose}
          onConfirm={confirm}
        />
      )}
    </Suspense>
  );
}
