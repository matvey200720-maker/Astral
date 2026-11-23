//! `trim-memory`: просит Windows вытеснить страницы рабочего набора у названных
//! процессов Astral (`K32EmptyWorkingSet`). Спящее окно само ничего не
//! освобождает, и его страницы занимают физическую ОЗУ, нужную игре.
//!
//! Трогать разрешено только процессы Astral: главный (родитель движка) и
//! потомки с тем же исполняемым файлом. Сам движок, чужие процессы и игра,
//! которую Astral запустил сам, под запретом: им отвечает `not-astral`, и
//! процесс при этом не открывается. На других системах команда отвечает, что
//! не поддерживается, и дерева не видит.

use std::collections::{BTreeSet, HashMap};

use serde_json::Value;

use super::Command;
use crate::{
    args::Options,
    error::{EngineError, Result},
    progress::Progress,
};

/// Что получилось при сжатии одного процесса.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Squeeze {
    trimmed: bool,
    before: Option<u64>,
    after: Option<u64>,
}

impl Squeeze {
    /// Процесс не открылся ни с какими правами.
    const UNREACHABLE: Squeeze = Squeeze {
        trimmed: false,
        before: None,
        after: None,
    };

    fn entry(&self, pid: u32) -> Value {
        object([
            ("pid", pid.into()),
            ("trimmed", self.trimmed.into()),
            ("workingSetBefore", self.before.into()),
            ("workingSetAfter", self.after.into()),
        ])
    }
}

fn object<const N: usize>(pairs: [(&str, Value); N]) -> Value {
    Value::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    )
}

/// Всё, что движку нужно от системы. На Windows — настоящее, иначе — заглушка;
/// тесты подставляют свою таблицу процессов.
trait Host {
    fn supported(&self) -> bool;
    fn own_pid(&self) -> u32;
    /// Снимок «процесс, родитель» всей системы; `None` — снимка нет.
    fn process_table(&self) -> Option<Vec<(u32, u32)>>;
    /// Путь исполняемого файла в нижнем регистре; `None` — прочитать не удалось.
    fn image_path(&self, pid: u32) -> Option<String>;
    fn squeeze(&self, pid: u32) -> Squeeze;
}

#[allow(unsafe_code)]
#[cfg(windows)]
mod native {
    use super::{Host, Squeeze};

    /// Дескриптор Windows как целое: так же объявлен `CloseHandle` в `memory_limit`.
    type Handle = isize;

    /// Права: только прочитать путь; сжать; сжать и прочитать рабочий набор.
    const QUERY_ONLY: u32 = 0x1000;
    const TO_SQUEEZE: u32 = QUERY_ONLY | 0x0100;
    const TO_SQUEEZE_AND_READ: u32 = TO_SQUEEZE | 0x0010;
    const PROCESS_SNAPSHOT: u32 = 2;
    const PATH_CHARS: usize = 1024;
    /// Рабочий набор — второй из восьми размеров.
    const WORKING_SET: usize = 1;

    /// `PROCESSENTRY32W`: три слова (размер записи, счётчик, номер процесса), указатель кучи, три слова
    /// (номер модуля, число потоков, родитель), приоритет с флагами и путь.
    #[repr(C)]
    struct Row {
        head: [u32; 3],
        heap: usize,
        middle: [u32; 3],
        tail: [u32; 2],
        exe: [u16; 260],
    }

    impl Row {
        fn blank() -> Row {
            Row {
                head: [size_of::<Row>() as u32, 0, 0],
                heap: 0,
                middle: [0; 3],
                tail: [0; 2],
                exe: [0; 260],
            }
        }
    }

    /// `PROCESS_MEMORY_COUNTERS`: два слова (размер записи, число сбоев страниц), затем восемь размеров.
    #[repr(C)]
    struct Usage {
        head: [u32; 2],
        sizes: [usize; 8],
    }

    impl Usage {
        /// Рабочий набор процесса в байтах; `None`, если система отказала.
        fn working_set(process: Handle) -> Option<u64> {
            #[link(name = "kernel32")]
            extern "system" {
                fn K32GetProcessMemoryInfo(target: Handle, out: *mut Usage, bytes: u32) -> i32;
            }

            let mut usage = Usage {
                head: [size_of::<Usage>() as u32, 0],
                sizes: [0; 8],
            };
            // SAFETY: структура живая, в её первом слове настоящий размер.
            let ok = unsafe { K32GetProcessMemoryInfo(process, &mut usage, usage.head[0]) };
            (ok != 0).then_some(usage.sizes[WORKING_SET] as u64)
        }
    }

    /// Дескриптор, который закрывается сам.
    struct Guard(Handle);

    impl Guard {
        fn open(rights: u32, pid: u32) -> Option<Guard> {
            #[link(name = "kernel32")]
            extern "system" {
                fn OpenProcess(rights: u32, heritable: i32, id: u32) -> Handle;
            }

            // SAFETY: вызов без указателей; наследования дескриптора нет.
            Some(unsafe { OpenProcess(rights, 0, pid) })
                .filter(|&raw| raw != 0)
                .map(Guard)
        }

        fn image(&self) -> Option<String> {
            #[link(name = "kernel32")]
            extern "system" {
                fn QueryFullProcessImageNameW(
                    target: Handle,
                    flags: u32,
                    buffer: *mut u16,
                    chars: *mut u32,
                ) -> i32;
            }

            let mut buffer = [0u16; PATH_CHARS];
            let mut chars = PATH_CHARS as u32;
            // SAFETY: буфер живой, `chars` — его вместимость в символах.
            let ok =
                unsafe { QueryFullProcessImageNameW(self.0, 0, buffer.as_mut_ptr(), &mut chars) };
            (ok != 0).then(|| String::from_utf16_lossy(&buffer[..chars as usize]).to_lowercase())
        }

        fn squeeze(&self) -> Squeeze {
            #[link(name = "kernel32")]
            extern "system" {
                fn K32EmptyWorkingSet(target: Handle) -> i32;
            }

            // Поля считаются в порядке записи: «до», само сжатие, «после».
            Squeeze {
                before: Usage::working_set(self.0),
                // SAFETY: дескриптор открыт с правом `PROCESS_SET_QUOTA`.
                trimmed: unsafe { K32EmptyWorkingSet(self.0) } != 0,
                after: Usage::working_set(self.0),
            }
        }
    }

    impl Drop for Guard {
        fn drop(&mut self) {
            #[link(name = "kernel32")]
            extern "system" {
                fn CloseHandle(object: Handle) -> i32;
            }

            // SAFETY: дескриптор получен от системы и закрывается один раз.
            unsafe { CloseHandle(self.0) };
        }
    }

    /// Где обход снимка: первая запись уже в `row`, идём дальше или конец.
    enum Walk {
        Fresh,
        Going,
        Over,
    }

    /// Снимок процессов системы; обходится как итератор пар «процесс, родитель».
    struct Snapshot {
        list: Guard,
        row: Row,
        walk: Walk,
    }

    impl Snapshot {
        fn take() -> Option<Snapshot> {
            #[link(name = "kernel32")]
            extern "system" {
                fn CreateToolhelp32Snapshot(what: u32, id: u32) -> Handle;
                fn Process32FirstW(list: Handle, row: *mut Row) -> i32;
            }

            // SAFETY: вызов без указателей.
            let raw = unsafe { CreateToolhelp32Snapshot(PROCESS_SNAPSHOT, 0) };
            if raw == 0 || raw == -1 {
                return None;
            }
            let mut shot = Snapshot {
                list: Guard(raw),
                row: Row::blank(),
                walk: Walk::Over,
            };
            // SAFETY: запись живая на время обхода, в её первом слове размер.
            if unsafe { Process32FirstW(shot.list.0, &mut shot.row) } != 0 {
                shot.walk = Walk::Fresh;
            }
            Some(shot)
        }
    }

    impl Iterator for Snapshot {
        type Item = (u32, u32);

        fn next(&mut self) -> Option<(u32, u32)> {
            #[link(name = "kernel32")]
            extern "system" {
                fn Process32NextW(list: Handle, row: *mut Row) -> i32;
            }

            match self.walk {
                Walk::Over => return None,
                Walk::Going => {
                    // SAFETY: запись живая на время обхода, в её первом слове размер.
                    if unsafe { Process32NextW(self.list.0, &mut self.row) } == 0 {
                        self.walk = Walk::Over;
                        return None;
                    }
                }
                Walk::Fresh => self.walk = Walk::Going,
            }
            Some((self.row.head[2], self.row.middle[2]))
        }
    }

    pub struct System;

    impl Host for System {
        fn supported(&self) -> bool {
            true
        }

        fn own_pid(&self) -> u32 {
            #[link(name = "kernel32")]
            extern "system" {
                fn GetCurrentProcessId() -> u32;
            }

            // SAFETY: вызов без аргументов.
            unsafe { GetCurrentProcessId() }
        }

        fn process_table(&self) -> Option<Vec<(u32, u32)>> {
            Snapshot::take().map(Iterator::collect)
        }

        fn image_path(&self, pid: u32) -> Option<String> {
            Guard::open(QUERY_ONLY, pid)?.image()
        }

        fn squeeze(&self, pid: u32) -> Squeeze {
            Guard::open(TO_SQUEEZE_AND_READ, pid)
                .or_else(|| Guard::open(TO_SQUEEZE, pid))
                .map_or(Squeeze::UNREACHABLE, |process| process.squeeze())
        }
    }
}

#[cfg(not(windows))]
mod native {
    use super::{Host, Squeeze};

    pub struct System;

    impl Host for System {
        fn supported(&self) -> bool {
            false
        }

        fn own_pid(&self) -> u32 {
            std::process::id()
        }

        fn process_table(&self) -> Option<Vec<(u32, u32)>> {
            None
        }

        fn image_path(&self, _pid: u32) -> Option<String> {
            None
        }

        fn squeeze(&self, _pid: u32) -> Squeeze {
            Squeeze::UNREACHABLE
        }
    }
}

/// Родство процессов по снимку: у кого какие дети и какой исполняемый файл у Astral.
struct Family<'a> {
    me: u32,
    own: String,
    children: HashMap<u32, Vec<u32>>,
    path_of: &'a dyn Fn(u32) -> Option<String>,
}

impl Family<'_> {
    /// Дети процесса, у которых тот же исполняемый файл, что у Astral.
    fn ours_under<'s>(&'s self, pid: &u32) -> impl Iterator<Item = u32> + 's {
        let sons: &[u32] = self.children.get(pid).map_or(&[], Vec::as_slice);
        sons.iter()
            .copied()
            .filter(|&kid| (self.path_of)(kid).as_deref() == Some(self.own.as_str()))
    }

    /// Поколения от корня; каждый процесс входит один раз, движок и ноль не входят вовсе.
    fn descend(&self, root: u32) -> BTreeSet<u32> {
        let mut tree = BTreeSet::new();
        let mut admit = |wave: Vec<u32>| -> Vec<u32> {
            wave.into_iter()
                .filter(|&pid| pid != 0 && pid != self.me && tree.insert(pid))
                .collect()
        };
        let waves = std::iter::successors(Some(admit(vec![root])), |wave| {
            let next = admit(wave.iter().flat_map(|pid| self.ours_under(pid)).collect());
            (!next.is_empty()).then_some(next)
        });
        waves.for_each(drop);
        tree
    }
}

/// Дерево Astral по снимку: корень — родитель движка, дальше потомки с тем же
/// путём exe. Потомок с чужим exe в дерево не входит, а значит, не входят и
/// его потомки. Движка и нуля в дереве нет никогда.
fn astral_tree(
    me: u32,
    table: &[(u32, u32)],
    path_of: &dyn Fn(u32) -> Option<String>,
) -> BTreeSet<u32> {
    let known = table.iter().find(|&&(pid, _)| pid == me);
    let Some((root, own)) = known.and_then(|&(_, parent)| Some((parent, path_of(parent)?))) else {
        return BTreeSet::new();
    };
    let children = table.iter().fold(
        HashMap::<u32, Vec<u32>>::new(),
        |mut by_parent, &(pid, parent)| {
            by_parent.entry(parent).or_default().push(pid);
            by_parent
        },
    );
    Family {
        me,
        own,
        children,
        path_of,
    }
    .descend(root)
}

/// Дерево Astral на хосте; пусто, если спрашивать не о чем или снимка нет.
fn family_on(host: &dyn Host, needed: bool) -> BTreeSet<u32> {
    let table = needed.then(|| host.process_table()).flatten();
    table.map_or_else(BTreeSet::new, |rows| {
        astral_tree(host.own_pid(), &rows, &|pid| host.image_path(pid))
    })
}

/// Запись о процессе, которого в дереве нет: он не открывается.
fn foreign_entry(pid: u32) -> Value {
    object([
        ("pid", pid.into()),
        ("trimmed", false.into()),
        ("reason", "not-astral".into()),
    ])
}

fn answer(host: &dyn Host, named: &[u32], whole_tree: bool) -> Value {
    let tree = family_on(host, whole_tree || !named.is_empty());
    // Названные идут как есть, затем недостающие члены дерева по возрастанию.
    let mut order = named.to_vec();
    if whole_tree {
        order.extend(tree.iter().filter(|pid| !named.contains(pid)));
    }
    let processes = order
        .into_iter()
        .map(|pid| {
            tree.get(&pid)
                .map_or_else(|| foreign_entry(pid), |_| host.squeeze(pid).entry(pid))
        })
        .collect();
    object([
        ("supported", host.supported().into()),
        ("processes", Value::Array(processes)),
    ])
}

/// Разобранная командная строка: номера `--pid` по порядку и признак `--tree yes`.
struct Request {
    named: Vec<u32>,
    tree: bool,
}

impl TryFrom<&Options> for Request {
    type Error = EngineError;

    /// Номер — беззнаковое 32-битное целое после обрезки по краям; ошибка называет значение как есть.
    fn try_from(options: &Options) -> Result<Request> {
        let named = options
            .values("pid")
            .iter()
            .map(|raw| {
                raw.trim()
                    .parse()
                    .map_err(|_| EngineError::argument(format!("Invalid pid: {raw}")))
            })
            .collect::<Result<_>>()?;
        Ok(Request {
            named,
            tree: options.optional("tree") == Some("yes"),
        })
    }
}

fn trim_memory(options: &Options, _progress: &Progress) -> Result<Value> {
    Request::try_from(options).map(|Request { named, tree }| answer(&native::System, &named, tree))
}

const TRIM_MEMORY: Command = Command::new("trim-memory", trim_memory);

pub const COMMANDS: &[Command] = &[TRIM_MEMORY];

#[cfg(test)]
mod tests;
