//! Слоты следа (`slotReservations`) режима `ypt-texture-patch`: разбор заказа и ответ. Шаг прохода — в `ypt-patch`
//! (`commands/ypt_patch.rs`), строится он функцией `rage_res::ypt::slot_reservations::apply` над общим образом ядра.
//!
//! Раньше слоты шли временной командой `ypt-slots-patch` (сверка с помощником, 16.11.2026); сейчас те же случаи
//! (S01–S44, F01–F38, `parity/host-port/ypt-slots/`) идут через `ypt-patch`, а команда убрана из реестра.

use rage_res::ypt::slot_reservations::{self as slots, Frames, Reservation, Sheet};
use serde_json::Value;

use super::ypt_io::{field, flag_field, int_field, object, text_field, wrong};
use crate::error::Result;

/// Один слот из запроса. Пустой элемент списка (`null`) — слот без полей: его отказ назовёт, чего нет.
pub(super) fn reservation(item: &Value, path: &str) -> Result<Reservation> {
    if item.is_null() {
        return Ok(Reservation::default());
    }
    let sheet = match field(item, "sheet") {
        None => None,
        Some(sheet @ Value::Object(_)) => {
            let at = format!("{path}.sheet");
            Some(Sheet {
                columns: int_field(sheet, "columns", &at)?.unwrap_or(0),
                rows: int_field(sheet, "rows", &at)?.unwrap_or(0),
            })
        }
        Some(_) => return Err(wrong(&format!("{path}.sheet"), "Modovik.RpfHelper.YptSlotSheet")),
    };
    let frames = match field(item, "frames") {
        None => None,
        Some(frames @ Value::Object(_)) => {
            let at = format!("{path}.frames");
            Some(Frames {
                min: int_field(frames, "min", &at)?.unwrap_or(0),
                max: int_field(frames, "max", &at)?.unwrap_or(0),
                last: int_field(frames, "last", &at)?,
                loop_mode: int_field(frames, "loopMode", &at)?,
                scaled_over_life: flag_field(frames, "scaledOverLife", &at)?,
            })
        }
        Some(_) => return Err(wrong(&format!("{path}.frames"), "Modovik.RpfHelper.YptSlotFrames")),
    };
    Ok(Reservation {
        effect: text_field(item, "effect", path)?,
        texture: text_field(item, "texture", path)?,
        donor_effect: text_field(item, "donorEffect", path)?,
        donor_particle: text_field(item, "donorParticle", path)?,
        sheet,
        frames,
    })
}

/// Отчёт о построенных слотах в форме ответа помощника (`slotReservations.reserved`).
pub(super) fn reserved_answer(reserved: &[slots::ReservedSlot]) -> Value {
    reserved
        .iter()
        .map(|slot| {
            object([
                ("effect", Value::from(slot.effect.as_str())),
                ("texture", Value::from(slot.texture.as_str())),
                ("donorEffect", Value::from(slot.donor_effect.as_str())),
                ("donorEmitter", Value::from(slot.donor_emitter.as_str())),
                ("donorParticle", Value::from(slot.donor_particle.as_str())),
                ("donorTexture", Value::from(slot.donor_texture.as_str())),
                ("droppedEmitters", Value::from(slot.dropped_emitters)),
                ("width", Value::from(slot.width)),
                ("height", Value::from(slot.height)),
                ("levels", Value::from(slot.levels)),
                ("format", Value::from(slot.format.as_str())),
                ("columns", Value::from(slot.columns)),
                ("rows", Value::from(slot.rows)),
                ("frameMin", Value::from(slot.frame_min)),
                ("frameMax", Value::from(slot.frame_max)),
                ("lastFrame", slot.last_frame.map_or(Value::Null, Value::from)),
            ])
        })
        .collect()
}
