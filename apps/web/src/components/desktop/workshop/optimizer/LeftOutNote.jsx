import { OPTIMIZATION_RECORD_KEYS } from "@modovik/optimizer/layer-ids.js";
import { useInstallRecords } from "../../../../features/workshop/useInstallRecord.js";
import { installedWorldLeftOut } from "../../../../features/workshop/install-queue/tasks/textures.js";
import { useTr } from "../../../../locales/ui.js";

/*
 * Честная строка о том, что не поместилось (повторное ревью ТЗ 17.10.2026,
 * задача 10): пакеты дополнения держат до 3,6 ГБ каждый, и словари или модели
 * карты сверх этого остаются как в игре — без ступени, серого и стиля.
 * Движок называет их числом (`leftOut` ответа установки), запись установки
 * помнит число, строка стоит под выбором чёткости и у «Ухудшения текстур».
 * Влезло всё — строки нет.
 *
 * Числа подставляются в одну фразу без склонения: «словарей — N, моделей — M»
 * читается одинаково на всех языках окна.
 */

const fill = (template, ...values) => template.replace(/\{(\d+)\}/g, (_, slot) => values[Number(slot)] ?? "");

export default function LeftOutNote() {
  const tr = useTr();
  /* Подписка на запись установки: снятие и переустановка видны сразу. */
  useInstallRecords(OPTIMIZATION_RECORD_KEYS);
  const left = installedWorldLeftOut();
  if (!left) return null;
  return (
    <p className="texture-downgrade-legacy" role="status" data-left-out="true">
      {fill(tr("Не поместилось в пакеты и осталось как в игре: словарей — {0}, моделей — {1}."), left.dictionaries, left.models)}
    </p>
  );
}
