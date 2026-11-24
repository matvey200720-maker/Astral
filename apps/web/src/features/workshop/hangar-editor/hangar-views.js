/*
 * Камера мастерской ангара по разделам (задача лида 1, 23.11.2026; переделка «Внутри» с подвкладками — 23.11.2026, владелец).
 * Пункт над панелью («Снаружи», «Внутри», «Конструкции») и подвкладки «Потолок», «Дом» и раздел «Цвет труб» ведут камеру изнутри к тому, что правят: `hangarFocusFor(shot)` — поза перелёта
 * `insideFocus` кадра (`{ eye, yaw, pitch, fov, at }`: оси сцены, Z вверх, взгляд `(sin yaw·cos pitch, cos yaw·cos pitch, sin pitch)`, как у `flyInside`). Перелёт — один на вход в раздел
 * (`at` — метка входа): правка цвета камеру не трогает, а улетевшего в полёте человека к виду насильно не возвращают, пока он не сменил раздел (`HangarStudio.jsx`, `onFocusView`).
 *
 * Позы — по осям сцены ангара (центр (0, 0)), снятым с `scene.bin` окном (клетки `hangar-views-geometry.test.js` проверяют их по геометрии той же сцены):
 *   трубы — синие трубы на стенах, скопления у (−33,3 13,9 6,3), (−30,2 20,0 0,9), (1,4 −38,7 8,5), (44,9 −0,8 6,9), (27,2 −22,5 4,3): глаз в зале у западной стороны, взгляд на северо-западную стену, где два скопления рядом;
 *   потолок — глаз тот же, что у вида «Внутри» (у задней стены на высоте человека), взгляд круто вверх (0,85): в кадре гофра потолка под крышей (листы `ap1_01_hangre_1`, `ap1_01_hangre_4`, z 15…20 м);
 *   дом — повёрнутый на 45° дом у ВОСТОЧНОГО торца зала (коробка x 23,6…43,5, y −22,5…−0,2, высота 2,8 м): глаз в зале напротив (8; −11,4; 1,7) на высоте человека, взгляд на восток — в кадре блочная стенка, дверь и окна дома со стороны
 *   ангара, как у человека, что подходит к дому. Глаз вне дома и вне коробки: к дому внутрь камера не летит (нутро дома не настраивается).
 */
import { HANGAR_VIEW } from "@modovik/climb-contract/recolor/hangar";

/* «Конструкции» щелчком над панелью: глаз тот же, что у вида «Внутри», взгляд поднят на фермы и кран (радианы). */
export const HANGAR_STRUCTURE_PITCH = 0.62;

/** Вид «Трубы»: стена с синими трубами. */
export const HANGAR_PIPES_VIEW = Object.freeze({ eye: Object.freeze([-17, 9, 2.8]), yaw: -1.212, pitch: 0.1, fov: 72 });
/** Вид «Потолок»: глаз как у «Внутри», взгляд круто вверх, на гофру потолка под крышей. */
export const HANGAR_CEILING_PITCH = 0.85;
/** Вид «Дом»: со стороны ангара на блочную стенку, дверь и окна дома. */
export const HANGAR_HOUSE_VIEW = Object.freeze({ eye: Object.freeze([8, -11.4, 1.7]), yaw: Math.PI / 2, pitch: 0.05, fov: 72 });

/** Куда лететь камере изнутри по пункту `shot = { tool, at }`; `null` — камера стоит. */
export function hangarFocusFor(shot) {
  if (!shot) return null;
  const at = shot.at;
  switch (shot.tool) {
    case "inside":
      return { eye: HANGAR_VIEW.eye, yaw: HANGAR_VIEW.yaw, pitch: HANGAR_VIEW.pitch, fov: 72, at };
    case "structure":
      return { eye: HANGAR_VIEW.eye, yaw: HANGAR_VIEW.yaw, pitch: HANGAR_STRUCTURE_PITCH, fov: 72, at };
    case "pipes":
      return { ...HANGAR_PIPES_VIEW, at };
    case "ceiling":
      return { eye: HANGAR_VIEW.eye, yaw: HANGAR_VIEW.yaw, pitch: HANGAR_CEILING_PITCH, fov: 72, at };
    case "house":
      return { ...HANGAR_HOUSE_VIEW, at };
    default:
      return null;
  }
}
