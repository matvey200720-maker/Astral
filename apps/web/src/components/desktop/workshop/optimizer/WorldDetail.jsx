import { useCallback, useSyncExternalStore } from "react";
import { gpuClass, shortGpuName } from "@modovik/optimizer/recommend-preset.js";
import { useHardware } from "../../../../features/game-settings/use-hardware.js";
import { failureWords } from "../../../../utils/installFailure.js";
import { useTr } from "../../../../locales/ui.js";
import { useWorkshopInstalls } from "../../../../features/workshop/install-queue/index.js";
import { textureCopyFor } from "./texture-copy.js";
import "./optimizer-film.css";
import {
  setWorldDetail,
  textureJob,
  textureTargetDetail,
  textureTargetGray,
  textureTargetStep,
  textureTargetStyle,
} from "./texture-sync.js";

/*
 * Чёткость ЧБ-мира и стиля мира: «128 px — легко» или «256 px — детальнее»
 * (ТЗ 17.10.2026, задача 10). Одна на обе вкладки — это один пакет текстур.
 *
 * 128 px — два пакета дополнения, около 5 ГБ; 256 px — три пакета, около
 * 9 ГБ (замер на игре владельца: словари 4,1 и модели 5,3 ГиБ, а пакет
 * держит до 3,6). Под текстуры мира видеопамяти уходит вчетверо больше, но
 * не больше, чем в самой игре: её текстуры обычно 512–2048 px.
 *
 * Пока ЧБ-мир и стиль выключены, выбор только запоминается (черновик) и уйдёт
 * с включением; когда что-то из них уже стоит или ждёт в очереди — выбор
 * сразу ставит ту же работу очереди заново, как выключатель «ЧБ-мира». Со
 * ступенью «Ухудшения текстур» предел её, и выбор не действует.
 *
 * Подсказка по видеокарте (`gpuClass`, как у страницы «Графика»): слабой и
 * встроенной 256 px, скорее всего, дадут подгрузки и фризы, средней — могут,
 * мощной хватит. Только подсказка: выбор она не запрещает. Видеопамять
 * Windows отдаёт ненадёжно (больше 4 ГБ не называет), поэтому судим по модели.
 */

const TIERS = Object.freeze(["integrated", "entry", "mid", "strong", "top"]);

/** Сильнейшая из разобранных видеокарт `{ name, tier }` или `null`. */
function strongestGpu(hardware) {
  let best = null;
  for (const gpu of hardware?.gpus || []) {
    const tier = gpuClass(gpu?.name);
    if (tier && (!best || TIERS.indexOf(tier) > TIERS.indexOf(best.tier)))
      best = { name: shortGpuName(gpu.name), tier };
  }
  return best;
}

/* Черновик выбора — один на обе вкладки; пока ничего не стоит, он и есть выбор. */
let draft = null;
const listeners = new Set();
const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export function setDetailDraft(value) {
  draft = value === 256 || value === 128 ? value : null;
  for (const listener of listeners) listener();
}

/** Чёткость для включения ЧБ-мира или установки стиля: выбранная или та, к которой придёт очередь. */
export function useWorldDetail(queue) {
  const chosen = useSyncExternalStore(subscribe, () => draft);
  return {
    detail: chosen ?? textureTargetDetail(queue),
    clear: useCallback(() => setDetailDraft(null), []),
  };
}

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

/* `megabytes(detail)` — сколько весят пакеты при этой чёткости для того, что показывает вкладка. */
export default function WorldDetail({
  locale = "ru",
  supported,
  editor,
  gameRunning = "",
  onNotice,
  megabytes,
}) {
  const tr = useTr();
  const queue = useWorkshopInstalls();
  const textureCopy = textureCopyFor(locale);
  const { detail } = useWorldDetail(queue);
  const gpu = strongestGpu(useHardware());
  const step = textureTargetStep(queue);
  const style = textureTargetStyle(queue);
  const gray = textureTargetGray(queue);
  const active = Boolean(style) || gray;
  const busy = Boolean(textureJob(queue));

  const choose = useCallback(
    (value) => {
      if (!active) {
        setDetailDraft(value === textureTargetDetail(queue) ? null : value);
        return;
      }
      setDetailDraft(null);
      void setWorldDetail({
        detail: value,
        snapshot: queue,
        title: fill(tr("Чёткость мира: {0}"), `${value} px`),
        editor,
        copy: textureCopy,
      })?.then((result) => {
        if (result.cancelled) return;
        if (!result.ok) {
          const running = failureWords({ kind: "game-running" }, "ru").reason;
          const text = String(result.message || "");
          onNotice?.(
            fill(
              tr("Чёткость мира: {0}"),
              text.startsWith(running) ? gameRunning : text,
            ),
            "error",
          );
          return;
        }
        onNotice?.(
          fill(
            tr(
              "Чёткость мира {0} px в игре. Перезапустите игру, чтобы увидеть изменения.",
            ),
            value,
          ),
          "success",
        );
      });
    },
    [active, editor, gameRunning, onNotice, queue, textureCopy, tr],
  );

  const lockedNote = step
    ? fill(
        tr(
          "Чёткость задаёт «Ухудшение текстур» ({0}): пока оно включено, 128 и 256 px не действуют.",
        ),
        textureCopy.levels[step],
      )
    : "";
  /* Описание каждой чёткости — своей карточкой: слова те же, что были под переключателем, без «128 px — легко:» в начале. */
  const lightNote = fill(
    tr("128 px — легко: два пакета, {0} на диске; щадит диск и видеопамять."),
    sizeText(tr, megabytes(128), locale),
  );
  const fineNote = fill(
    tr(
      "256 px — детальнее: три пакета, {0} на диске; текстуры мира в видеопамяти вчетверо больше, чем при 128 px, но не больше, чем в самой игре.",
    ),
    sizeText(tr, megabytes(256), locale),
  );
  const body = (text) => text.replace(/^[^:]*:\s*/, "");
  const tag = (text) => text.replace(/^\d+ px\s*—\s*/, "");
  const cards = [
    { value: 128, tag: tag(tr("128 px — легко")), text: body(lightNote) },
    { value: 256, tag: tag(tr("256 px — детальнее")), text: body(fineNote) },
  ];

  /* Подсказка по видеокарте — только когда выбрана «детальнее» и ступень не главнее. */
  const hint =
    detail === 256 && !step && gpu
      ? fill(
          tr(
            gpu.tier === "integrated" || gpu.tier === "entry"
              ? "{0}: видеокарте слабой ступени 256 px, скорее всего, дадут подгрузки и фризы — лучше 128 px."
              : gpu.tier === "mid"
                ? "{0}: на видеокартах среднего класса (особенно с 4 ГБ памяти) 256 px могут дать подгрузки; заметите фризы — вернитесь на 128 px."
                : "{0}: запаса видеокарты должно хватить на 256 px.",
          ),
          gpu.name,
        )
      : "";
  const disabled = !supported || Boolean(step) || busy;

  return (
    <div className="world-detail">
      <div
        className="opf-details"
        role="radiogroup"
        aria-label={tr("Чёткость мира")}
      >
        {cards.map((card) => (
          <button
            key={card.value}
            type="button"
            role="radio"
            className="opf-detail-card"
            aria-checked={detail === card.value}
            disabled={disabled}
            onClick={() => choose(card.value)}
          >
            <span className="opf-detail-head">
              <i className="opf-radio" aria-hidden="true" />
              {card.value} px
              <span className="opf-detail-tag">{card.tag}</span>
            </span>
            <p>{card.text}</p>
          </button>
        ))}
      </div>
      {lockedNote && <p className="opf-detail-note">{lockedNote}</p>}
      {hint && (
        <p className="opf-detail-note" data-tier={gpu.tier}>
          {hint}
        </p>
      )}
    </div>
  );
}
