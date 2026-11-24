import { useStageBusy } from "../../../components/ui/stage-busy.js";
import StageLoader from "./StageLoader.jsx";
import { useStageLoad } from "./use-stage-load.js";

/*
 * Заставка для кадров не из `ModelStage` — большая карта, карта мода (ТЗ 42В):
 * `active` — «сцена ещё грузится». Показывается с задержкой, растворяется, пока
 * стоит — инструменты редактора приглушены. Ставится внутрь оболочки редактора
 * (хук ищет её контекст выше по дереву). `dim={false}` — инструменты не приглушать; `passThrough` —
 * заставка не ловит мышь (студия ствола: полка стволов под ней должна работать, пока модель едет). `kit` — подписи шагов
 * редактора (`loader-kits.js`), `stage` — настоящий этап загрузки без счёта листов (`StageLoader.jsx`), `onRetry` —
 * «Повторить» в строке «идёт дольше обычного» (чтение, которое не отвечает, начинают заново).
 */
export default function StageLoadOverlay({
  active,
  progress = null,
  title = "",
  detail = "",
  dim = true,
  passThrough = false,
  kit = "hall",
  stage = "",
  onRetry = null,
  onBack = null,
  /* Короткое растворение (мс) для карточки, что не мешает работе (`dim={false}` и `passThrough`): модель уже на экране, и «загрузка» поверх неё не должна висеть полсекунды. Без значения — `OUT_MS`. */
  outMs = undefined,
}) {
  const load = useStageLoad(Boolean(active), outMs ? { outMs } : {});
  useStageBusy(dim && load.shown && load.phase === "in");
  if (!load.shown) return null;
  return (
    <StageLoader
      variant={load.variant}
      phase={load.phase}
      progress={progress}
      title={title}
      detail={detail}
      passThrough={passThrough}
      kit={kit}
      stage={stage}
      outMs={outMs}
      onRetry={onRetry}
      onBack={onBack}
    />
  );
}
