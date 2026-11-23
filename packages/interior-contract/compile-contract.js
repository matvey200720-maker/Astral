import { normalizeInteriorDesign } from "./design.js";
import { canonicalSha256 } from "./canonical.js";
import { getInteriorLocation } from "./registries.js";
import { validateInteriorDesign } from "./validation.js";

export const INTERIOR_COMPILE_REQUEST_FORMAT = "astral.compile-interior-layout";
export const INTERIOR_COMPILE_REQUEST_VERSION = 1;

const entryName = (locationId) =>
  `astral_int_${locationId.replace(/[^a-z0-9]/g, "_")}.ymap`;
export const interiorLocationSlot = (locationId) =>
  `interior-location-${locationId.replace(/[^a-z0-9-]/g, "-")}`;

export function createInteriorCompileRequest(
  design,
  { targetId = "gta5-legacy-story" } = {},
) {
  const normalized = normalizeInteriorDesign(design);
  const report = validateInteriorDesign(normalized);
  const location = getInteriorLocation(normalized.locationBinding.locationId);
  /*
   * Хэш считается по требованию.
   *
   * SHA-256 на чистом JS по всему макету — самая дорогая операция контракта:
   * двадцать пять килобайт JSON, четыреста блоков сжатия, полмиллисекунды. А
   * нужен он двум местам, и оба открываются нажатием: подпись в диалоге плана и
   * payload установки. Запрос же плана редактор строит на каждую правку — ради
   * назначения, признака готовности и списка помех, которые стоят копейки.
   *
   * Свойство остаётся обычным свойством: кто читает `plan.designHash`, получает
   * ту же строку, что и раньше, и считается она один раз на план.
   */
  let designHash = "";
  return Object.freeze({
    format: INTERIOR_COMPILE_REQUEST_FORMAT,
    version: INTERIOR_COMPILE_REQUEST_VERSION,
    targetId,
    /* Хэш считается от УЖЕ нормализованного: `hashInteriorDesign` нормализует
       вход сам, и здесь это была бы вторая нормализация подряд — лишние 0.22 мс
       и полторы тысячи объектов на каждую правку макета. */
    get designHash() {
      if (!designHash) designHash = canonicalSha256(normalized);
      return designHash;
    },
    locationId: location.id,
    templateRef: normalized.templateRef,
    catalogRevision: normalized.catalogRevision,
    entities: normalized.entities
      .filter((entity) => !entity.editor.hidden)
      .map((entity) => ({
        id: entity.id,
        propId: entity.propId,
        position: entity.position,
        rotation: entity.rotation,
      })),
    destination: {
      atomicSlot: interiorLocationSlot(location.id),
      container: "x64/astral/astral_maps.rpf",
      entry: entryName(location.id),
    },
    eligible: report.valid && location.installable,
    blockers: Object.freeze([
      ...report.errors.map((issue) => issue.message),
      ...(!location.installable
        ? [
            "Локация не прошла живой smoke-тест и пока не может быть скомпилирована для установки.",
          ]
        : []),
      ...(targetId !== "gta5-legacy-story"
        ? ["MVP компилятора ограничен GTA V Legacy Story."]
        : []),
    ]),
  });
}
