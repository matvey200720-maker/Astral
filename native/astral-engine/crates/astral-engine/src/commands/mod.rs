//! Реестр команд движка: каждый модуль группы отдаёт таблицу `COMMANDS`, здесь они сведены в один
//! список в порядке показа и открыты двумя поисками — перебором всех и по имени.

use crate::{args, error, progress};

/// Объявляет модули команд и сводный список групп.
///
/// `shown` — модули, чьи таблицы `COMMANDS` входят в [`GROUPS`], в порядке показа; `hidden` —
/// модули, которые лишь объявлены (их команды подключены другими путями).
macro_rules! registry {
    (
        shown: [$($group:ident),+ $(,)?],
        hidden: [$($other:ident),* $(,)?] $(,)?
    ) => {
        $(pub mod $group;)+
        $(pub mod $other;)*

        /// Группы команд в порядке показа; порядок задаёт и порядок [`all`].
        pub const GROUPS: &[&[Command]] = &[$($group::COMMANDS),+];
    };
}

registry! {
    shown: [
        engine, process_memory, running_processes, billboards_build, roads_build, rpf_listing, vegetation_build, water_build, dds, emblem, climb, sign, archive, models,
        readers, ycd_xml,
        textures, ytd, ypt, ypt_patch, ypt_clones, shop, split, graft, decorate, restyle, restyle_model, skin_from_body, gen9,
        lamp_pole, levels, pack, style_texture, star, star_model, sky, sky_flyer,
        lamp_archive_scan, lamp_studio_ytyp, lamp_lod_nearest, lamp_lod_pair, lamp_lod_patch,
        lamp_studio_lod, lamp_studio_patch, lamp_inspect, lamp_patch, lamp_plan, lamp_verify,
        lamp_studio_inspect, lamp_studio_glass, rainbow, meta, place_types, manifest,
        placements, minimap, map, interiors, mapfiles, layout, mlo_models, wallbang, mega_mall,
        awc_bank_scan, awc_inspect, awc_patch, awc_from_wav, weapons_meta, workshop_textures, sample_anim_track, world_place_scene,
        patch_animal_model,
        ypt_own_donor,
    ],
    hidden: [lamp_mutations, split_heads, radar_overlay, levels_yft, ypt_io, ypt_slots],
}

mod fresh_dirs;

/// Обработчик команды: получает разобранные параметры и отчёт о ходе, отдаёт JSON-ответ.
pub type Handler =
    for<'a, 'b> fn(&'a args::Options, &'b progress::Progress) -> error::Result<serde_json::Value>;

/// Одна команда движка: имя в командной строке и её обработчик.
pub struct Command {
    pub run: Handler,
    pub name: &'static str,
}

impl Command {
    pub const fn new(name: &'static str, run: Handler) -> Self {
        Command { run, name }
    }
}

/// Все команды: группы по порядку [`GROUPS`], внутри группы — по порядку записей.
pub fn all() -> impl Iterator<Item = &'static Command> + Clone {
    GROUPS.iter().flat_map(|&group| group)
}

/// Первая по порядку [`all`] команда с точно таким именем.
pub fn find(name: &str) -> Option<&'static Command> {
    all().find(|command| name == command.name)
}

#[cfg(test)]
mod tests {
    use super::all;
    use std::collections::BTreeSet;

    /// Имя годится, если оно непустое и состоит из строчных латинских букв, цифр и дефисов.
    fn is_kebab(name: &str) -> bool {
        let allowed = |byte: u8| matches!(byte, b'-' | b'0'..=b'9' | b'a'..=b'z');
        !name.is_empty() && name.bytes().all(allowed)
    }

    #[test]
    fn names_are_unique_lowercase_kebab_case() {
        let mut seen = BTreeSet::new();
        all().map(|command| command.name).for_each(|name| {
            assert!(is_kebab(name), "{name}");
            assert!(seen.insert(name), "дубль: {name}");
        });
    }
}
