/*
 * Род вещи зала по имени модели (вынесено из `arena-objects.js`, ТЗ 27.10.2026: описи вещей, что можно убрать (`arenas.js`), и сам список вещей
 * (`arena-objects.js`) читают одни правила, а друг друга импортировать не могут). Чистые функции без DOM и Node.
 */

/*
 * Род вещи по имени модели — для значка, подписи и порядка списка. Порядок правил важен:
 * «экран» раньше «техники», «светильник» раньше «украшения».
 */
export const ARENA_OBJECT_KINDS = Object.freeze(["screen", "tech", "seat", "table", "plant", "light", "door", "food", "trophy", "structure", "decor"]);
const KIND_RULES = Object.freeze([
  ["structure", /(^|_)(shell|celling|ceiling)(_|$)|decals?(_|$)|navigation|_details$|wall_decor|plane_uv|_lod\d*$/],
  ["screen", /longscreen|circle_screen|_screen|screen_|(^|_)tv(_|$)|fake_screen|monitor|dubg_maptable|flatscreen|tablet|table_sign/],
  ["tech", /laptop|keyboard|mouse|pctower|arcade|phone|djset|projector|speaker|liftbutton|atm_|vend_|mic_|cashpoint/],
  ["seat", /seat|sofa|chair|armchair|stool|bench/],
  ["table", /(^|_)tab(_|le)|table|desk|(^|_)stand$|cup_stand|crate|barrier_rope|fire_hosebox/],
  ["plant", /plant|palm|planter|vase|flowers|hedge/],
  ["light", /lamp|light|lght|bakelight|torch|candles/],
  ["door", /door|enterdec|doorcover|doordecor/],
  ["food", /food|_can(_|$)|ecola|bottle|bag|coffee|juice|napkin|pot_fry|beer|handbag|carrier/],
  ["trophy", /trophy|(^|_)cup(_|$)|helmet/],
]);

/** Род вещи: один из `ARENA_OBJECT_KINDS`, иначе `decor` (украшения и всё прочее). */
export function arenaObjectKind(model) {
  const name = String(model || "").toLowerCase();
  for (const [kind, rule] of KIND_RULES) if (rule.test(name)) return kind;
  return "decor";
}
