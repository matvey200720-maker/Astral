import { useState } from "react";
import { PencilSimpleLine, Trash } from "../../components/ui/icons.jsx";
import Button from "../../components/ui/Button.jsx";
import DetailTopbar from "../../components/ui/DetailTopbar.jsx";
import { renderSlotCover } from "../workshop/covers/slot-cover.jsx";
import { LibraryRemovalDialog } from "./LibraryRemoval.jsx";
import { rpWordsKey, useRpWords } from "./useRpWords.js";
import {
  marksFromUnits,
  readWorkshopInstallUnits,
} from "../../workshop-library.js";

/*
 * Карточка работы, которая стоит в игре.
 *
 * Библиотека раньше открывала плитку сразу в редакторе: человек нажимал на
 * «Мини-карту» и оказывался среди ползунков, не увидев ни самой работы, ни
 * того, когда она встала, ни как её снять. Карточка отвечает на эти вопросы
 * и держит оба действия рядом — «Редактировать» и «Удалить из игры».
 *
 * Обложка та же, что на полке (`renderSlotCover`): это сама работа, а не
 * снимок «как в игре».
 */

const DATE_LOCALES = { ru: "ru-RU", en: "en-US", de: "de-DE", pl: "pl-PL", fr: "fr-FR" };

function formatDate(value, locale) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "";
  return new Date(time).toLocaleDateString(DATE_LOCALES[locale] || "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function LibraryWorkCard({
  slotId,
  title,
  sectionTitle,
  unit,
  copy,
  locale = "ru",
  targetId = "",
  installUnits = [],
  /* Удаление той же меркой, что у полки (`useLibraryShelfRemoval`):
     «Удалить из игры» на «Трейсерах» снимает трейсеры, а не весь набор
     эффектов вместе с попаданиями. */
  removalFor = null,
  onBack,
  onEdit,
  onNotice,
  onRemoved,
}) {
  const [removal, setRemoval] = useState(null);
  /* «Удалить» нажато, удаление идёт: вторую такую же кнопка не заводит. */
  const [removing, setRemoving] = useState(false);
  const installedAt = formatDate(unit?.installedAt, locale);
  /* Слова про GTA 5 RP — из записи установки, пока мод стоит (`useRpWords.js`); режим выключен — пусто. */
  const rpWords = useRpWords(unit ? [unit] : [], locale)[rpWordsKey(unit)] || "";
  /* Имя работы на этой карточке: у звуков оружия их бывает несколько («Карабинная
     винтовка, Пистолет»), у попаданий у каждой части своё. */
  const name =
    marksFromUnits(
      installUnits.filter((item) => item.slots?.includes(slotId)),
    ).get(slotId)?.name ||
    unit?.name ||
    title;

  const startRemoval = () => {
    if (!unit || removing) return;
    const lone = {
      entries: [{ id: slotId, title: name, units: [unit] }],
      units: [unit],
      splits: [],
      selected: [slotId],
      extras: [],
    };
    const request = removalFor?.requestFor([slotId]);
    /* Плитки нет на полке раздела — снимается её установка как есть. */
    setRemoval(
      request && (request.units.length || request.splits.length)
        ? request
        : lone,
    );
  };
  return (
    <div className="library-work-card">
      <DetailTopbar onBack={onBack} backLabel={copy.back} />
      {/* Редизайн 17.10.2026: та же раскладка, что у страницы мода — работа
          крупно слева, панель решения справа: что это, когда встало, куда,
          и два действия стопкой. */}
      <article className="library-work-layout">
        <figure className="library-work-stage">
          <span className="library-work-cover">
            {renderSlotCover(slotId, installUnits)}
          </span>
        </figure>
        <div className="library-work-body">
          <header>
            <span>{copy.kicker}</span>
            <h1>{name}</h1>
            <p>
              {installedAt
                ? copy.installedAt.replace("{date}", installedAt)
                : copy.installedUnknown}
            </p>
            {rpWords ? <p className="library-work-hint" data-rp-words>{rpWords}</p> : null}
          </header>
          <div className="library-work-actions">
            <Button
              variant="primary"
              size="lg"
              icon={<PencilSimpleLine />}
              onClick={onEdit}
            >
              {copy.edit}
            </Button>
            <Button
              variant="secondary"
              icon={<Trash />}
              disabled={!unit || removing}
              onClick={startRemoval}
            >
              {removing ? copy.removal.removing : copy.remove}
            </Button>
          </div>
          <p className="library-work-hint">{copy.editHint}</p>
          <dl>
            <div>
              <dt>{copy.section}</dt>
              <dd>{sectionTitle}</dd>
            </div>
            <div>
              <dt>{copy.where}</dt>
              <dd>{unit?.where || copy.whereValue}</dd>
            </div>
          </dl>
        </div>
      </article>
      {removal && (
        <LibraryRemovalDialog
          copy={copy.removal}
          locale={locale}
          targetId={targetId}
          entries={removal.entries}
          units={removal.units}
          splits={removal.splits}
          knownUnits={installUnits}
          onClose={() => {
            setRemoval(null);
            setRemoving(false);
          }}
          onStarted={() => setRemoving(true)}
          onInclude={
            removalFor
              ? (included) =>
                  setRemoval(
                    (current) =>
                      current && removalFor.withUnit(current, included),
                  )
              : undefined
          }
          onIncludeWhole={
            removalFor
              ? (split) =>
                  setRemoval(
                    (current) => current && removalFor.withWhole(current, split),
                  )
              : undefined
          }
          onFinished={({ removedCount }) => {
            setRemoving(false);
            /* Работа ушла из игры — карточке показывать больше нечего:
               полка перечитывает установки, и человек возвращается к ней.
               Не ушла — окно остаётся и говорит почему. */
            if (!removedCount) return;
            setRemoval(null);
            onNotice?.(
              copy.removal.done.replace("{count}", String(removedCount)),
            );
            onRemoved?.(readWorkshopInstallUnits());
          }}
        />
      )}
    </div>
  );
}
