// Числа неба для света арены снаружи: ряды региона GLOBAL ясной погоды из файлов игры игрока.
// Чтение тяжёлое, поэтому оно запоминается по корню игры на всё время жизни окна.
import { PREVIEW_WEATHER, parseKeyframeXml } from "@modovik/timecycle";
import { readSkyBases } from "../../../api.js";

// Запоминает итоговое обещание по ключу; исключение, брошенное сразу, ничего не оставляет в памяти.
function rememberPerKey(produce) {
  const shelf = new Map();
  return {
    obtain(key) {
      if (shelf.has(key)) return shelf.get(key);
      const fresh = produce(key);
      shelf.set(key, fresh);
      return fresh;
    },
    clear() {
      shelf.clear();
    },
  };
}

const xmlFrom = (answer) => answer?.timecycles?.[PREVIEW_WEATHER]?.xml;

const GLOBAL_WORD = /global/i;

function globalRows(xml) {
  const { regions } = parseKeyframeXml(xml);
  const wanted = regions.find(({ name }) => GLOBAL_WORD.test(name));
  return (wanted ?? regions[0]).values;
}

// Что бы ни случилось с мостом или разбором, снаружи виден только null.
async function settle(request) {
  try {
    const xml = xmlFrom(await request);
    return xml ? globalRows(xml) : null;
  } catch {
    return null;
  }
}

const perRoot = rememberPerKey((gameRoot) => settle(readSkyBases({ gameRoot })));

export const loadArenaSkyValues = (gameRoot) =>
  gameRoot ? perRoot.obtain(gameRoot) : Promise.resolve(null);

export const forgetArenaSkyValues = () => {
  perRoot.clear();
};
