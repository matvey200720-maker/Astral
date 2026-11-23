import { useCallback, useMemo, useRef, useState } from "react";
import { TEXTURE_LEVELS } from "@modovik/optimizer/texture-levels.js";
import { OPTIMIZATION_RECORD_KEYS } from "@modovik/optimizer/layer-ids.js";
import { useWorkshopInstalls } from "../../../../features/workshop/install-queue/index.js";
import { useInstallRecords } from "../../../../features/workshop/useInstallRecord.js";
import {
  GRAY_FRAME_INSTALL_KEY,
  grayFrameFailure,
  grayFrameJob,
  grayFrameTarget,
  installedGrayFrame,
  setGrayFrameInstall,
} from "../../../../features/workshop/install-queue/tasks/gray-frame.js";
import { optimizationShotUrl } from "../../../../features/workshop/OptimizationShots.jsx";
import { failureWords } from "../../../../utils/installFailure.js";
import { useTr, useUiLanguage } from "../../../../locales/ui.js";
import Switch from "../../../ui/Switch.jsx";
import { textureCopyFor } from "./texture-copy.js";
import { useGrayPreview } from "./gray-preview.js";
import {
  installedGrayWorld,
  installedTextureStep,
  installedWorldDetail,
  setGrayWorld,
  textureFailure,
  textureJob,
  textureTargetGray,
  textureTargetStep,
  textureTargetStyle,
} from "./texture-sync.js";
import { lookMegabytes, styleCard } from "./world-style-copy.js";
import LeftOutNote from "./LeftOutNote.jsx";
import { FilmCard } from "./OptimizerFilm.jsx";
import { OPTIMIZER_SCENES, SceneTile } from "./OptimizerScenes.jsx";
import OptimizerSlots from "./OptimizerSlots.jsx";
import OptimizerStage from "./OptimizerStage.jsx";
import {
  Facts,
  InstallProgress,
  InstallSteps,
  StatusLine,
} from "./OptimizerParts.jsx";
import WorldDetail, { useWorldDetail } from "./WorldDetail.jsx";

/*
 * Вкладка «ЧБ-мир» раздела оптимизации (ТЗ 17.10.2026, задача 10).
 *
 * Выключатель «Включить ЧБ-мир» ставит текстуры мира серыми — сразу,
 * работой очереди, как карточки: тот же пакет `astral_textures`, что у
 * «Ухудшения текстур», с ЧБ поверх выбранной там ступени (без ступени —
 * `GRAY_WORLD_CAP`). Кадр слева — настоящие кадры из игры; выключатель и
 * выбор кадра меняют их сразу: серым кадр красит приложение тем же
 * правилом, что хост — текстуры (`gray-preview.js`), и подпись говорит об
 * этом прямо: кадра ЧБ-мира из самой игры нет, а люди, небо и свет
 * в игре останутся цветными.
 *
 * Ниже выключателя ЧБ-мира — второй, «Весь кадр серым» (задача 35 (в), 19.10.2026): насыщенность самой игры в ноль
 * через таймцикл (`tasks/gray-frame.js`), поэтому серыми становятся и люди, машины, небо и вода. По умолчанию
 * выключен; подпись честно говорит, что в игре это не проверено.
 *
 * Вид — дизайн 15.11.2026, вариант A «Сцена и плёнка»: сцена с подписью на своей полосе, справа два выключателя карточками и этапы
 * установки, под ними плёнка — четыре кадра предпросмотра (серыми, когда ЧБ-мир или серый кадр включены) и две карточки чёткости мира.
 *
 * Тексты — через `tr()`, словарь `locales/ui-text/zone-optim1710.js` и `zone-s1-gear1910.js`.
 */

const SCENES = OPTIMIZER_SCENES;

/*
 * Вес ЧБ-мира (замер 17.10.2026 на игре владельца, 128 px): первый пакет —
 * 19 145 серых словарей и 19 289 моделей со своими текстурами, 3,71 ГБ;
 * второй (`astral_textures_b`) — остальные 8 999 моделей, 1,23 ГБ. Всего
 * 4,94 ГБ; у других ступеней — того же порядка (вес моделей — геометрия). На
 * 256 px — около 9 ГБ в трёх пакетах (`world-style-copy.js`, `lookMegabytes`).
 */

/* Запись установки неба — подписка: «Как было» в редакторе неба или снятие из библиотеки видно сразу. */
const GRAY_FRAME_RECORD_KEYS = Object.freeze([GRAY_FRAME_INSTALL_KEY]);

const fill = (template, ...values) =>
  template.replace(/\{(\d+)\}/g, (_, slot) => values[Number(slot)] ?? "");

function sizeText(tr, megabytes, locale) {
  const size = (megabytes / 1000).toFixed(1);
  return fill(
    tr("около {0} ГБ"),
    ["ru", "uk", "de", "pl", "fr"].includes(locale)
      ? size.replace(".", ",")
      : size,
  );
}

export default function GrayWorld({
  locale = "ru",
  supported,
  editor,
  gameRunning = "",
  onNotice,
  slots = null,
}) {
  const tr = useTr();
  const language = useUiLanguage();
  const textureCopy = textureCopyFor(locale);
  const queue = useWorkshopInstalls();
  const { detail, clear: clearDetail } = useWorldDetail(queue);
  /* Запись пакета текстур — подписка: снятие из «Библиотеки» видно сразу. */
  const records = useInstallRecords(OPTIMIZATION_RECORD_KEYS);
  const look = useMemo(
    () => ({
      gray: textureTargetGray(queue),
      style: textureTargetStyle(queue),
      step: textureTargetStep(queue),
      installedGray: installedGrayWorld(),
      installedDetail: installedWorldDetail(),
      installedStep: installedTextureStep(),
    }),
    // `records` — сигнал: запись пакета читается из хранилища внутри.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queue, records],
  );
  const frameRecords = useInstallRecords(GRAY_FRAME_RECORD_KEYS);
  const frame = useMemo(
    () => ({
      on: grayFrameTarget(queue),
      installed: installedGrayFrame(),
      job: grayFrameJob(queue),
      failure: grayFrameFailure(queue),
    }),
    // `frameRecords` — сигнал: запись установки неба читается из хранилища внутри.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queue, frameRecords],
  );
  const job = textureJob(queue);
  const failure = textureFailure(queue);
  const [scene, setScene] = useState(SCENES[0].id);
  const [holding, setHolding] = useState(false);
  const canvasRef = useRef(null);
  const current = SCENES.find((item) => item.id === scene) || SCENES[0];
  const url = optimizationShotUrl(current.shot);
  /* Серый кадр целиком — тоже серый предпросмотр: так выглядела бы игра, если он сработает (в игре не проверено). */
  const shotGray = look.gray || frame.on;
  const preview = useGrayPreview(canvasRef, url, shotGray, holding);

  /* Отказ словами очереди; «игра запущена» — словами раздела. */
  const failureText = (message) => {
    const running = failureWords({ kind: "game-running" }, "ru").reason;
    const text = String(message || "");
    return text.startsWith(running) ? gameRunning : text;
  };

  const toggle = useCallback(
    (on) => {
      const outcome = setGrayWorld({
        on,
        snapshot: queue,
        detail,
        title: on ? tr("ЧБ-мир: включение") : tr("ЧБ-мир: снятие"),
        editor,
        copy: textureCopy,
      });
      clearDetail();
      void outcome?.then((result) => {
        if (result.cancelled) return;
        if (!result.ok) {
          onNotice?.(
            fill(tr("ЧБ-мир: {0}"), failureText(result.message)),
            "error",
          );
          return;
        }
        onNotice?.(
          on
            ? tr("ЧБ-мир в игре. Перезапустите игру, чтобы увидеть изменения.")
            : tr("ЧБ-мир снят: текстуры мира снова цветные."),
          "success",
        );
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clearDetail, detail, editor, onNotice, queue, textureCopy, tr],
  );

  const toggleFrame = useCallback(
    (on) => {
      const outcome = setGrayFrameInstall({
        on,
        snapshot: queue,
        title: on ? tr("Серый кадр: включение") : tr("Серый кадр: снятие"),
        editor,
      });
      void outcome?.then((result) => {
        if (result.cancelled) return;
        if (!result.ok) {
          onNotice?.(
            fill(tr("Серый кадр: {0}"), failureText(result.message)),
            "error",
          );
          return;
        }
        onNotice?.(
          on
            ? tr("Серый кадр в игре. Если игра запущена — перезапустите её.")
            : tr("Серый кадр снят: кадр игры снова в цвете."),
          "success",
        );
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, onNotice, queue, tr],
  );

  const frameStatus = frame.job
    ? fill(
        frame.job.status === "queued"
          ? tr("В очереди: {0}")
          : tr("Идёт установка: {0}…"),
        frame.job.saved?.grayFrame ? tr("серый кадр") : tr("кадр в цвете"),
      )
    : frame.installed
      ? tr("В игре: весь кадр серый")
      : tr("В игре: кадр в цвете");

  const level = TEXTURE_LEVELS[look.step];
  const sharpness = look.step
    ? fill(tr("Как в «Ухудшении текстур»: {0}"), textureCopy.levels[look.step])
    : fill(
        tr(
          "До {0} px: вся карта в полном размере — около 20 ГБ текстур, а пакет дополнения держит до 3,6 ГБ",
        ),
        detail,
      );
  const status = !supported
    ? tr("Ставится только в Astral Desktop")
    : job
      ? fill(
          job.status === "queued"
            ? tr("В очереди: {0}")
            : tr("Идёт установка: {0}…"),
          job.saved?.gray ? tr("ЧБ-мир") : tr("цветной мир"),
        )
      : look.installedGray
        ? fill(
            tr("В игре: ЧБ-мир, чёткость {0}"),
            look.installedStep
              ? textureCopy.levels[look.installedStep]
              : `${look.installedDetail} px`,
          )
        : tr("В игре: цветной мир");
  const megabytes = Math.max(
    lookMegabytes(null, true, detail),
    level?.megabytes || 0,
  );
  const label = tr(current.label);
  /* «Кадр из игры — улица днём»: название кадра с маленькой буквы, кроме немецкого — у существительных там заглавные. */
  const sceneTitle = (text) =>
    language === "de" ? text : text.charAt(0).toLowerCase() + text.slice(1);

  const stage = (
    <OptimizerStage
      kind="gray"
      data={{ "data-gray": shotGray ? "true" : undefined }}
      hold={{ start: () => setHolding(true), stop: () => setHolding(false) }}
      position={current.position}
      frame={
        preview.supported ? (
          <canvas
            ref={canvasRef}
            width={1280}
            height={720}
            role="img"
            aria-label={fill(
              shotGray && !holding
                ? tr("Кадр из игры, серый: {0}")
                : tr("Кадр из игры: {0}"),
              label,
            )}
          />
        ) : (
          url && (
            <img
              src={url}
              alt={fill(tr("Кадр из игры: {0}"), label)}
              draggable={false}
            />
          )
        )
      }
      pill={
        holding || !shotGray
          ? tr("Как в игре")
          : frame.on && !look.gray
            ? tr("Серый кадр")
            : tr("ЧБ-мир")
      }
      title={`${tr("Кадр из игры")} — ${sceneTitle(label)}`}
      soft={shotGray && !holding ? tr("приблизительно") : ""}
      hint={tr("Зажмите кадр — оригинал")}
      desc={
        frame.on
          ? tr(
              "Настоящие кадры из игры. Серыми их делает приложение: так выглядела бы игра с серым кадром целиком — люди, небо и свет тоже серые. В самой игре проверено 19.10: серыми стали персонаж, окружение и оружие.",
            )
          : tr(
              "Настоящие кадры из игры. Серыми их делает приложение — тем же правилом, что и текстуры, но целиком: в игре люди, небо и свет останутся цветными. Кадра ЧБ-мира из самой игры пока нет.",
            )
      }
    />
  );

  const panel = (
    <div className="texture-downgrade-panel opf-pane">
      {/* 19.10.2026, владелец: панель «перегружена» — на виду выключатели, чёткость, вес и статус; что серым,
          что цветным и как ставится — в «Как это устроено». */}
      <h3>{tr("ЧБ-мир")}</h3>
      <p className="opf-lead">
        {tr(
          "Текстуры мира становятся серыми: здания, дороги, растения, машины и оружие.",
        )}
      </p>
      {/* Подпись — частью выключателя: щелчок по словам тоже переключает. */}
      <label className="opf-switch" data-on={look.gray ? "true" : "false"}>
        <span className="opf-switch-text">
          <b aria-hidden="true">{tr("Включить ЧБ-мир")}</b>
          <span className="opf-switch-sub">
            <StatusLine
              tone={
                !supported
                  ? "off"
                  : job
                    ? "busy"
                    : look.installedGray
                      ? "on"
                      : "off"
              }
              failed={Boolean(failure)}
            >
              {failure ? fill(tr("ЧБ-мир: {0}"), failureText(failure)) : status}
            </StatusLine>
          </span>
        </span>
        <Switch
          checked={look.gray}
          onChange={toggle}
          label={tr("Включить ЧБ-мир")}
          disabled={!supported}
        />
      </label>
      {/* Весь кадр — через таймцикл, не через текстуры (задача 35 (в)): по умолчанию выключен. */}
      <label
        className="opf-switch gray-frame-switch"
        data-on={frame.on ? "true" : "false"}
      >
        <span className="opf-switch-text">
          <b aria-hidden="true">
            {tr("Весь кадр серым — люди, машины, небо, вода")}
          </b>
          <span className="opf-switch-sub">
            <span className="gray-frame-note">
              {tr(
                "Проверено в игре: серыми становятся персонаж, окружение и оружие.",
              )}
            </span>
            <StatusLine
              tone={frame.job ? "busy" : frame.installed ? "on" : "off"}
              failed={Boolean(frame.failure)}
            >
              {frame.failure
                ? fill(tr("Серый кадр: {0}"), failureText(frame.failure))
                : frameStatus}
            </StatusLine>
          </span>
        </span>
        <Switch
          checked={frame.on}
          onChange={toggleFrame}
          label={tr("Весь кадр серым — люди, машины, небо, вода")}
          disabled={!supported}
        />
      </label>
      <Facts
        rows={[
          [tr("Чёткость"), sharpness],
          [
            tr("Весят пакеты"),
            look.gray
              ? sizeText(tr, megabytes, locale)
              : tr("ничего не ставится"),
            true,
          ],
        ]}
      />
      {/* Стиль мира — тот же пакет (ТЗ 17.10.2026): ЧБ красит стилизованные текстуры. */}
      {look.style && (
        <p className="texture-downgrade-legacy">
          {fill(
            tr(
              "Стоит прежний стиль текстурами «{0}»: ЧБ-мир красит его в серый. Снять его — в инструменте «Стиль мира».",
            ),
            tr(styleCard(look.style).name),
          )}
        </p>
      )}
      <LeftOutNote />
      {job ? (
        <InstallProgress job={job} lockLabel={tr("прервать нельзя")} />
      ) : (
        <InstallSteps
          steps={[
            textureCopy.stepPrepare,
            textureCopy.stepCompose,
            textureCopy.stepCommit,
          ]}
          lockLabel={tr("прервать нельзя")}
        />
      )}
    </div>
  );

  const notes = (
    <ul>
      <li>
        <b>{tr("Станет серым")}</b>
        {" — "}
        <span>
          {tr(
            "Здания, дороги и тротуары, земля, трава и деревья, предметы, интерьеры, машины, оружие и дальние планы (LOD) — из файлов вашей игры. Штатное оружие — пока в игре нет ваших скинов и стволов из мастерской: они остаются своими.",
          )}
        </span>
      </li>
      {/* «Весь кадр серым» берёт картинку игры целиком: цвет людей, неба и воды он тоже снимает. */}
      <li>
        <b>{frame.on ? tr("Тоже станет серым") : tr("Останется цветным")}</b>
        {" — "}
        <span>
          {frame.on
            ? tr(
                "Люди и одежда, небо, вода, огни, кровь и эффекты: их цвет задают не текстуры мира, но «Весь кадр серым» включён — серыми станут и они. Интерфейс игры, скорее всего, останется цветным (в игре не проверено).",
              )
            : tr(
                "Люди и одежда, небо, вода, огни, кровь и эффекты: их цвет задают не текстуры мира.",
              )}
        </span>
      </li>
      <li>
        <b>{tr("Весь кадр серым — люди, машины, небо, вода")}</b>
        {" — "}
        <span>
          {tr(
            "Проверено в игре (19.10): серыми становятся и персонаж, и окружение, и оружие. Меняется насыщенность самой картинки игры (таймцикл): ноль во все часы и погоды, поэтому серыми станут и люди, и машины, и небо с водой. Интерфейс игры (меню, значки), скорее всего, останется цветным. Ставится так же, как «Таймциклы» (небо из них остаётся), снимается переключателем или «Как было» в «Таймциклах»; сервер, который сам задаёт цветокоррекцию, может это перебить.",
          )}
        </span>
      </li>
      <li>
        <b>{tr("Кадры и видеопамять")}</b>
        {" — "}
        <span>
          {fill(
            tr(
              "Формат текстур тот же, размер — как у ступени «Ухудшения» (без неё — {0} px). Сам серый цвет игру не нагружает; тяжелее делает только чёткость: 256 px занимает в видеопамяти вчетверо больше, чем 128 px.",
            ),
            detail,
          )}
        </span>
      </li>
      <li>
        {tr(
          "Серыми становятся текстуры из файлов вашей игры: та же перепись карты, что у «Ухудшения текстур», — около двадцати тысяч словарей и модели со своими текстурами, вблизи и вдали (LOD, SLOD).",
        )}
      </li>
      <li>
        {tr(
          "Цвет снимается без пересжатия: у сжатых текстур серыми становятся опорные цвета блоков, поэтому формат, размер и ступени mip те же, что были.",
        )}
      </li>
      <li>
        {tr(
          "Нормали и блеск — данные освещения, а не цвет: они остаются как были, иначе свет на стенах и земле испортился бы. Палитры оттенков заборов и контейнеров тоже становятся серыми.",
        )}
      </li>
      <li>
        {tr(
          "ЧБ-мир и «Ухудшение текстур» — одна установка пакетов astral_textures: пока ЧБ-мир включён, ступень из «Ухудшения текстур» ставится серой.",
        )}
      </li>
      <li>
        {tr(
          "Пакет дополнения держит до 3,6 ГБ, поэтому ЧБ-мир ставится двумя пакетами: в astral_textures — все словари карты и крупные модели, в astral_textures_b — остальные модели со своими текстурами. Серыми встают все.",
        )}
      </li>
      <li>
        {tr(
          "Первый раз Astral читает всю карту (около 33 ГБ) — около трёх минут; дальше серые словари берутся из памяти.",
        )}
      </li>
      <li>
        {tr(
          "Работает на Majestic, GTA 5 RP и «Россия Онлайн»: проекты читают пакеты дополнений GTA V Legacy, папка mods не нужна.",
        )}
      </li>
    </ul>
  );

  const strip = (
    <FilmCard
      title={tr("Кадр предпросмотра")}
      hint={tr("четыре настоящих кадра игры")}
      notes={{ title: textureCopy.notesTitle, count: 10, content: notes }}
    >
      <div className="opf-gray-strip">
        <div
          className="opf-scenes"
          role="group"
          aria-label={tr("Кадр предпросмотра")}
        >
          {SCENES.map((item) => (
            <button
              key={item.id}
              type="button"
              className="opf-scene-tile"
              aria-pressed={item.id === scene}
              style={{ "--opf-pos": item.position }}
              onClick={() => setScene(item.id)}
            >
              <span className="opf-scene-pic">
                <SceneTile
                  url={optimizationShotUrl(item.shot)}
                  gray={shotGray}
                />
              </span>
              <span className="opf-scene-name">{tr(item.label)}</span>
            </button>
          ))}
        </div>
        <div>
          <p className="opf-detail-title">
            {tr("Чёткость мира")}
            <span>{tr("128 или 256 px")}</span>
          </p>
          <WorldDetail
            locale={locale}
            supported={supported}
            editor={editor}
            gameRunning={gameRunning}
            onNotice={onNotice}
            megabytes={(value) => lookMegabytes(look.style, true, value)}
          />
        </div>
      </div>
    </FilmCard>
  );

  return (
    <OptimizerSlots
      className="gray-world"
      label={tr("ЧБ-мир")}
      slots={slots}
      stage={stage}
      panel={panel}
      strip={strip}
    />
  );
}
