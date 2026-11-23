//! Приоритет ввода-вывода чужого процесса (18.11.2026).
//!
//! Жалоба владельца: при установке диск занят под 100 % и компьютер лагает.
//! Движок уводит в фон только свои потоки записи архивов (`disk.rs`,
//! `THREAD_MODE_BACKGROUND_BEGIN`); у остального — чтения движка, процессов
//! сборки наборов на JS — приоритет ввода-вывода обычный, и их чтения и
//! записи стоят в одной очереди с игрой и браузером.
//!
//! Из Node этого не поправить: `os.setPriority` меняет класс приоритета
//! процесса, а приоритет ввода-вывода от класса «ниже обычного» не меняется
//! (опыт на ПК владельца 18.11: остаётся 2, «обычный»). Его ставит
//! `NtSetInformationProcess(ProcessIoPriority)` — родителю для своего
//! дочернего процесса права администратора не нужны.
//!
//! Копии и загрузки главного процесса так не достать: ступень процесса задела
//! бы и окно, а асинхронный ввод-вывод Node идёт в общем пуле потоков, так что
//! и ступень потока не годится. Для них ступень ставится самому открытому
//! файлу (`FileIoPriorityHintInformation`): её получают чтения и записи через
//! этот описатель, в каком бы потоке они ни шли.
//!
//! JS зовёт функции через `@modovik/native-rs`; нет модуля, старый модуль без
//! них, отказ системы — ответ «не сменился», установка идёт как шла.

use napi_derive::napi;

/// Старшая ступень, которую можно поставить: 0 — «очень низкий» (фоновый
/// ввод-вывод Windows), 1 — «низкий», 2 — «обычный». Выше обычного отсюда не
/// ставится: фоновой работе это незачем.
const HIGHEST_LEVEL: u32 = 2;

#[cfg(windows)]
mod system {
    use std::ffi::c_void;

    type Handle = *mut c_void;

    const PROCESS_SET_INFORMATION: u32 = 0x0200;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    /// `ProcessIoPriority` из `PROCESSINFOCLASS`; значение — `IO_PRIORITY_HINT`, одно слово.
    const PROCESS_IO_PRIORITY: u32 = 33;
    const HINT_BYTES: u32 = 4;

    /// `FileIoPriorityHintInformation` из `FILE_INFORMATION_CLASS`.
    const FILE_IO_PRIORITY_HINT: u32 = 43;
    const INVALID_HANDLE: isize = -1;

    /// `FILE_IO_PRIORITY_HINT_INFORMATION`: одно слово, но ядро требует выравнивания по восьми байтам.
    #[repr(C, align(8))]
    struct FileHint {
        level: u32,
    }

    /// `IO_STATUS_BLOCK`: статус и число байт.
    #[repr(C)]
    struct IoStatus {
        status: isize,
        information: usize,
    }

    /// `uv_get_osfhandle` из libuv: номер файла Node → описатель Windows.
    type OsHandleOf = unsafe extern "C" fn(fd: i32) -> isize;

    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
        fn CloseHandle(handle: Handle) -> i32;
        fn GetModuleHandleW(name: *const u16) -> Handle;
        fn GetProcAddress(module: Handle, name: *const u8) -> *const c_void;
    }

    #[link(name = "ntdll")]
    extern "system" {
        fn NtSetInformationProcess(process: Handle, class: u32, info: *const c_void, length: u32) -> i32;
        fn NtQueryInformationProcess(process: Handle, class: u32, info: *mut c_void, length: u32, returned: *mut u32) -> i32;
        fn NtSetInformationFile(file: Handle, status: *mut IoStatus, info: *const c_void, length: u32, class: u32) -> i32;
        fn NtQueryInformationFile(file: Handle, status: *mut IoStatus, info: *mut c_void, length: u32, class: u32) -> i32;
    }

    /// Номера файлов у Node свои (таблица libuv внутри его программы), поэтому переводит их сам libuv. Его функцию
    /// модуль ищет в программе, которая его загрузила (`node.exe`, `electron.exe`), один раз. Нет функции — ступень
    /// файлу не ставится.
    fn os_handle_of() -> Option<OsHandleOf> {
        static FOUND: std::sync::OnceLock<Option<OsHandleOf>> = std::sync::OnceLock::new();
        *FOUND.get_or_init(|| {
            // SAFETY: пустое имя — модуль самой программы; имя функции — строка с нулём на конце.
            let address = unsafe { GetProcAddress(GetModuleHandleW(std::ptr::null()), c"uv_get_osfhandle".as_ptr().cast()) };
            // SAFETY: адрес не пуст и это функция libuv с такой подписью (`uv_os_fd_t uv_get_osfhandle(int)`).
            (!address.is_null()).then(|| unsafe { std::mem::transmute::<*const c_void, OsHandleOf>(address) })
        })
    }

    /// Описатель Windows открытого файла Node; `None` — номер не открыт или libuv не найден.
    fn file_handle(fd: i32) -> Option<Handle> {
        // SAFETY: libuv сам проверяет номер и на чужой отвечает пустым описателем.
        let handle = unsafe { os_handle_of()?(fd) };
        (handle != INVALID_HANDLE && handle != 0).then_some(handle as Handle)
    }

    pub fn set_file(fd: i32, level: u32) -> bool {
        let Some(handle) = file_handle(fd) else { return false };
        let hint = FileHint { level };
        let mut status = IoStatus { status: 0, information: 0 };
        // SAFETY: оба указателя — на живые значения этого кадра, длина равна размеру записи.
        succeeded(unsafe { NtSetInformationFile(handle, &mut status, (&hint as *const FileHint).cast(), std::mem::size_of::<FileHint>() as u32, FILE_IO_PRIORITY_HINT) })
    }

    pub fn get_file(fd: i32) -> Option<u32> {
        let handle = file_handle(fd)?;
        let mut hint = FileHint { level: 0 };
        let mut status = IoStatus { status: 0, information: 0 };
        // SAFETY: оба указателя — на живые значения этого кадра, длина равна размеру записи.
        let answer = unsafe { NtQueryInformationFile(handle, &mut status, (&mut hint as *mut FileHint).cast(), std::mem::size_of::<FileHint>() as u32, FILE_IO_PRIORITY_HINT) };
        succeeded(answer).then_some(hint.level)
    }

    /// Открывает процесс с правом `access`, зовёт `work` и закрывает описатель.
    /// `None` — процесс не открылся: его уже нет или права не хватает.
    fn with_process<T>(pid: u32, access: u32, work: impl FnOnce(Handle) -> T) -> Option<T> {
        // SAFETY: OpenProcess берёт только числа; пустой описатель проверяется ниже.
        let handle = unsafe { OpenProcess(access, 0, pid) };
        if handle.is_null() {
            return None;
        }
        let answer = work(handle);
        // SAFETY: описатель получен выше, не пуст и закрывается ровно один раз.
        unsafe { CloseHandle(handle) };
        Some(answer)
    }

    /// Статусы NT: отрицательное значение — отказ.
    fn succeeded(status: i32) -> bool {
        status >= 0
    }

    pub fn set(pid: u32, level: u32) -> bool {
        with_process(pid, PROCESS_SET_INFORMATION, |handle| {
            // SAFETY: `level` живёт до конца вызова, длина равна размеру слова.
            succeeded(unsafe { NtSetInformationProcess(handle, PROCESS_IO_PRIORITY, (&level as *const u32).cast(), HINT_BYTES) })
        })
        .unwrap_or(false)
    }

    pub fn get(pid: u32) -> Option<u32> {
        with_process(pid, PROCESS_QUERY_LIMITED_INFORMATION, |handle| {
            let mut level = 0u32;
            let mut returned = 0u32;
            // SAFETY: оба указателя — на живые слова этого кадра, длина равна размеру слова.
            let status = unsafe { NtQueryInformationProcess(handle, PROCESS_IO_PRIORITY, (&mut level as *mut u32).cast(), HINT_BYTES, &mut returned) };
            succeeded(status).then_some(level)
        })
        .flatten()
    }
}

#[cfg(not(windows))]
mod system {
    pub fn set(_pid: u32, _level: u32) -> bool {
        false
    }

    pub fn get(_pid: u32) -> Option<u32> {
        None
    }

    pub fn set_file(_fd: i32, _level: u32) -> bool {
        false
    }

    pub fn get_file(_fd: i32) -> Option<u32> {
        None
    }
}

/// Ставит процессу `pid` приоритет ввода-вывода `level` (0, 1 или 2 — см.
/// `HIGHEST_LEVEL`). `true` — сменился; `false` — ступень не из списка,
/// процесса нет, права не хватило или система отказала. Исключений нет.
#[napi]
pub fn set_process_io_priority(pid: u32, level: u32) -> bool {
    pid != 0 && level <= HIGHEST_LEVEL && system::set(pid, level)
}

/// Приоритет ввода-вывода процесса `pid` (0…4, как его называет Windows) или
/// `null`, если процесс не открылся или система не ответила.
#[napi]
pub fn process_io_priority(pid: u32) -> Option<u32> {
    if pid == 0 {
        return None;
    }
    system::get(pid)
}

/// Ставит открытому файлу с номером `fd` (как его знает Node) ступень
/// ввода-вывода `level` (0, 1 или 2). `true` — сменилась; `false` — ступень не
/// из списка, файл не открыт или система отказала. Действует на чтения и записи
/// через этот описатель в любом потоке; другие файлы процесса не задевает.
#[napi]
pub fn set_file_io_priority(fd: i32, level: u32) -> bool {
    fd >= 0 && level <= HIGHEST_LEVEL && system::set_file(fd, level)
}

/// Ступень ввода-вывода открытого файла с номером `fd` или `null`.
#[napi]
pub fn file_io_priority(fd: i32) -> Option<u32> {
    if fd < 0 {
        return None;
    }
    system::get_file(fd)
}
