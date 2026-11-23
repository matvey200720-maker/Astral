/*
 * Анимации мастерской (ТЗ 29.10.2026-d): какие словари `.ycd` игры годятся в «эмоции» и как они зовутся. Правила без чтения
 * игры — читает и считает `animation-index.js`.
 *
 * Игра хранит клипы словарями: `amb@world_human_hang_out_street@male_a@idle_a.ycd` — один словарь, в нём клипы. В выдачу идут
 * только те, что человек узнает как «что-то делает персонаж»: эмоции, танцы, жесты, сценарии (курить, звонить, сидеть на
 * лавке), позы. Бой, машины, ролики сюжета, лица и ходьба — не выдача: заменять там нечего. Женские словари не берутся: в окне
 * стоит мужской свободный персонаж `mp_m_freemode_01`, женской анимации на нём не видно.
 */

/** Разделы выдачи — как в сетке; `own` — файлы, что человек добавил сам. */
export const ANIMATION_SECTIONS = Object.freeze(["emotes", "dances", "gestures", "scenarios", "rest", "poses", "own"]);

const FEMALE = /female|(^|[@_])f([@_]|$)/;
/* Вход, выход и реакции — части сценария, не анимация, которую выбирают. */
const PARTS = /@(enter|exit|flee|flee_\w+|react\w*|aggro\w*|getup|get_up|fallback|intro|outro|outro_\w+|enter_\w+|exit_\w+)$/;
/* Нужна машина, автобус или реквизит, которого в окне нет. */
const NEEDS_VEHICLE = /in_car|in_bus|in_veh|@veh@|_veh_|heli|bike|boat|plane|train|taxi/;
const DANCE = /dance|dancer|lap_dance|strip/;
const REST = /(^|[@_])(seat|seated|sit|sitting|bench|chair|couch|sofa|lay|laying|sleep|sleeping|sunbathe|picnic|bum_slumped|stupor|lean|leaning|crouch|kneel)([@_]|$)/;
const GESTURE = /gesture|taunt|wave|salute|point|beckon|clap|thumbs/;
const POSE = /pose|^handposes|^mp_ped_interaction/;

/* Танцы на выбор, а не толпа клуба: соло, подиум, пляж — у каждого своё имя в игре. Толпы, парные танцы и переходы — не выдача. */
const SOLO_DANCE = /^(anim@amb@nightclub@mini@dance@dance_solo@|anim@amb@nightclub@dancers@(podium|tale_of_us|solomun|dixon|black_madonna)\w*@|anim@amb@nightclub_island@dancers@(beachdance|club)@|anim@mp_player_intcelebrationmale@(\w*dance\w*|\w*groove\w*))/;
const CROWD = /crowd|transition|paired|ambientpeds|facedj|entourage|trans_/;

/**
 * Раздел словаря игры или `null`, если в выдачу он не идёт. `dictionary` — имя без `.ycd`.
 *
 * В выдаче то, что человек сам включает эмоцией, жестом или сценарием; сценарии сюжета, толпа клуба, бой, машины и ролики — нет.
 */
export function classifyGameDictionary(dictionary) {
  const name = String(dictionary || "").toLowerCase();
  if (!name || FEMALE.test(name) || PARTS.test(name) || NEEDS_VEHICLE.test(name)) return null;
  if (/^anim@mp_player_intincar/.test(name)) return null;
  if (SOLO_DANCE.test(name) && !CROWD.test(name)) return "dances";
  if (/^anim@mp_player_intcelebrationmale@/.test(name)) return "emotes";
  /* Жесты, что игра включает кнопкой: палец, кивок, любовь братьев, указание рукой. */
  if (/^(anim@mp_player_intupper|mp_player_int_?upper|mp_player_intdrink|mp_ped_interaction|anim@mp_point|gestures@m@standing)/.test(name)) return "gestures";
  if (/^amb@(world|prop)_human_/.test(name)) return REST.test(name) ? "rest" : "scenarios";
  if (/^anim@amb@beach_party@lean/.test(name)) return "rest";
  return null;
}

/** Клип, который в выдачу не идёт: женские и «лицо», номера слотов толпы, первое лицо из машины. */
export const skippedClip = (clip) => /female|facial|\^[2-9]$|_fp$|(^|_)fp_|(^|_)(enter|exit|flee|react|aggro|getup|intro|outro)(_|$)/i.test(String(clip || ""));

/**
 * Раздел по имени клипа чужого файла (свои словари: у них имя словаря ничего не значит, а клип зовут, как танец).
 */
export function classifyOwnClip(clip) {
  const name = String(clip || "").toLowerCase();
  if (DANCE.test(name) || /(^|_)(floss|macarena|shuffle|twist|moonwalk|disco|hip_hop|boogie|gangnam|rollie|breakdance)(_|$)/.test(name)) return "dances";
  if (REST.test(name)) return "rest";
  if (GESTURE.test(name)) return "gestures";
  if (POSE.test(name)) return "poses";
  return "emotes";
}

const SMALL_WORDS = new Set(["an", "the", "of", "and", "in", "on", "to"]);

const titleCase = (text) =>
  text
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word, index) => (index > 0 && SMALL_WORDS.has(word) ? word : word[0].toUpperCase() + word.slice(1)))
    .join(" ");

/* Служебные приставки словарей игры: по ним смысла нет, только шум в названии. */
const PREFIXES = /^(world_human_|prop_human_|code_human_|mp_player_intcelebration(male|female)?_?|mp_player_int_?upper_?|mp_player_int_?|mp_player_|intcelebration_?)/;
const LEADING = new Set(["anim", "amb", "mini", "combat", "gestures", "mp", "missfbi"]);
/* Слова пути, что есть у сотен словарей и ничего не говорят о самой анимации: «Nightclub · Mini · Dance · Dance Solo · …». */
const NOISE = new Set(["nightclub", "nightclub_island", "mini", "dance", "dance_solo", "dancers", "ingame", "male", "base", "idle", "heeled", "streamed"]);

/**
 * Название для сетки: «Baton Twirl», «Hang Out Street · Male A · Idle A». Имена в игре английские и технические — переводить
 * тысячи их нечем, и человек узнаёт анимацию по картинке и по слову, которое видел в меню сервера.
 */
export function humanizeAnimation(dictionary, clip) {
  const segments = String(dictionary || "").split("@").filter(Boolean);
  while (segments.length > 1 && LEADING.has(segments[0].toLowerCase())) segments.shift();
  const words = segments.map((segment) => titleCase(segment.replace(PREFIXES, "")));
  const last = (segments[segments.length - 1] || "").toLowerCase();
  const tail = String(clip || "");
  const same = !tail || tail.toLowerCase() === last || tail.toLowerCase() === segments.join("_").toLowerCase();
  if (!same) words.push(titleCase(tail.replace(PREFIXES, "")));
  const unique = words.filter((word, index) => word && word !== words[index - 1]);
  const meaningful = unique.filter((word, index) => !NOISE.has(word.toLowerCase().replace(/ /g, "_")) || index === unique.length - 1);
  return (meaningful.length ? meaningful : unique).join(" · ") || titleCase(String(clip || dictionary || ""));
}

/** Номер записи в меню: «чему-то №12» ищут по числу (`Название или номер`). */
export const animationNumber = (index) => String(index + 1);

/** Стабильный ключ анимации: источник, словарь, клип — по нему замены помнят выбор. */
export const animationId = (source, dictionary, clip) => `${source}:${String(dictionary).toLowerCase()}/${String(clip).toLowerCase()}`;

/**
 * Клип, который не показывают: лицо и вспомогательные дорожки не анимация тела. Камера парных жестов (`mp_ped_interaction`: `handshake_cam`,
 * `highfive_cam`, `hugs_cam`, `kisses_cam`) — дорожка камеры без единой кости: в сетке она стояла плиткой без позы, а выбор отвечал «В клипе
 * нет движения костей» (журнал владельца 01.11.2026, beta.87; проверено по игре этого ПК: из 1461 клипа выдачи пустые — ровно эти четыре).
 */
export const hiddenClip = (clip) => /_facial$|^facial|_face$|@facial|^player_(l|r)_|_ik$|_camera$|_cam$|^cam_/.test(String(clip || "").toLowerCase());
