/*
 * Сцена `hud_reticle.gfx` — то, что снято с файла самой игры.
 *
 * До 25.09.2026 редактор считал сцену прицела холстом 720×410, которого в
 * файле нет. Настоящая сцена — 1280×720 точек (заголовок SWF: 25600×14400
 * твипов), и `reticleMC` стоит в её середине (`SET_RETICLE_POSITION` меряет
 * экран теми же 1280×720). Из-за этого превью показывало обычный прицел
 * в 1,8 раза крупнее, чем в игре, а у снайперки линии «до края линзы» в игре
 * обрывались на двух третях радиуса (проверено FFDec на `update.rpf` игрока:
 * сборка с настройками по умолчанию рисовала горизонталь до 331 точки из
 * 545).
 *
 * Всё ниже — в точках этой сцены, центр прицела — 0,0, ось Y вниз. На экране
 * 1920×1080 точка сцены — полтора пикселя.
 */

export const RETICLE_STAGE = Object.freeze({ width: 1280, height: 720 });

/** Единиц SWF (твипов) в точке сцены. */
export const RETICLE_TWIPS = 20;

/** Пикселей экрана 1920×1080 в точке сцены. */
export const RETICLE_PIXELS_1080P = 1080 / 720;

/** Половины сцены: до края экрана по горизонтали и по вертикали. */
export const RETICLE_REACH = Object.freeze({ horizontal: 640, vertical: 360 });

/** Как сцена ложится на экран игрока: по высоте, с центровкой по горизонтали. */
export const RETICLE_STAGE_FIT_MODE = "fit-height-centered";

/**
 * Масштаб и форма сцены прицела, счётчика патронов и счётчика урона на экране игрока
 * (ТЗ H1, 14.11.2026): ОДНО место, откуда окно берёт «сколько точек сцены видно» и «сколько
 * пикселей в точке». Допущение до замера в игре (Н2): 1 точка = H/720 пикселя, сцена вписана по
 * высоте и стоит по центру, поэтому на узком экране края сцены срезаны, а на широком видно
 * больше, чем 1280 точек. Замер игры меняет только эту функцию.
 *
 * `aspect` — форма экрана (число); без неё берётся `width / height` разрешения игры, без обоих —
 * 16:9. `width`, `height` — разрешение игры в пикселях; неизвестное — 1080 по высоте.
 *
 * @returns {{ pixelsPerPoint: number, visibleWidth: number, visibleHeight: number, mode: string }}
 */
export function reticleStageFit({ aspect, width, height } = {}) {
  const pixelHeight =
    Number(height) > 0
      ? Number(height)
      : RETICLE_STAGE.height * RETICLE_PIXELS_1080P;
  const given = Number(aspect);
  const measured =
    Number(width) > 0 && Number(height) > 0
      ? Number(width) / Number(height)
      : 0;
  const ratio =
    given > 0
      ? given
      : measured > 0
        ? measured
        : RETICLE_STAGE.width / RETICLE_STAGE.height;
  return {
    pixelsPerPoint: pixelHeight / RETICLE_STAGE.height,
    visibleWidth: Math.round(RETICLE_STAGE.height * ratio * 1000) / 1000,
    visibleHeight: RETICLE_STAGE.height,
    mode: RETICLE_STAGE_FIT_MODE,
  };
}

/*
 * Штатная линза оптики (`bg_scope`, спрайт 25): чёрное поле 1280×1090 с
 * круглым окном и виньеткой внутри. Окно шире высоты экрана — круг срезан
 * сверху и снизу, чернота видна по бокам.
 */
export const RETICLE_LENS = Object.freeze({
  cx: 0,
  cy: -0.25,
  radius: 544.75,
  mask: Object.freeze({ x: -640, y: -545, width: 1280, height: 1090 }),
  /* Радиальный градиент внутри окна: прозрачный до 0,592 радиуса градиента,
     чёрный 80 % на его краю — у кромки линзы это около 60 %. */
  vignette: Object.freeze({ radius: 604.64, from: 0.5922, opacity: 0.8 }),
});

/*
 * Штатные метки игры, которые остаются поверх своего прицела. Их рисует не
 * сетка, а соседние клипы таймлайна, и сборка их не трогает, пока человек не
 * уберёт их сам.
 *
 *  • hitX — отметка попадания обычного прицела (`hitmarker`, спрайт 8):
 *    четыре косые чёрточки вокруг центра, белые или красные.
 *  • heavyRing — отметка попадания продвинутого прицела хевика
 *    (`hitmarkerMC`, спрайт 35): две дуги вокруг центра, зелёные, при
 *    попадании — красные.
 *  • sniperChevron — отметка попадания большого прицела снайперки
 *    (`hitmarkerMC`, спрайт 40): белая галочка под центром.
 *  • zoomMarker — отметка кратности (`zoomMC.markerMC`): красная риска
 *    справа от центра, едет вправо, пока приближаешь.
 */
export const RETICLE_STOCK = Object.freeze({
  hitX: Object.freeze({
    from: 3.46,
    to: 6.13,
    width: 1.63,
    colour: "#ffffff",
    hit: "#da2f30",
  }),
  heavyRing: Object.freeze({
    inner: 56.1,
    outer: 64.1,
    halfSpan: 72.7,
    colour: "#009900",
    hit: "#c25050",
  }),
  sniperChevron: Object.freeze({
    apex: Object.freeze([0, 5.85]),
    halfWidth: 29.3,
    height: 29.3,
    thickness: 2.4,
    colour: "#ffffff",
    hit: "#c25050",
  }),
  zoomMarker: Object.freeze({
    heavy: Object.freeze({ x: 69, y: 0.6, length: 20 }),
    sniper: Object.freeze({ x: 72, y: 0.9, length: 19 }),
    width: 1.2,
    colour: "#da2f30",
  }),
});

/* Прицел «на цели»: игра тянет его до dotScaler + 15 процентов. */
export const RETICLE_TARGET_SCALE = 1.15;
