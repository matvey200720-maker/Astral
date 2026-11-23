/*
 * Настоящий грим GTA V (голос владельца 01.11.2026: «добавь все гримы, которые есть в игре, вот эти макияжи всякие. Бороды не надо»).
 *
 * Лежит он не в коллекциях тату, а в данных персонажа: `common/data/effects/peds/facial_overlays.meta`, по разделу на вид наложения цирюльника. Берём три вида — макияж (`makeup`), румяна (`blusher`) и помаду
 * (`skinDetail1`). Бород (`facialHair`), бровей, родинок и старения здесь нет: это не грим. В файле игры 49 строк написаны `<item>` строчными (`MP_Heist4_FacePaint_*`, `MP_Security_FacePaint_*`, `MP_Christmas2017_Facepaint_*`): разбор без учёта регистра, иначе их теряет.
 *
 * Картинка `<имя>.ytd` лежит там же, где картинки тату (`*ped_mp_overlay_txds.rpf`), и нарисована на развёртке кожи головы. Вторая развёртка головы (зона тату) совпадает с первой точка в точку (сверено по моделям игры 01.11.2026:
 * `head_013_r` и `head_000_r`, 1514 вершин из 1514), поэтому для тату-переноса это обычное наложение зоны головы с рамкой во всю зону (`FACIAL_FRAME`): картинка лежит на лице один в один.
 *
 * Чистый JS: работает в окне, в главном процессе и в тестах.
 */

/* Вид наложения по разделу файла. Порядок — как в списке окна. */
export const FACIAL_GROUPS = Object.freeze([
  Object.freeze({ id: "makeup", section: "makeup", label: "Макияж" }),
  Object.freeze({ id: "blusher", section: "blusher", label: "Румяна" }),
  Object.freeze({ id: "lipstick", section: "skinDetail1", label: "Помада" }),
]);

/* Рамка во всю зону головы: картинка наложения — вся развёртка головы. */
export const FACIAL_FRAME = Object.freeze({ uv: Object.freeze({ x: 0.5, y: 0.5 }), scale: Object.freeze({ x: 0.5, y: 0.5 }), rotation: 0 });

/*
 * Семейства: как называть наложение по имени файла. Своих названий у него в данных нет: подпись цирюльника знает скрипт, а не файлы, поэтому имя — семейство и номер. Порядок важен: первое совпадение.
 * Подпись — ключ словаря окна.
 */
const FAMILIES = Object.freeze([
  [/^mp_fm_faov_makeupm_/, "Мужской макияж"],
  [/^mp_ind_faov_makeup_/, "Макияж Дня независимости"],
  [/^mp_fm_faov_makeup_/, "Макияж"],
  [/^demonic_/, "Демонический грим"],
  [/^hwskull_/, "Грим-череп"],
  [/^sugarskull_/, "Сахарный череп"],
  [/^mp_heist4_facepaint_/, "Раскраска Кайо-Перико"],
  [/^mp_security_facepaint_/, "Раскраска The Contract"],
  [/^mp_christmas2017_facepaint_/, "Рождественская раскраска"],
  [/^mp_fm_faov_blusher_/, "Румяна"],
  [/^mp_fm_faov_lips_g_/, "Блеск для губ"],
  [/^mp_fm_faov_lipsm_/, "Мужская помада"],
  [/^mp_fm_faov_lips_/, "Помада"],
]);

/** Подпись и номер наложения для людей: `{ family, number }`. Незнакомое семейство (новое дополнение игры) — по виду наложения: потерять его нельзя. */
export function facialName(name, group = "makeup") {
  const wanted = String(name || "").toLowerCase();
  const family = FAMILIES.find(([pattern]) => pattern.test(wanted))?.[1] || FACIAL_GROUPS.find((item) => item.id === group)?.label || "Макияж";
  const number = Number(/(\d+)$/.exec(wanted)?.[1] ?? -1);
  return { family, number: number >= 0 ? number + 1 : 0 };
}

/** Имя наложения одной строкой: «Демонический грим №3». */
export function facialTitle(facial, translate = (text) => text) {
  return facial.number ? `${translate(facial.family)} №${facial.number}` : translate(facial.family);
}

/** Наложения грима из `facial_overlays.meta`: `[{ name, group }]`, без повторов, в порядке файла. */
export function parseFacialOverlays(text) {
  const clean = String(text || "").replace(/<!--[\s\S]*?-->/g, "");
  const seen = new Set();
  const out = [];
  for (const group of FACIAL_GROUPS) {
    const block = new RegExp(`<${group.section}>([\\s\\S]*?)</${group.section}>`, "i").exec(clean)?.[1] || "";
    for (const [, raw] of block.matchAll(/<item>\s*([^<]*?)\s*<\/item>/gi)) {
      const name = raw.toLowerCase();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push({ name, group: group.id });
    }
  }
  return out;
}
