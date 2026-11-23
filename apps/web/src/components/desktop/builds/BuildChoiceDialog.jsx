import { Suspense, lazy } from "react";
import { installRequests } from "../../../features/cart/CartClothingChoice.jsx";
import { clothingOf } from "../../../features/clothing/clothing-catalog.js";
import { useDefaultTarget } from "../../../features/clothing/useDefaultTarget.js";
import { tr, useTr } from "../../../locales/ui.js";

/*
 * Окно «На что поставить?» для вещи сборки (16.11.2026, решение ведущей): то же окно «Сделать заменёнку», что у карточки и корзины, но человек не устанавливает вещь сейчас, а выбирает место для
 * неё в этой сборке — кнопка называется «Выбрать». Подтверждённый выбор отдаётся записями установки (`installRequests`, как у корзины); какие из них попадут в сборку, решает `withChoices`
 * (парные вещи другого пола, которых в сборке нет, не записываются).
 *
 * Окно грузится отдельным куском и только когда человек нажал «Выбрать цели»: страница сборок в стартовый кусок его не тянет.
 */

const ClothingInstallDialog = lazy(
  () => import("../catalog/ClothingInstallDialog.jsx"),
);

/**
 * `mod` — вещь сборки, `catalog` — весь каталог (окно ищет в нём штатные вещи и соседей), `onDone(записи)` — выбор подтверждён,
 * `onClose` — окно закрыто без выбора.
 */
export default function BuildChoiceDialog({
  mod,
  catalog = [],
  onDone,
  onClose,
}) {
  useTr();
  const block = clothingOf(mod);
  /* Цель по умолчанию — предложение, а не тихий выбор: подтверждает человек, нажав «Выбрать» (как у карточки). */
  const preset = useDefaultTarget(block ? mod : null, catalog, "off:");
  if (!block) return null;
  return (
    <Suspense fallback={null}>
      <ClothingInstallDialog
        mod={mod}
        mods={catalog}
        preset={preset.state === "ready" ? (preset.target?.key ?? null) : null}
        confirmLabel={tr("Выбрать")}
        onClose={onClose}
        onConfirm={(selection) =>
          onDone(installRequests("install", mod, catalog, selection))
        }
      />
    </Suspense>
  );
}
