import { createHash } from "node:crypto";

/*
 * Фонари мастерской — модели фонарей и описание пропов в своём контейнере.
 *
 * Редактор фонарей правит свет ламп прямо в моделях Rockstar (байты
 * `LightAttributes`) и дописывает частицы у ламп в `v_traffic_lights.ytyp`.
 * Эти файлы живут в `x64h.rpf`, трогать который Astral не вправе, поэтому
 * правленые копии уезжают в свой контейнер слоя Astral —
 * `x64/astral/astral_lights.rpf`. Слой регистрируется с `overlay`, и игра
 * берёт одноимённый ресурс из него: так же устроены патчи Rockstar (фонари
 * `patchday2ng` — тот же `overlay` RPF_FILE) и DLC оружия Astral.
 *
 * Данные вне моделей (огни вдали, таблицы эффектов, ядро частиц) ставятся
 * нативным патчем update.rpf рядом — у них общие с другими редакторами
 * файлы и своя стопка точек отката.
 *
 * Строгая форма: только модели фонарей по именам групп редактора и одно
 * описание пропов. Символ доверия предъявить может только install-engine.
 */
export const LOCAL_LAMP_LIGHTS_TRUST = Symbol("local-lamp-lights-package");

export const LAMP_LIGHTS_CONTAINER = "x64/astral/astral_lights.rpf";
export const LAMP_LIGHTS_SLOT = "lamp-lights";
export const LAMP_LIGHTS_SCHEMA = 1;

/* Имена, которые контейнер вправе нести: модели фонарей трёх групп
   редактора (`@modovik/street-light-contract/lamps`, families.js), столбики
   светофоров `prop_traffic_03a/03b` — ламп в них нет, они едут ради краски
   мачты (вид столбов «Светофоры», pole.js, ТЗ 11.10.2026) — и файл описаний
   их архива. */
const MODEL_NAME =
  /^(?:prop_streetlight_[a-z0-9_]{1,24}|prop_oldlight_01[a-c]|prop_traffic_0(?:1[abd]|2[ab]|3[ab])|prop_wall_light_[a-z0-9_]{1,24}|prop_walllight_ld_01|prop_ind_light_[a-z0-9]{1,8}|prop_construcionlamp_01|prop_dt1_13_(?:groundlight|walllightsource))\.(?:yft|ydr)$/;
const ARCHETYPE_FILES = Object.freeze(["v_traffic_lights.ytyp"]);
/* Лампы под мостами и в тоннелях (bridges.js контракта): модели дорог,
   мостов, тоннелей и светильников под шоссе, словари района с листом
   трубки — ровно эти имена, копия списка контракта (совпадение держит тест). */
export const BRIDGE_FILES = Object.freeze([
  "dt1_rd1_fwy03_detail1.ydr",
  "dt1_rd1_fwy03_detail2.ydr",
  "dt1_rd1_fwy03_detail3.ydr",
  "dt1_rd1_r1_12.ydr",
  "fwy_01_split_19_lights.ydr",
  "fwy_01_split_19_lights001.ydr",
  "fwy_04_fw1_04_detail1.ydr",
  "dt1_rd1_lightdummy.ydr",
  "sc1_06_lightproxya.ydr",
  "sc1_06_lightproxyb.ydr",
  "sc1_06_lightproxyc.ydr",
  "sc1_06_lightproxyd.ydr",
  "sc1_06_lightproxye.ydr",
  "sc1_06_lightproxyf.ydr",
  "kt1_09_lightproxya.ydr",
  "kt1_09_lightproxyb.ydr",
  "kt1_09_lightproxyc.ydr",
  "kt1_09_lightproxyd.ydr",
  "kt1_09_lightproxye.ydr",
  "kt1_09_lightproxyf.ydr",
  "hw1_10_bridge01.ydr",
  "hw1_10_bridge02.ydr",
  "id1_34_bridge.ydr",
  "po1_09_bridge.ydr",
  "sp1_12_bridge_1.ydr",
  "dt1_rd1_dt1_tun1stuff.ydr",
  "dt1_rd1_dt1_tun3stuff.ydr",
  "ch1_roadsd_tunrnd_1dcl.ydr",
  "ch1_roadsd_tunrnd_1dcl2.ydr",
  "ch1_roadsd_tunshell_1b.ydr",
  "ch1_roadsd_tunshell_2b.ydr",
  "cs1_12_tunnel01shell_int.ydr",
  "cs1_12_tunnel02shell_int.ydr",
  "cs1_12_tunnel03shell_int.ydr",
  "cs2_roadsb_tun_gavgub1.ydr",
  "cs2_roadsb_tun_gavgub2.ydr",
  "cs2_roadsb_tun_gavgub3.ydr",
  "vb_ca_tunnel_01_lightdummy.ydr",
  "vb_ca_tunnel_02_lightdummy.ydr",
  "vb_ca_tunnel_03_lightdummy.ydr",
  "vb_ca_tunnel_04_lightdummy.ydr",
  "vb_ca_tunnel_05_lightdummy.ydr",
  "dt1_rd1_fwy.ytd",
  "fwy_01_ovly.ytd",
  "dt1_rd1_lod.ytd",
  "fwy_04_lod.ytd",
]);
const MAX_FILES = 160;
const MAX_RESOURCE_BYTES = 4 * 1024 * 1024;

export const isLampLightsFileName = (name) =>
  MODEL_NAME.test(String(name || "")) ||
  ARCHETYPE_FILES.includes(String(name || "")) ||
  BRIDGE_FILES.includes(String(name || ""));

const MANIFEST_KEYS = Object.freeze([
  "id",
  "version",
  "name",
  "editions",
  "scope",
  "adapter",
  "requiresLoader",
  "gameplayChanges",
  "capabilities",
  "slots",
  "lampLights",
  "files",
]);
const LAMP_KEYS = Object.freeze(["schemaVersion", "sourceDigest", "resourceCount"]);
const FILE_KEYS = Object.freeze([
  "source",
  "target",
  "action",
  "entry",
  "merge",
  "size",
  "sha256",
]);
const CAPABILITIES = Object.freeze([
  "rpf-container-entry-v1",
  "astral-content-rpf-v1",
  "direct-update-rpf-v1",
  "direct-update-entries-v1",
]);

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const hasExactKeys = (value, keys) =>
  isPlainObject(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

const versionOf = (suffix) => `${LAMP_LIGHTS_SCHEMA}.0.0-${suffix}`;

/** Хэш содержимого: одинаковые фонари — один и тот же id пакета. */
export function lampLightsDigest(files) {
  const lines = files
    .map((file) => `${file.name}\n${file.sha256}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

export const isLampLightsModId = (value) =>
  /^local-legacy-lamp-lights-[a-f0-9]{12}$/.test(String(value || ""));

/** Манифест фонарей из описи собранных файлов `{ name, size, sha256 }`. */
export function buildLampLightsManifest(files) {
  const digest = lampLightsDigest(files);
  const suffix = digest.slice(0, 12);
  return {
    id: `local-legacy-lamp-lights-${suffix}`,
    version: versionOf(suffix),
    name: "Фонари Astral",
    editions: ["Legacy"],
    scope: "game-root",
    adapter: "rpf-entry",
    requiresLoader: false,
    // Цвет и частицы фонарей — картинка, правил игры они не меняют.
    gameplayChanges: false,
    capabilities: [...CAPABILITIES],
    slots: [LAMP_LIGHTS_SLOT],
    lampLights: {
      schemaVersion: LAMP_LIGHTS_SCHEMA,
      sourceDigest: `sha256:${digest}`,
      resourceCount: files.length,
    },
    files: [...files]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((file) => ({
        source: `payload/${file.name}`,
        target: "update/update.rpf",
        action: "import",
        entry: `${LAMP_LIGHTS_CONTAINER}/${file.name}`,
        merge: { strategy: "rpf-resource-layer-v1" },
        size: file.size,
        sha256: file.sha256,
      })),
  };
}

export function isLocalLampLightsManifest(manifest, edition) {
  // Fail-closed: любое несовпадение с эталонной формой — false без деталей.
  if (String(edition || "").toLowerCase() !== "legacy") return false;
  if (!hasExactKeys(manifest, MANIFEST_KEYS)) return false;
  if (!hasExactKeys(manifest.lampLights, LAMP_KEYS)) return false;
  const idMatch = /^local-legacy-lamp-lights-([a-f0-9]{12})$/.exec(manifest.id);
  if (!idMatch) return false;
  const suffix = idMatch[1];
  if (manifest.version !== versionOf(suffix)) return false;
  if (typeof manifest.name !== "string" || !manifest.name.trim()) return false;
  if (manifest.name.length > 120) return false;
  if (JSON.stringify(manifest.editions) !== JSON.stringify(["Legacy"])) return false;
  if (manifest.scope !== "game-root") return false;
  if (manifest.adapter !== "rpf-entry") return false;
  if (manifest.requiresLoader !== false) return false;
  if (manifest.gameplayChanges !== false) return false;
  if (JSON.stringify(manifest.capabilities) !== JSON.stringify(CAPABILITIES)) return false;
  if (JSON.stringify(manifest.slots) !== JSON.stringify([LAMP_LIGHTS_SLOT])) return false;
  if (manifest.lampLights.schemaVersion !== LAMP_LIGHTS_SCHEMA) return false;
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest.lampLights.sourceDigest || "")) return false;

  const files = manifest.files;
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES) return false;
  if (manifest.lampLights.resourceCount !== files.length) return false;
  const seen = new Set();
  const digestInput = [];
  for (const file of files) {
    if (!hasExactKeys(file, FILE_KEYS)) return false;
    if (typeof file.source !== "string" || !file.source.startsWith("payload/")) return false;
    const name = file.source.slice("payload/".length);
    if (!isLampLightsFileName(name) || seen.has(name)) return false;
    seen.add(name);
    if (file.target !== "update/update.rpf") return false;
    if (file.action !== "import") return false;
    if (file.entry !== `${LAMP_LIGHTS_CONTAINER}/${name}`) return false;
    if (!hasExactKeys(file.merge, ["strategy"])) return false;
    if (file.merge.strategy !== "rpf-resource-layer-v1") return false;
    if (!Number.isInteger(file.size) || file.size < 1 || file.size > MAX_RESOURCE_BYTES) return false;
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || "")) return false;
    digestInput.push({ name, sha256: file.sha256 });
  }
  const digest = lampLightsDigest(digestInput);
  if (manifest.lampLights.sourceDigest !== `sha256:${digest}`) return false;
  if (suffix !== digest.slice(0, 12)) return false;
  return true;
}
