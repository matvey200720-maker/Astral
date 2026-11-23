//! `running-processes`: какие процессы сейчас запущены — имя исполняемого файла и номер.
//!
//! Приложение спрашивает это перед каждой записью в игру («не запущена ли GTA V») и раз в две
//! секунды, пока идёт установка. Раньше ответ давал `tasklist.exe`: отдельный процесс и секунда
//! ожидания на каждый вопрос, по семь вопросов на установку. Здесь — один снимок процессов
//! Windows (Toolhelp) внутри уже запущенного движка: миллисекунды.
//!
//! `--name <файл.exe>` можно повторять: в ответе только названные (без учёта регистра). Без
//! `--name` — все процессы. На других системах команда отвечает `supported: false` и пустым
//! списком: вызывающий идёт своим запасным путём.

use serde_json::{Map, Value};

use super::Command;
use crate::{
    args::Options,
    error::{EngineError, Result},
    progress::Progress,
};

const COMMAND_NAME: &str = "running-processes";
const NAME_OPTION: &str = "name";

/// Одна строка снимка: имя исполняемого файла, как его знает система, и номер процесса.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Row {
    name: String,
    pid: u32,
}

/// Кого ищут: имена файлов в нижнем регистре. Пустой список — «все».
#[derive(Debug, PartialEq, Eq)]
struct Wanted(Vec<String>);

impl Wanted {
    /// Имя — только имя файла: путь в нём означает ошибку вызывающего, а не «не найдено».
    fn parse(names: &[String]) -> Result<Wanted> {
        let cleaned = names
            .iter()
            .map(|raw| {
                let name = raw.trim();
                let bare = !name.is_empty() && !name.contains(['\\', '/', ':']);
                if bare {
                    Ok(name.to_lowercase())
                } else {
                    Err(EngineError::argument(format!(
                        "Invalid process name: {raw}"
                    )))
                }
            })
            .collect::<Result<_>>()?;
        Ok(Wanted(cleaned))
    }

    fn takes(&self, row: &Row) -> bool {
        self.0.is_empty() || self.0.contains(&row.name.to_lowercase())
    }
}

fn object<const N: usize>(pairs: [(&str, Value); N]) -> Value {
    let mut map = Map::new();
    map.extend(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value)),
    );
    Value::Object(map)
}

fn listed(rows: &[Row], wanted: &Wanted) -> Value {
    let entries = rows
        .iter()
        .filter(|row| wanted.takes(row))
        .map(|row| object([("name", row.name.as_str().into()), ("pid", row.pid.into())]))
        .collect();
    object([
        ("supported", true.into()),
        ("processes", Value::Array(entries)),
    ])
}

fn running_processes(options: &Options, _progress: &Progress) -> Result<Value> {
    let wanted = Wanted::parse(options.values(NAME_OPTION))?;
    if !native::SUPPORTED {
        return Ok(object([
            ("supported", false.into()),
            ("processes", Value::Array(Vec::new())),
        ]));
    }
    let rows = native::snapshot()
        .ok_or_else(|| EngineError::io("Could not take a snapshot of running processes."))?;
    Ok(listed(&rows, &wanted))
}

pub const COMMANDS: &[Command] = &[Command::new(COMMAND_NAME, running_processes)];

/// Вызовы Windows: небезопасный код разрешён только здесь, на самом месте.
#[cfg(windows)]
#[allow(unsafe_code)]
mod native {
    use super::Row;

    pub const SUPPORTED: bool = true;

    type Handle = isize;

    /// `TH32CS_SNAPPROCESS`: в снимке только процессы.
    const PROCESS_SNAPSHOT: u32 = 0x2;
    const INVALID_HANDLE: Handle = -1;
    const NAME_UNITS: usize = 260;

    /// `PROCESSENTRY32W` целиком: нужны номер процесса и имя файла, остальное — место под раскладку.
    #[repr(C)]
    struct Entry {
        size: u32,
        usage: u32,
        pid: u32,
        heap: usize,
        module: u32,
        threads: u32,
        parent: u32,
        priority: i32,
        flags: u32,
        file: [u16; NAME_UNITS],
    }

    impl Entry {
        fn blank() -> Entry {
            Entry {
                size: std::mem::size_of::<Entry>() as u32,
                usage: 0,
                pid: 0,
                heap: 0,
                module: 0,
                threads: 0,
                parent: 0,
                priority: 0,
                flags: 0,
                file: [0; NAME_UNITS],
            }
        }

        fn row(&self) -> Row {
            let end = self
                .file
                .iter()
                .position(|&unit| unit == 0)
                .unwrap_or(NAME_UNITS);
            Row {
                name: String::from_utf16_lossy(&self.file[..end]),
                pid: self.pid,
            }
        }
    }

    // Те же функции объявляет `process_memory.rs` со своей, урезанной раскладкой записи: там нужны
    // только номера, здесь — ещё и имя файла. Раскладки разные, функции одни.
    #[allow(clashing_extern_declarations)]
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateToolhelp32Snapshot(what: u32, id: u32) -> Handle;
        fn Process32FirstW(list: Handle, entry: *mut Entry) -> i32;
        fn Process32NextW(list: Handle, entry: *mut Entry) -> i32;
        fn CloseHandle(handle: Handle) -> i32;
    }

    /// Снимок закрывается при любом выходе из обхода.
    struct Snapshot(Handle);

    impl Drop for Snapshot {
        fn drop(&mut self) {
            // SAFETY: дескриптор получен от `CreateToolhelp32Snapshot` и больше нигде не закрывается.
            unsafe { CloseHandle(self.0) };
        }
    }

    /// Все процессы системы на момент вызова; `None` — снимок не дался.
    pub fn snapshot() -> Option<Vec<Row>> {
        // SAFETY: вызов без указателей.
        let raw = unsafe { CreateToolhelp32Snapshot(PROCESS_SNAPSHOT, 0) };
        if raw == 0 || raw == INVALID_HANDLE {
            return None;
        }
        let list = Snapshot(raw);
        let mut entry = Entry::blank();
        let mut rows = Vec::new();
        // SAFETY: запись живая на время обхода, в её первом слове — её размер.
        let mut more = unsafe { Process32FirstW(list.0, &mut entry) } != 0;
        while more {
            rows.push(entry.row());
            // SAFETY: то же, что выше.
            more = unsafe { Process32NextW(list.0, &mut entry) } != 0;
        }
        Some(rows)
    }
}

#[cfg(not(windows))]
mod native {
    use super::Row;

    pub const SUPPORTED: bool = false;

    pub fn snapshot() -> Option<Vec<Row>> {
        Some(Vec::new())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn row(name: &str, pid: u32) -> Row {
        Row {
            name: name.to_owned(),
            pid,
        }
    }

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|name| (*name).to_owned()).collect()
    }

    #[test]
    fn named_processes_are_found_without_regard_to_case() {
        let rows = [
            row("System", 4),
            row("GTA5.exe", 4120),
            row("gta5_be.EXE", 5008),
            row("Discord.exe", 77),
        ];
        let wanted =
            Wanted::parse(&names(&["gta5.exe", " GTA5_BE.exe ", "GTA5_Enhanced.exe"])).unwrap();
        assert_eq!(
            listed(&rows, &wanted),
            json!({
                "supported": true,
                "processes": [
                    { "name": "GTA5.exe", "pid": 4120 },
                    { "name": "gta5_be.EXE", "pid": 5008 }
                ]
            })
        );
    }

    #[test]
    fn without_names_every_process_is_listed_in_snapshot_order() {
        let rows = [row("System", 4), row("Discord.exe", 77)];
        let wanted = Wanted::parse(&[]).unwrap();
        assert_eq!(
            listed(&rows, &wanted),
            json!({ "supported": true, "processes": [{ "name": "System", "pid": 4 }, { "name": "Discord.exe", "pid": 77 }] })
        );
    }

    #[test]
    fn a_path_or_an_empty_name_is_refused_as_a_bad_argument() {
        for bad in [
            "",
            "   ",
            "C:\\Games\\GTA5.exe",
            "bin/GTA5.exe",
            "D:GTA5.exe",
        ] {
            let refusal = Wanted::parse(&names(&[bad])).unwrap_err();
            assert!(
                refusal.to_string().contains("Invalid process name"),
                "{bad}: {refusal}"
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn the_snapshot_sees_this_very_process() {
        let rows = native::snapshot().expect("snapshot");
        let me = std::process::id();
        let mine = rows
            .iter()
            .find(|row| row.pid == me)
            .expect("own process in the snapshot");
        assert!(mine.name.to_lowercase().ends_with(".exe"), "{}", mine.name);
        assert!(
            rows.len() > 10,
            "a running Windows has more than ten processes"
        );
    }
}
