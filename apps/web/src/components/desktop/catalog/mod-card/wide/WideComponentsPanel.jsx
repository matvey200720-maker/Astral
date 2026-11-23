import {
  GunComponents,
  ReduxComponents,
  SoundComponents,
} from "./WideComponents.jsx";
import { WIDE_GUN, WIDE_SOUND } from "./wide-model.js";

/*
 * Ленивый вход панели компонентов карточки «Пульт»: список строк, окно «Компоненты» и записи `ModContents` приезжают отдельным куском, когда страница мода уже открыта
 * (кадр, название и «Установить» не ждут). Пока кусок едет, на месте панели серая плита (`WideCard`).
 */
export default function WideComponentsPanel({ kind, ...props }) {
  if (kind === WIDE_GUN) return <GunComponents {...props} />;
  if (kind === WIDE_SOUND) return <SoundComponents {...props} />;
  return <ReduxComponents {...props} />;
}
