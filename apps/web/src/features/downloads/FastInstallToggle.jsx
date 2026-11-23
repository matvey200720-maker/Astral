/*
 * Выключатель «Быстрая установка» в шапке «Загрузок» (13.11.2026, решение владельца). По умолчанию выключен: тормоз записи на
 * диск работает всегда. Включён — тормоз снят, и уже идущая установка ускоряется тоже. Стоит рядом с «Ускоренной
 * загрузкой» тем же органом (`ribbon/DlToggle.jsx`): тот выключатель — про интернет, этот — про диск.
 */
import { Gauge } from "../../components/ui/icons.jsx";
import { trIn, useUiLanguage } from "../../locales/ui.js";
import { setFastInstall, useFastInstall } from "./fast-install.js";
import DlToggle from "./ribbon/DlToggle.jsx";

/* Язык — тот, на котором говорит окно загрузок (оно получает его свойством), иначе язык окна. */
export default function FastInstallToggle({ language }) {
  const windowLanguage = useUiLanguage();
  const tr = (text) => trIn(language || windowLanguage, text);
  const { enabled } = useFastInstall();
  const on = tr(
    "Тормоз с диска снят: моды ставятся быстрее, и уже идущая установка тоже. Диск сильно нагружен, компьютер может работать медленнее.",
  );
  const off = tr(
    "Обычная скорость: диск не забивается, большие моды ставятся дольше. Включите — установка пойдёт быстрее, но диск нагрузится.",
  );
  return (
    <DlToggle
      className="dl-fast"
      icon={Gauge}
      label={tr("Быстрая установка")}
      on={enabled}
      note={enabled ? on : off}
      onToggle={() => setFastInstall(!enabled)}
    />
  );
}
