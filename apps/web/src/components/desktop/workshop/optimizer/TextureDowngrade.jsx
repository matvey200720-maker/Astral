import { useCallback, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise, DownloadSimple } from "../../../ui/icons.jsx";
import {
  TEXTURE_LEVELS,
  TEXTURE_MAX_STEP,
} from "@modovik/optimizer/texture-levels.js";
import { OPTIMIZATION_RECORD_KEYS } from "@modovik/optimizer/layer-ids.js";
import { useWorkshopInstalls } from "../../../../features/workshop/install-queue/index.js";
import { useInstallRecords } from "../../../../features/workshop/useInstallRecord.js";
import { optimizationShotUrl } from "../../../../features/workshop/OptimizationShots.jsx";
import { failureWords } from "../../../../utils/installFailure.js";
import { useTr } from "../../../../locales/ui.js";
import Button from "../../../ui/Button.jsx";
import LeftOutNote from "./LeftOutNote.jsx";
import { FilmCard, FilmLabels, FilmRail, FilmTiles } from "./OptimizerFilm.jsx";
import OptimizerSlots from "./OptimizerSlots.jsx";
import OptimizerStage from "./OptimizerStage.jsx";
import {
  InstallProgress,
  InstallSteps,
  SelectedText,
  StatusLine,
} from "./OptimizerParts.jsx";
import { fillCopy } from "./optimizer-copy.js";
import { textureCopyFor } from "./texture-copy.js";
import {
  FILM_CROP,
  useTextureFilmTiles,
  useTexturePreview,
} from "./texture-preview.js";
import {
  installedTextureStep,
  setTextureStep,
  textureFailure,
  textureJob,
  textureStepIsDated,
  textureStepIsLegacy,
  textureTargetGray,
  textureTargetStep,
} from "./texture-sync.js";

/*
 * Вкладка «Ухудшение текстур» раздела оптимизации (задача 9, 05.10.2026;
 * «Установить» и вся карта — задача 1 ТЗ 05.10.2026, вечер; вид — дизайн
 * 15.11.2026, вариант A «Сцена и плёнка»).
 *
 * Не тумблер, а ползунок: шесть ступеней от «Как в игре» до «Как в моде».
 * Кадр слева — настоящий кадр из игры (часть его в натуральную величину),
 * который мылится вслед за ползунком сразу, пока его тянут
 * (`texture-preview.js`); подпись говорит, что ухудшение рисует скрипт.
 * Ползунок — плёнка под сценой: по кадру на ступень, ручка на рельсе; нажатие
 * на кадр или тяга ручки только выбирают. В игру ступень уходит кнопкой
 * «Установить» — работой очереди (`texture-sync.js`), а пока её не нажали, в
 * игре ничего не меняется (владелец: «сначала крутит ползунок, и только потом
 * нажимает «Установить»»). Кадры плёнки — те же, что рисует сцена, по одному в
 * простое окна (`useTextureFilmTiles`).
 *
 * Рядом — кнопка «Стандарт»: выбрать текстуры как в игре.
 */

const SHOT = "streets-before";

/* Вес пакета коротко, как в макете: «≈ 3,6 ГБ»; до гигабайта — в мегабайтах. */
function sizeShort(tr, megabytes, locale) {
  const comma = ["ru", "uk", "de", "pl", "fr"].includes(locale);
  const text = (value) => (comma ? value.replace(".", ",") : value);
  if (megabytes < 1000) return tr("≈ {0} МБ").replace("{0}", String(megabytes));
  return tr("≈ {0} ГБ").replace("{0}", text((megabytes / 1000).toFixed(1)));
}

/* Отказ словами очереди; «игра запущена» — словами раздела: выбрать снова. */
function failureText(message, gameRunning) {
  const running = failureWords({ kind: "game-running" }, "ru").reason;
  const text = String(message || "");
  return text.startsWith(running) ? gameRunning : text;
}

export default function TextureDowngrade({
  locale = "ru",
  supported,
  editor,
  gameRunning = "",
  onNotice,
  slots = null,
}) {
  const tr = useTr();
  const copy = textureCopyFor(locale);
  const queue = useWorkshopInstalls();
  /* Записи набора — подписка: снятие из «Библиотеки» видно сразу. */
  const records = useInstallRecords(OPTIMIZATION_RECORD_KEYS);
  const target = useMemo(
    () => textureTargetStep(queue),
    // `records` — сигнал: запись набора читается из хранилища внутри.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queue, records],
  );
  const installed = useMemo(
    () => installedTextureStep(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queue, records],
  );
  const job = textureJob(queue);
  const failure = textureFailure(queue);
  /* Прежняя ступень — слоем набора, на словари мода: «Установить» перенесёт её. */
  const legacy = useMemo(
    () => textureStepIsLegacy(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queue, records],
  );
  /* Ступень стоит пакетом без моделей карты (до 06.10.2026): «Установить» добавит их. */
  const dated = useMemo(
    () => textureStepIsDated(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queue, records],
  );
  /* Ступень под рукой, пока её выбирают; `null` — показываем цель очереди. */
  const [draft, setDraft] = useState(null);
  const shown = draft ?? target;
  const [holding, setHolding] = useState(false);
  const canvasRef = useRef(null);
  const url = optimizationShotUrl(SHOT);
  const preview = useTexturePreview(canvasRef, url, shown, holding);
  /* Кадры плёнки — по одному в простое окна, после первого рисунка сцены. */
  const tiles = useRef([]);
  useTextureFilmTiles(
    preview.ready,
    preview.frameFor,
    tiles,
    copy.levels.length,
  );

  const install = useCallback(
    (step) => {
      const level = copy.levels[step];
      const outcome = setTextureStep({
        step,
        snapshot: queue,
        title: `${copy.title}: ${level}`,
        editor,
        copy,
      });
      setDraft(null);
      void outcome?.then((result) => {
        if (result.cancelled) return;
        if (!result.ok) {
          onNotice?.(
            fillCopy(copy.failed, {
              reason: failureText(result.message, gameRunning),
            }),
            "error",
          );
          return;
        }
        onNotice?.(
          step ? fillCopy(copy.doneOn, { level }) : copy.doneOff,
          "success",
        );
      });
    },
    [copy, editor, gameRunning, onNotice, queue],
  );

  /* Ползунок, поле числом и ступени только выбирают — в игре ничего не
     меняется, пока не нажата «Установить». */
  const choose = useCallback((value) => {
    const step = Math.max(
      0,
      Math.min(TEXTURE_MAX_STEP, Math.round(Number(value) || 0)),
    );
    setDraft(step);
  }, []);

  /* Ставить есть что: выбрана не та ступень, к которой придёт очередь, или
     стоит прежняя ступень на словари мода — её «Установить» переносит, —
     или ступень без моделей карты — «Установить» ставит её с ними. */
  const pending =
    shown !== target ||
    ((legacy || dated) && shown === installed && shown > 0 && !job);
  const status = !supported
    ? copy.desktopOnly
    : job
      ? fillCopy(job.status === "queued" ? copy.queued : copy.installing, {
          level: copy.levels[job.saved?.step ?? shown],
        })
      : shown !== target
        ? fillCopy(copy.selected, {
            level: copy.levels[shown],
            installed: copy.levels[installed],
          })
        : fillCopy(copy.inGame, { level: copy.levels[installed] });
  const statusTone = !supported
    ? "off"
    : job
      ? "busy"
      : shown !== target
        ? "info"
        : "on";
  const sizeOf = (index) =>
    TEXTURE_LEVELS[index].megabytes
      ? sizeShort(tr, TEXTURE_LEVELS[index].megabytes, locale)
      : copy.sizeNone;

  const stage = (
    <OptimizerStage
      kind="textures"
      data={{ "data-step": shown }}
      hold={{ start: () => setHolding(true), stop: () => setHolding(false) }}
      frame={
        preview.supported ? (
          <canvas
            ref={canvasRef}
            width={1280}
            height={720}
            role="img"
            aria-label={
              holding
                ? copy.original
                : fillCopy(copy.picture, { level: copy.levels[shown] })
            }
          />
        ) : (
          url && (
            <img
              src={url}
              alt={fillCopy(copy.picture, { level: copy.levels[shown] })}
              draggable={false}
            />
          )
        )
      }
      pill={holding ? copy.original : copy.levels[shown]}
      title={tr("Кадр из игры — улица в Строберри")}
      hint={tr("Зажмите кадр — оригинал")}
      desc={tr(
        "Показана часть кадра в натуральную величину. Ухудшение рисует скрипт по ступени: так мылятся текстуры, а края предметов в игре остаются чёткими.",
      )}
    />
  );

  const panel = (
    <div className="texture-downgrade-panel opf-pane">
      <h3>{copy.title}</h3>
      <p className="opf-lead">{copy.lead}</p>
      <div className="opf-sel">
        <div className="opf-sel-head">
          <span className="opf-sel-big">{copy.levels[shown]}</span>
          <span className="opf-sel-side">
            {tr("Весит пакет: {0}").replace("{0}", sizeOf(shown))}
          </span>
        </div>
        <p className="opf-sel-text">{copy.details[shown]}</p>
      </div>
      <StatusLine tone={statusTone} failed={Boolean(failure)}>
        {failure ? (
          fillCopy(copy.failed, { reason: failureText(failure, gameRunning) })
        ) : shown !== target && !job && supported ? (
          <SelectedText text={status} />
        ) : (
          status
        )}
      </StatusLine>
      {legacy && !job && (
        <p className="texture-downgrade-legacy">
          {fillCopy(copy.legacy, { level: copy.levels[installed] })}
        </p>
      )}
      {dated && !legacy && !job && (
        <p className="texture-downgrade-legacy">
          {fillCopy(copy.dated, { level: copy.levels[installed] })}
        </p>
      )}
      <LeftOutNote />
      {/* ЧБ-мир — тот же пакет (ТЗ 17.10.2026): ступень ставится серой. */}
      {textureTargetGray(queue) && (
        <p className="texture-downgrade-legacy">
          {tr(
            "Включён ЧБ-мир: ступень ставится серой. Выключить — в инструменте «ЧБ-мир».",
          )}
        </p>
      )}
      <div className="opf-acts">
        <Button
          icon={<DownloadSimple />}
          variant="primary"
          title={pending ? copy.installHint : copy.installedSame}
          disabled={!supported || !pending}
          onClick={() => install(shown)}
        >
          {copy.install}
        </Button>
        <Button
          icon={<ArrowCounterClockwise />}
          title={copy.standardHint}
          disabled={shown === 0}
          onClick={() => choose(0)}
        >
          {copy.standard}
        </Button>
      </div>
      {job ? (
        <InstallProgress job={job} lockLabel={tr("прервать нельзя")} />
      ) : (
        <>
          <InstallSteps
            steps={[copy.stepPrepare, copy.stepCompose, copy.stepCommit]}
            lockLabel={tr("прервать нельзя")}
          />
          <p className="opf-note">
            {tr(
              "Первый раз — несколько минут: читаем словари и модели всей карты (≈ 36 ГБ).",
            )}
          </p>
        </>
      )}
    </div>
  );

  const items = copy.levels.map((name, index) => ({
    key: index,
    label: name,
    on: index === shown,
    inGame: index === installed,
    disabled: !supported,
    thumb: preview.supported ? (
      <canvas
        ref={(node) => (tiles.current[index] = node)}
        width={FILM_CROP.width}
        height={FILM_CROP.height}
        aria-hidden="true"
      />
    ) : (
      url && (
        <img src={url} alt="" draggable={false} style={{ objectFit: "none" }} />
      )
    ),
  }));
  const strip = (
    <FilmCard
      title={copy.step}
      hint={tr("Нажмите на кадр или тяните ползунок")}
      notes={{
        title: copy.notesTitle,
        count: copy.notes.length,
        content: (
          <ul>
            {copy.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ),
      }}
    >
      <FilmTiles items={items} gap={20} tileHeight={120} onPick={choose} />
      <FilmRail
        count={copy.levels.length}
        gap={20}
        value={shown}
        label={copy.step}
        valueText={copy.levels[shown]}
        disabled={!supported}
        onChange={(fraction) => choose(Math.round(fraction))}
        onNudge={(direction) => choose(shown + direction)}
        onJump={(edge) => choose(edge === "start" ? 0 : TEXTURE_MAX_STEP)}
      />
      <FilmLabels
        gap={20}
        items={copy.levels.map((name, index) => ({
          label: name,
          sub: sizeOf(index),
          on: index === shown,
        }))}
      />
    </FilmCard>
  );

  return (
    <OptimizerSlots
      label={copy.title}
      slots={slots}
      stage={stage}
      panel={panel}
      strip={strip}
    />
  );
}
