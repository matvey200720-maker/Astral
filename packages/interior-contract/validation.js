import {
  getInteriorLocation,
  getInteriorProp,
  getInteriorTemplate,
} from "./registries.js";

export const INTERIOR_MAX_ENTITIES = 128;
export const INTERIOR_MAX_UNIQUE_PROPS = 32;
export const INTERIOR_MAX_JSON_BYTES = 512 * 1024;

/**
 * След предмета на полу с учётом поворота: осевой прямоугольник вокруг
 * повёрнутой коробки.
 *
 * Вынесено наружу, потому что этой же геометрией редактор удерживает предмет в
 * комнате при перетаскивании. Считай он след своей формулой — проверка и мышь
 * разошлись бы на первом же повороте на 45°, и человек получил бы предмет,
 * который мышь ставит, а отчёт красит ошибкой.
 */
export const rotatedFootprint = (bounds, yawDegrees) => {
  const radians = (yawDegrees * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  return {
    width: bounds.width * cosine + bounds.depth * sine,
    depth: bounds.width * sine + bounds.depth * cosine,
  };
};

export function quaternionToYaw(rotation) {
  const { x, y, z, w } = rotation;
  return (
    (Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) * 180) / Math.PI
  );
}

function entityRect(entity, prop) {
  const size = rotatedFootprint(prop.bounds, quaternionToYaw(entity.rotation));
  return {
    minX: entity.position.x - size.width / 2,
    maxX: entity.position.x + size.width / 2,
    minY: entity.position.y - size.depth / 2,
    maxY: entity.position.y + size.depth / 2,
  };
}

const overlaps = (left, right) =>
  left.minX < right.maxX &&
  left.maxX > right.minX &&
  left.minY < right.maxY &&
  left.maxY > right.minY;

export function validateInteriorDesign(design) {
  const errors = [];
  const warnings = [];
  const location = getInteriorLocation(design?.locationBinding?.locationId);
  const template = location
    ? getInteriorTemplate(location.templateId, location.templateVersion)
    : null;
  if (!location)
    errors.push({
      code: "unknown-location",
      path: "locationBinding.locationId",
      message: "Выберите поддерживаемую локацию.",
    });
  if (!template)
    errors.push({
      code: "unknown-template",
      path: "templateRef",
      message: "Шаблон помещения не найден.",
    });
  const entities = Array.isArray(design?.entities) ? design.entities : [];
  if (entities.length > INTERIOR_MAX_ENTITIES)
    errors.push({
      code: "entity-budget",
      path: "entities",
      message: `В одной локации допускается не более ${INTERIOR_MAX_ENTITIES} объектов.`,
    });
  const uniqueProps = new Set(entities.map((entity) => entity.propId));
  if (uniqueProps.size > INTERIOR_MAX_UNIQUE_PROPS)
    errors.push({
      code: "prop-budget",
      path: "entities",
      message: `Допускается не более ${INTERIOR_MAX_UNIQUE_PROPS} типов объектов.`,
    });

  const rectangles = [];
  for (const [index, entity] of entities.entries()) {
    const path = `entities[${index}]`;
    const prop = getInteriorProp(entity?.propId);
    if (!prop) {
      errors.push({
        code: "unknown-prop",
        path: `${path}.propId`,
        entityId: entity?.id,
        message: "Объект отсутствует в безопасном каталоге.",
      });
      continue;
    }
    if (!template) continue;
    const rect = entityRect(entity, prop);
    rectangles.push({ entity, prop, rect, index });
    if (
      rect.minX < template.room.minX ||
      rect.maxX > template.room.maxX ||
      rect.minY < template.room.minY ||
      rect.maxY > template.room.maxY ||
      entity.position.z < template.room.minZ ||
      entity.position.z + prop.bounds.height > template.room.maxZ
    ) {
      errors.push({
        code: "out-of-bounds",
        path: `${path}.position`,
        entityId: entity.id,
        message: `«${prop.label}» выходит за границы помещения.`,
      });
    }
    const protectedVolume = template.protectedVolumes.find((volume) =>
      overlaps(rect, volume),
    );
    if (protectedVolume)
      errors.push({
        code: "protected-volume",
        path: `${path}.position`,
        entityId: entity.id,
        message: `«${prop.label}» перекрывает зону «${protectedVolume.label}».`,
      });
  }

  for (let left = 0; left < rectangles.length; left += 1) {
    for (let right = left + 1; right < rectangles.length; right += 1) {
      if (overlaps(rectangles[left].rect, rectangles[right].rect)) {
        warnings.push({
          code: "prop-overlap",
          path: `entities[${rectangles[right].index}].position`,
          entityId: rectangles[right].entity.id,
          message: `«${rectangles[right].prop.label}» пересекается с «${rectangles[left].prop.label}».`,
        });
      }
    }
  }

  /*
   * Отделка — это предпросмотр, и человек обязан знать это до того, как
   * потратит вечер на подбор цвета стен.
   *
   * Компилятор макета собирает дополнительный YMAP с расстановкой объектов;
   * покрасить стены магазина им нельзя вовсе — это другой пакет и другой
   * материал игры. Молчать об этом значило бы продать картинку за мод.
   */
  const finish = Array.isArray(design?.finish) ? design.finish : [];
  if (finish.length)
    warnings.push({
      code: "finish-preview-only",
      path: "finish",
      message:
        "Отделка показывается в предпросмотре и сохраняется в проекте, но в устанавливаемый пакет пока не входит.",
    });

  if (location && !location.installable)
    warnings.push({
      code: "preview-location",
      path: "locationBinding.locationId",
      message:
        "Локация пока доступна для проектирования и проверки макета; установка откроется после живого smoke-теста.",
    });
  const estimatedCost = rectangles.reduce(
    (sum, item) => sum + item.prop.cost,
    0,
  );
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    entityCount: entities.length,
    uniquePropCount: uniqueProps.size,
    paintedSurfaceCount: finish.length,
    estimatedCost,
  });
}
