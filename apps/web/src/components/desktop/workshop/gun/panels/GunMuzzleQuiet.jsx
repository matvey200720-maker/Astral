/*
 * «Без вспышки и дыма» в инструменте «Оружие» (задача 6 ТЗ 17.10.2026, из
 * задачи 2). Две галки: этот ствол и все стволы разом. Ставится своей
 * кнопкой: это не скин модели, а файл оружия игры — его ведёт установщик
 * эффектов, тот же, что ставит трассеры и вспышки (`useMuzzleQuiet.js`).
 */
import { GameController } from "../../../../ui/icons.jsx";
import Button from "../../../../ui/Button.jsx";
import Switch from "../../../../ui/Switch.jsx";
import { tr, useTr } from "../../../../../locales/ui.js";

const inGameText = (state) =>
  state.all
    ? tr("В игре: у всех стволов без вспышки и дыма")
    : state.one
      ? tr("В игре: у этого ствола без вспышки и дыма")
      : tr("В игре: вспышка и дым штатные");

export default function GunMuzzleQuiet({ quiet }) {
  useTr();
  if (!quiet) return null;
  return (
    <section className="gun-model-panel gun-muzzle-quiet" aria-label={tr("Вспышка и дым у дула")}>
      <div className="gun-section-head">
        <h3>{tr("Вспышка и дым у дула")}</h3>
      </div>
      <label className="gun-section-head">
        <span className="gun-hint">{tr("Без вспышки и дыма")}</span>
        <Switch
          label={tr("Без вспышки и дыма")}
          checked={quiet.one || quiet.all}
          disabled={quiet.all}
          onChange={quiet.onOne}
        />
      </label>
      <label className="gun-section-head">
        <span className="gun-hint">{tr("Все стволы")}</span>
        <Switch label={tr("Все стволы")} checked={quiet.all} onChange={quiet.onAll} />
      </label>
      {/* Одна подсказка: в две строки, щелчок раскрывает целиком. */}
      <p className="gun-hint fx-hint">
        {tr("Выстрел без вспышки у дула, её света и дыма из ствола — и от первого лица. Пули, трассеры и звук остаются. Правится файл оружия вашей игры тем же установщиком, что трейсеры: вместе они не спорят.")}{" "}
        {tr("Частицы от попаданий пуль в стены и машины выключает «Оптимизация» → «Эффекты».")}
      </p>
      <p className="gun-hint" role="status">
        {quiet.unknown ? tr("Что сейчас в игре, неизвестно: набор эффектов ставила прежняя версия") : inGameText(quiet.inGame)}
      </p>
      <div className="gun-row">
        <Button
          variant="secondary"
          size="sm"
          icon={<GameController />}
          disabled={!quiet.changed || Boolean(quiet.busy)}
          onClick={quiet.onApply}
        >
          {quiet.busy || tr("Поставить в игру")}
        </Button>
      </div>
    </section>
  );
}
