import { useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise, Check } from "../../../ui/icons.jsx";
import { OPTIMIZATION_RECORD_KEYS } from "@modovik/optimizer/layer-ids.js";
import {
  RESHADE_TARGETS,
  normalizeReshadeProject,
} from "@modovik/optimizer/reshade.js";
import { hasDesktopBridge } from "../../../../api.js";
import { reshadeCopyFor } from "../../../../features/reshade/reshade-copy.js";
import { reshadePresetsCopyFor } from "../../../../features/reshade/reshade-presets-copy.js";
import { useReshade } from "../../../../features/reshade/use-reshade.js";
import { useWorkshopInstalls } from "../../../../features/workshop/install-queue/index.js";
import { useInstallRecords } from "../../../../features/workshop/useInstallRecord.js";
import { optimizationShotUrl } from "../../../../features/workshop/OptimizationShots.jsx";
import { failureWords } from "../../../../utils/installFailure.js";
import { useTr, useUiLanguage } from "../../../../locales/ui.js";
import Button from "../../../ui/Button.jsx";
import { FilmCard } from "./OptimizerFilm.jsx";
import { OPTIMIZER_SCENES } from "./OptimizerScenes.jsx";
import OptimizerSlots from "./OptimizerSlots.jsx";
import OptimizerStage from "./OptimizerStage.jsx";
import { StatusLine } from "./OptimizerParts.jsx";
import { textureCopyFor } from "./texture-copy.js";
import { useStylePreview, useStyleThumbs } from "./style-preview.js";
import {
  STYLE_CARDS,
  reshadeStyleOf,
  styleCard,
  textureStyleOf,
} from "./world-style-copy.js";
import {
  installedWorldStyle,
  setWorldStyle,
  textureFailure,
  textureJob,
  textureTargetGray,
} from "./texture-sync.js";

/*
 * Вкладка «Стиль мира» раздела оптимизации (ТЗ 17.10.2026, задача 10; с 19.10.2026, задача 38 — через ReShade).
 *
 * Весь кадр игры — рисованным, комиксом, мультяшным, акварелью или ретро. Решение владельца 19.10.2026 («Комикс на
 * весь экран» проверен в игре и работает чётко): стиль мира ставится только ReShade, без пакета текстур. Текстуры мира
 * красят и люди, небо, вода и огни — нет; шейдер ReShade берёт готовый кадр целиком (`AstralComic.fx`,
 * `AstralPainted.fx`, `AstralCartoon.fx`, `AstralWatercolor.fx`, `AstralRetro.fx` — `reshade-style-shaders.js`).
 *
 * Карточка только показывает стиль на кадре; в игру его ставит «Применить» (владелец 29.10.2026: «нет кнопки применить,
 * как только человек нажимает на стиль, к примеру чтобы посмотреть, оно сразу грузится в игру»). «Применить» отправляет
 * пресет ReShade (`comic`, `painted`, `cartoon`, `watercolor`, `retro`) в проекты тем же установщиком, что вкладка
 * «ReShade»; «Без стиля» + «Применить» выключает. Пресет в проекте один: стиль заменяет пресет вкладки «ReShade»,
 * DLSS 5 не трогается.
 *
 * Если у человека ещё стоит прежний стиль пакетом текстур (`astral_textures`), в панели горит плашка «Снять стиль
 * текстурами» — тем же путём (`setWorldStyle(null)`), чтобы два стиля не легли друг на друга. ЧБ-мир и «Ухудшение
 * текстур» по-прежнему используют пакет текстур — их вкладки не тронуты.
 *
 * Кадр слева прежний: настоящий кадр игры, прогнанный через правило стиля в окне (`style-preview.js`). Подпись говорит
 * прямо, что это приближение и кадра со стилем из самой игры нет. Вид — дизайн 15.11.2026, вариант A «Сцена и плёнка»:
 * справа слова и «Применить», под сценой — шесть карточек стилей (кадр, имя, пояснение); выбор кадра из четырёх — строкой под ними.
 * Тексты — через `tr()`, словарь `locales/ui-text/zone-t38-style-reshade1910.js`.
 */

/* Кадры из игры (`assets/optimization-shots`): город днём, природа, аэропорт, ночь. По умолчанию — склон Вайнвуда, как в макете. */
const SCENES = OPTIMIZER_SCENES;

const fill = (template, ...values) =>
  template.replace(/\{(\d+)\}/g, (_, slot) => values[Number(slot)] ?? "");

/* Радиогруппа не хранит `null`: «Без стиля» — значение `none`. */
const NONE = "none";

export default function WorldStyle({
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
  const dlssCopy = reshadeCopyFor(language);
  const presetCopy = reshadePresetsCopyFor(language);
  const ctrl = useReshade(onNotice);
  const queue = useWorkshopInstalls();
  /* Запись пакета текстур — подписка: снятие из «Библиотеки» видно сразу. */
  const records = useInstallRecords(OPTIMIZATION_RECORD_KEYS);
  const legacy = useMemo(
    () => ({ style: installedWorldStyle(), gray: textureTargetGray(queue) }),
    // `records` — сигнал: запись пакета читается из хранилища внутри.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queue, records],
  );
  const job = textureJob(queue);
  const failure = textureFailure(queue);

  /* Какой стиль стоит в проектах: пресет, если он из стилей; обычный пресет вкладки «ReShade» стилем не считается. */
  const standing = textureStyleOf(ctrl.presetOn) ? ctrl.presetOn : "";
  const other =
    ctrl.presetOn && !standing
      ? presetCopy.presets[ctrl.presetOn]?.name || ctrl.presetOn
      : "";
  /* Стиль, выбранный посмотреть; `undefined` — показываем то, что стоит. В игру он уходит только «Применить». */
  const [picked, setPicked] = useState(undefined);
  const shown = picked === undefined ? standing : picked;
  const shownTexture = textureStyleOf(shown);
  const pending = shown !== standing;
  const busy = ctrl.busy === "style";
  const canApply =
    supported && hasDesktopBridge() && !ctrl.busy && !ctrl.reshadeMissing;

  const [scene, setScene] = useState(SCENES[1].id);
  const [holding, setHolding] = useState(false);
  const canvasRef = useRef(null);
  const current = SCENES.find((item) => item.id === scene) || SCENES[0];
  const url = optimizationShotUrl(current.shot);
  const preview = useStylePreview(
    canvasRef,
    url,
    shownTexture,
    legacy.gray,
    holding,
  );
  const thumbs = useStyleThumbs(url, legacy.gray);

  /* Отказ словами очереди; «игра запущена» — словами раздела. */
  const failureText = (message) => {
    const running = failureWords({ kind: "game-running" }, "ru").reason;
    const text = String(message || "");
    return text.startsWith(running) ? gameRunning : text;
  };

  /* Карточка только выбирает, что показать на кадре; стоящий стиль — снова «как в игре». */
  function choose(value) {
    const next = value === NONE ? "" : value;
    setPicked(next === standing ? undefined : next);
  }

  /* «Применить»: пресет ReShade в проекты; DLSS 5 остаётся как стоит. Отказ — выбор остаётся, можно повторить. */
  async function apply() {
    if (!pending) return;
    const next = shown;
    const dlss = { ...ctrl.project.dlss, enabled: ctrl.dlssOn };
    const result = await ctrl.run(
      "style",
      normalizeReshadeProject({ ...ctrl.project, preset: next, dlss }),
    );
    if (!result) return;
    setPicked(undefined);
    const names = (result.targets || [])
      .filter((item) => item.action === "installed")
      .map(
        (item) =>
          dlssCopy.targets[item.id]?.label ?? RESHADE_TARGETS[item.id].label,
      )
      .join(", ");
    onNotice?.(
      next
        ? fill(
            tr(
              "Стиль «{0}» включён: {1}. Запустите игру — Insert открывает меню ReShade.",
            ),
            tr(styleCard(textureStyleOf(next)).name),
            names,
          )
        : tr("Стиль выключен — картинка как в игре."),
      "success",
    );
  }

  /* Прежний стиль пакетом текстур уходит тем же путём, что раньше «Без стиля»; ЧБ-мир и ступень остаются. */
  function removeTextureStyle() {
    const outcome = setWorldStyle({
      style: null,
      snapshot: queue,
      title: tr("Стиль мира: снятие"),
      editor,
      copy: textureCopy,
    });
    void outcome?.then((result) => {
      if (result.cancelled) return;
      if (!result.ok) {
        onNotice?.(
          fill(tr("Стиль мира: {0}"), failureText(result.message)),
          "error",
        );
        return;
      }
      onNotice?.(
        tr(
          "Стиль текстурами снят. Перезапустите игру, чтобы увидеть изменения.",
        ),
        "success",
      );
    });
  }

  const card = styleCard(shownTexture);
  const status =
    !supported || !hasDesktopBridge()
      ? tr("Ставится только в Astral Desktop")
      : busy
        ? picked
          ? fill(tr("Включаем стиль «{0}»…"), tr(card.name))
          : tr("Выключаем стиль…")
        : job
          ? tr("Снимаем стиль текстурами…")
          : ctrl.reshadeMissing
            ? tr("ReShade из состава Astral не найден — переустановите Astral.")
            : standing
              ? fill(
                  tr("В игре: стиль «{0}» на весь экран"),
                  tr(styleCard(textureStyleOf(standing)).name),
                )
              : tr("В игре: без стиля на весь экран");
  const statusTone =
    !supported || !hasDesktopBridge()
      ? "off"
      : busy || job
        ? "busy"
        : standing
          ? "on"
          : "off";
  const sceneLabel = tr(current.label);
  /* «Кадр из игры — склон Вайнвуда»: название кадра с маленькой буквы, кроме немецкого — у существительных там заглавные. */
  const sceneTitle =
    language === "de"
      ? sceneLabel
      : sceneLabel.charAt(0).toLowerCase() + sceneLabel.slice(1);
  const badge = preview.busy
    ? tr("Рисую кадр…")
    : holding || (!shown && !legacy.gray)
      ? tr("Как в игре")
      : shown
        ? tr(card.name)
        : tr("ЧБ-мир");

  const stage = (
    <OptimizerStage
      kind="style"
      data={{ "data-style": shownTexture || undefined }}
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
              shown && !holding
                ? tr("Кадр из игры в стиле «{1}»: {0}")
                : tr("Кадр из игры: {0}"),
              sceneLabel,
              tr(card.name),
            )}
          />
        ) : (
          url && (
            <img
              src={url}
              alt={fill(tr("Кадр из игры: {0}"), sceneLabel)}
              draggable={false}
            />
          )
        )
      }
      pill={badge}
      title={`${tr("Кадр из игры")} — ${sceneTitle}`}
      soft={(shown || legacy.gray) && !holding ? tr("приблизительно") : ""}
      hint={tr("Зажмите кадр — оригинал")}
      desc={tr(
        "Настоящие кадры из игры, обработанные приложением по правилу стиля, — приблизительно. В игре кадр красит шейдер ReShade: стиль ляжет и на людей, небо, воду и огни, а контуры и зерно будут чуть другими. Кадра со стилем из самой игры пока нет.",
      )}
    />
  );

  const panel = (
    <div className="texture-downgrade-panel opf-pane">
      <h3>{tr("Стиль мира")}</h3>
      <p className="opf-lead">
        {tr(
          "Нажмите на стиль, чтобы посмотреть его на кадре. В игру он уйдёт кнопкой «Применить»: Astral поставит ReShade с шейдером этого стиля в ваши проекты и нарисует им весь кадр игры. «Без стиля» выключает.",
        )}
      </p>
      {legacy.style && (
        <div
          className="opf-plaque"
          role="group"
          aria-label={tr("Прежний стиль текстурами")}
        >
          <p>
            {fill(
              tr(
                "В игре ещё стоит прежний стиль текстурами «{0}»: вместе со стилем ReShade они лягут друг на друга.",
              ),
              tr(styleCard(legacy.style).name),
            )}
          </p>
          <Button
            size="sm"
            icon={<ArrowCounterClockwise />}
            title={tr(
              "Убрать пакет текстур со стилем: текстуры мира снова как в игре",
            )}
            disabled={!supported || Boolean(job)}
            onClick={removeTextureStyle}
          >
            {tr("Снять стиль текстурами")}
          </Button>
        </div>
      )}
      {pending && !busy && (
        <p className="opf-sel-text opf-pending world-style-pick">
          {shown
            ? fill(
                tr(
                  "Выбран стиль «{0}» — пока только на кадре. Поставить в игру — кнопкой «Применить».",
                ),
                tr(card.name),
              )
            : tr(
                "Выбрано «Без стиля» — стиль в игре выключится кнопкой «Применить».",
              )}
        </p>
      )}
      <div className="opf-acts">
        <Button
          variant="primary"
          icon={<Check />}
          title={
            pending
              ? tr("Поставить выбранный стиль в игру")
              : tr("Этот стиль уже в игре")
          }
          disabled={!canApply || !pending}
          onClick={apply}
        >
          {tr("Применить")}
        </Button>
        <StatusLine tone={statusTone} failed={Boolean(failure)}>
          {failure ? fill(tr("Стиль мира: {0}"), failureText(failure)) : status}
        </StatusLine>
      </div>
      <div className="opf-warn world-style-note">
        <b>{tr("Ставите на свой риск")}</b>
        {tr(
          "Стиль рисует ReShade по готовому кадру, поэтому он трогает и интерфейс игры: мини-карту, чат, меню. На некоторых серверах ReShade запрещён: на GTA 5 RP техадмины советуют чистую игру, на Majestic Astral включит в лаунчере «Поддержку графических модификаций» (лаунчер нужно закрыть). «Комикс» проверен в игре, остальные стили пока нет. Ставите на свой риск.",
        )}
      </div>
      {other ? (
        <p className="texture-downgrade-legacy world-style-note">
          {fill(
            tr(
              "Сейчас на вкладке «ReShade» стоит пресет «{0}»: стиль заменит его, а «Без стиля» оставит «без пресета».",
            ),
            other,
          )}
        </p>
      ) : null}
      {/* ЧБ-мир — пакет текстур: стиль ляжет на серый мир. */}
      {legacy.gray && (
        <p className="texture-downgrade-legacy">
          {tr(
            "Включён ЧБ-мир: текстуры мира серые, и стиль ляжет на серый мир. Выключить его — в инструменте «ЧБ-мир».",
          )}
        </p>
      )}
    </div>
  );

  /* Что перерисуется, цена кадра и «как устроено» — под раскрывашкой в шапке плёнки (ТЗ 22.10.2026, п. F: «облегчить настройку»). */
  const notes = (
    <>
      <dl>
        <div>
          <dt>{tr("Перерисуется")}</dt>
          <dd>
            {tr(
              "Весь кадр целиком: мир, люди и одежда, машины, оружие, небо, вода, огни и эффекты — а вместе с ними и интерфейс игры: мини-карта, чат, меню.",
            )}
          </dd>
        </div>
        <div>
          <dt>{tr("Кадры и видеопамять")}</dt>
          <dd>
            {tr(
              "Один проход шейдера по готовому кадру: девять выборок цвета на точку (у «Ретро» четыре), без тяжёлых размытий, лишних текстур и видеопамяти под текстуры. В игре по кадрам шейдеры пока не мерили.",
            )}
          </dd>
        </div>
        <div>
          <dt>{tr("Ночь")}</dt>
          <dd>
            {tr(
              "Тёмное не светлеет: стиль затемняет тона или оставляет их, ночь не подсвечивает — как требуют правила Majestic.",
            )}
          </dd>
        </div>
        <div>
          <dt>{tr("Где работает")}</dt>
          <dd>
            {tr(
              "Majestic и «Россия Онлайн» — через папку графических модов лаунчера; GTA 5 RP и одиночная игра — через корень игры (нужен ASI-загрузчик). В игре Insert открывает меню ReShade, F10 включает и выключает эффекты.",
            )}
          </dd>
        </div>
      </dl>
      <ul>
        <li>
          {tr(
            "Каждый стиль — свой шейдер ReShade и свой пресет Astral: в папке лежит только выбранный стиль, остальные не ставятся. Цвет и насыщенность подтягивает тот же Astral.fx, что и на вкладке «ReShade».",
          )}
        </li>
        <li>
          {tr(
            "Правило у шейдера то же, что у кадра слева: сглаживание, ступени яркости по корню яркости, контуры по яркости, зерно бумаги. Линии и зерно только темнят.",
          )}
        </li>
        <li>
          {tr(
            "Пресет ReShade в проекте один: стиль заменяет пресет вкладки «ReShade», а «Без стиля» оставляет «без пресета». DLSS 5 не трогается.",
          )}
        </li>
        <li>
          {tr(
            "Текстуры игры стиль не меняет: пакет astral_textures со стилем больше не ставится. «ЧБ-мир» и «Ухудшение текстур» по-прежнему используют пакет текстур.",
          )}
        </li>
      </ul>
    </>
  );

  const strip = (
    <FilmCard
      title={tr("Стиль")}
      hint={tr(
        "нажмите на стиль — он появится на кадре; в игру — кнопкой «Применить»",
      )}
      notes={{
        title: tr("Что перерисуется и как это устроено"),
        count: 0,
        content: notes,
      }}
      className="opf-film2-style"
    >
      <div
        className="opf-styles"
        role="radiogroup"
        aria-label={tr("Стиль мира")}
      >
        {STYLE_CARDS.map((item) => {
          const value = reshadeStyleOf(item.id) || NONE;
          const thumb = thumbs[item.id || ""];
          return (
            <button
              key={value}
              type="button"
              role="radio"
              className="opf-style-card"
              aria-checked={(shown || NONE) === value}
              disabled={busy}
              onClick={() => choose(value)}
            >
              <span className="opf-style-pic">
                {thumb ? (
                  <img src={thumb} alt="" draggable={false} />
                ) : (
                  <span />
                )}
              </span>
              <span className="opf-style-label">
                <i className="opf-radio" aria-hidden="true" />
                {tr(item.name)}
              </span>
              <span className="opf-style-text">{tr(item.note)}</span>
            </button>
          );
        })}
      </div>
      {/* Кадр, на котором смотрят стиль: в макете выбора нет, прежний выбор из четырёх кадров оставлен строкой под карточками. */}
      <div
        className="opf-scene-row"
        role="group"
        aria-label={tr("Кадр предпросмотра")}
      >
        <span>{tr("Кадр предпросмотра")}</span>
        {SCENES.map((item) => (
          <button
            key={item.id}
            type="button"
            className="opf-chip"
            aria-pressed={item.id === scene}
            onClick={() => setScene(item.id)}
          >
            {tr(item.label)}
          </button>
        ))}
      </div>
    </FilmCard>
  );

  return (
    <OptimizerSlots
      className="gray-world world-style"
      label={tr("Стиль мира")}
      slots={slots}
      stage={stage}
      panel={panel}
      strip={strip}
    />
  );
}
