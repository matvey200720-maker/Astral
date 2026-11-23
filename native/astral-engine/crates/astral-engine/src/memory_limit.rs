//! Потолок выделенной памяти для процесса движка.
//!
//! Файлы, которые читает движок, ему не принадлежат: повреждённый или
//! раздутый архив способен затребовать гигабайты. В начале работы процесс
//! переводит себя в задание Windows (Job Object) с ограничением committed
//! памяти на один процесс; сверх него система отказывает. На остальных
//! системах модуль ничего не делает.

use std::env;

/// Переменная окружения с потолком в МиБ; `0` потолок отключает.
pub const LIMIT_ENV: &str = "ASTRAL_ENGINE_MEMORY_LIMIT_MB";

const MIB: u64 = 1_048_576;
const DEFAULT_FLOOR: u64 = 2_048 * MIB;
const DEFAULT_CEILING: u64 = 6_144 * MIB;

/// 40 % физической памяти, но не меньше 2 и не больше 6 ГиБ.
/// Сначала деление на 10, потом умножение на 4: переполнения нет даже при `u64::MAX`.
pub fn default_limit(physical: u64) -> u64 {
    let forty_percent = physical / 10 * 4;
    forty_percent.clamp(DEFAULT_FLOOR, DEFAULT_CEILING)
}

/// Потолок в байтах по тексту переменной. `None` - переменной нет или в ней
/// не число; `Some(0)` - потолок не нужен. Слишком большое число упирается
/// в `u64::MAX`.
pub fn limit_from_env(value: Option<&str>) -> Option<u64> {
    let megabytes = value.and_then(|text| text.trim().parse::<u64>().ok())?;
    Some(megabytes.saturating_mul(MIB))
}

/// Назначает потолок текущему процессу; задание нельзя снять, поэтому вызывать
/// один раз, до рабочих потоков. `None`: не Windows, потолок отключён нулём
/// или система отказала. Ошибки молчат.
pub fn apply() -> Option<u64> {
    let configured = limit_from_env(env::var(LIMIT_ENV).ok().as_deref());
    if configured == Some(0) {
        return None;
    }
    let limit = configured.or_else(|| physical_memory().map(default_limit))?;
    cap_process_memory(limit).then_some(limit)
}

/// Физическая память машины в байтах; сбой и ноль - `None`.
#[cfg(windows)]
#[allow(unsafe_code)]
fn physical_memory() -> Option<u64> {
    let mut status = ffi::MemStatus {
        length: std::mem::size_of::<ffi::MemStatus>() as u32,
        ..ffi::MemStatus::default()
    };
    // SAFETY: указатель на живую структуру, поле длины заполнено.
    let answered = unsafe { ffi::GlobalMemoryStatusEx(&mut status) } != 0;
    let total = status.counters[0];
    if answered && total != 0 {
        Some(total)
    } else {
        None
    }
}

/// Кладёт текущий процесс в новое безымянное задание с потолком `limit` байт.
#[cfg(windows)]
fn cap_process_memory(limit: u64) -> bool {
    let Some(job) = Job::create() else {
        return false;
    };
    if job.set_memory_cap(limit) && job.take_current_process() {
        // Дескриптор остаётся открытым: задание живёт до конца процесса.
        return true;
    }
    job.discard();
    false
}

#[cfg(not(windows))]
fn physical_memory() -> Option<u64> {
    None
}

#[cfg(not(windows))]
fn cap_process_memory(_limit: u64) -> bool {
    false
}

/// Дескриптор задания Windows.
#[cfg(windows)]
struct Job(isize);

#[cfg(windows)]
#[allow(unsafe_code)]
impl Job {
    fn create() -> Option<Job> {
        // SAFETY: без атрибутов безопасности и без имени.
        let handle = unsafe { ffi::CreateJobObjectW(std::ptr::null_mut(), std::ptr::null()) };
        (handle != 0).then_some(Job(handle))
    }

    /// Ограничение committed памяти одного процесса задания.
    fn set_memory_cap(&self, bytes: u64) -> bool {
        let mut info = ffi::JobLimitsEx::default();
        info.core.flags = ffi::LIMIT_PROCESS_MEMORY;
        info.process_memory = usize::try_from(bytes).unwrap_or(usize::MAX);
        // SAFETY: структура живая, передаётся её настоящий размер.
        let done = unsafe {
            ffi::SetInformationJobObject(
                self.0,
                ffi::EXTENDED_LIMITS_CLASS,
                (&mut info as *mut ffi::JobLimitsEx).cast(),
                std::mem::size_of::<ffi::JobLimitsEx>() as u32,
            )
        };
        done != 0
    }

    fn take_current_process(&self) -> bool {
        // SAFETY: псевдодескриптор текущего процесса закрывать не нужно.
        unsafe { ffi::AssignProcessToJobObject(self.0, ffi::GetCurrentProcess()) != 0 }
    }

    /// Закрывает дескриптор после неудачной настройки; результат не проверяется.
    fn discard(self) {
        // SAFETY: дескриптор создан в `create` и больше не используется.
        unsafe {
            ffi::CloseHandle(self.0);
        }
    }
}

/// Объявления kernel32 и раскладка структур Windows (x64).
#[cfg(windows)]
mod ffi {
    use std::ffi::c_void;

    /// `JobObjectExtendedLimitInformation`.
    pub const EXTENDED_LIMITS_CLASS: i32 = 9;
    /// `JOB_OBJECT_LIMIT_PROCESS_MEMORY`.
    pub const LIMIT_PROCESS_MEMORY: u32 = 0x0000_0100;

    /// `JOBOBJECT_BASIC_LIMIT_INFORMATION`.
    #[repr(C)]
    #[derive(Default)]
    pub struct CoreLimits {
        pub user_time_per_process: i64,
        pub user_time_per_job: i64,
        pub flags: u32,
        pub working_set_min: usize,
        pub working_set_max: usize,
        pub process_count: u32,
        pub affinity: usize,
        pub priority: u32,
        pub scheduling: u32,
    }

    /// `JOBOBJECT_EXTENDED_LIMIT_INFORMATION`: на x64 144 байта.
    #[repr(C)]
    #[derive(Default)]
    pub struct JobLimitsEx {
        pub core: CoreLimits,
        /// `IO_COUNTERS`: шесть счётчиков по 8 байт.
        pub io: [u64; 6],
        pub process_memory: usize,
        pub job_memory: usize,
        pub peak_process_memory: usize,
        pub peak_job_memory: usize,
    }

    /// `MEMORYSTATUSEX`: 64 байта. В `counters` первым идёт `ullTotalPhys`.
    #[repr(C)]
    #[derive(Default)]
    pub struct MemStatus {
        pub length: u32,
        pub load_percent: u32,
        pub counters: [u64; 7],
    }

    #[cfg(target_pointer_width = "64")]
    const _: () = assert!(
        std::mem::size_of::<JobLimitsEx>() == 144 && std::mem::size_of::<MemStatus>() == 64
    );

    #[link(name = "kernel32")]
    extern "system" {
        pub fn CreateJobObjectW(attributes: *mut c_void, name: *const u16) -> isize;
        pub fn SetInformationJobObject(
            job: isize,
            class: i32,
            information: *mut c_void,
            length: u32,
        ) -> i32;
        pub fn AssignProcessToJobObject(job: isize, process: isize) -> i32;
        pub fn GetCurrentProcess() -> isize;
        pub fn CloseHandle(handle: isize) -> i32;
        pub fn GlobalMemoryStatusEx(status: *mut MemStatus) -> i32;
    }
}
