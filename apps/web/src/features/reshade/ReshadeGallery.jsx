/*
 * Кадры из игры слева на странице ReShade (ТЗ 23.10.2026, п. G): большой кадр «до/после» с ползунком и лента
 * миниатюр под ним — целый кадр и его крупные планы (свет, стекло, полки и пол). Кадры настоящие: стенд «В игре»,
 * скриптовая камера, «до» — та же сцена без DLSS 5 (как сняты — `assets/reshade-shots/README.md`). Кадра нет —
 * подписанная заглушка, нарисованное вместо кадра не показывается; сцена без обоих кадров в ленту не встаёт.
 * Превью пресетов — на их карточках ниже, там же сказано, что это не кадр игры.
 */

import { useUiLanguage } from "../../locales/ui.js";
import { useRememberedState } from "../../section-memory.js";
import ReshadeShots, {
  ReshadeShotThumb,
  reshadeShotUrl,
} from "./ReshadeShots.jsx";
import { reshadeCopyFor } from "./reshade-copy.js";
import { reshadePageCopyFor } from "./reshade-page-copy.js";

/* Сцены сравнения: магазин снят 05.10, аэропорт и ночь — когда съёмщик положит их пары. */
const SCENES = Object.freeze(
  ["dlss5", "dlss5-airport", "dlss5-night"].filter(
    (id) =>
      id === "dlss5" ||
      (reshadeShotUrl(`${id}-before`) && reshadeShotUrl(`${id}-after`)),
  ),
);

/*
 * Крупные планы — участки того же кадра, где DLSS 5 меняет больше всего (разница кадров по сетке 8×6): свет ламп и
 * потолок, стекло холодильников, полка и плитка пола. Пиксели — те же, что в полном кадре.
 */
const DETAILS = Object.freeze([
  Object.freeze({
    id: "light",
    crop: Object.freeze({ x: 0.5, y: 0, size: 0.36 }),
  }),
  Object.freeze({
    id: "glass",
    crop: Object.freeze({ x: 0.62, y: 0.34, size: 0.36 }),
  }),
  Object.freeze({
    id: "floor",
    crop: Object.freeze({ x: 0.3, y: 0.52, size: 0.4 }),
  }),
]);

const SLIDES = Object.freeze([
  ...SCENES.map((id) => Object.freeze({ id, file: id, crop: null, scene: id })),
  ...DETAILS.map((detail) =>
    Object.freeze({
      id: `dlss5:${detail.id}`,
      file: "dlss5",
      crop: detail.crop,
      detail: detail.id,
    }),
  ),
]);

export default function ReshadeGallery({ state = null }) {
  const language = useUiLanguage();
  const copy = reshadePageCopyFor(language);
  const dlssCopy = reshadeCopyFor(language);
  const [slideId, setSlideId] = useRememberedState("reshade:frame", "dlss5");
  const slide = SLIDES.find((item) => item.id === slideId) || SLIDES[0];
  const label = (item) =>
    item.scene ? dlssCopy.scenes[item.scene] : dlssCopy.detail[item.detail];
  const title = (item) =>
    item.scene ? dlssCopy.shotTitle(label(item).toLowerCase()) : label(item);

  return (
    <section className="reshade-gallery" aria-label={copy.galleryAria}>
      <ReshadeShots
        key={slide.id}
        id={slide.file}
        crop={slide.crop}
        title={title(slide)}
        caption={dlssCopy.shotCaption}
        before={slide.crop ? dlssCopy.detailBefore : dlssCopy.before}
        after={slide.crop ? dlssCopy.detailAfter : dlssCopy.after}
        className="reshade-hero"
        state={state}
      />
      <div className="reshade-thumbs" role="group" aria-label={copy.thumbsAria}>
        {SLIDES.map((item) => (
          <button
            type="button"
            key={item.id}
            className={`reshade-thumb${item.id === slide.id ? " is-active" : ""}`}
            aria-pressed={item.id === slide.id}
            onClick={() => setSlideId(item.id)}
          >
            <span className="reshade-thumb-frame">
              <ReshadeShotThumb file={`${item.file}-after`} crop={item.crop} />
            </span>
            <span className="reshade-thumb-label">{label(item)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
