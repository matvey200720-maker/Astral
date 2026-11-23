//! Проверка свободного места перед установкой мода.
//!
//! Для каждого тома нужно столько байт, сколько весят архивы, которые на него
//! лягут, плюс запас. Точка отката на томе игры ничего не добавляет: это
//! ссылка на тот же архив. Проверка идёт заранее, до первой копии.

use crate::error::{EngineError, Result};
use std::{io, path::Path};

/// Итоги, которыми отвечают функции модуля: те же `Result`, только покороче в подписях.
type Checked = Result<()>;
type Volume = Result<u64>;
type Anchor<'a> = Result<&'a Path>;
type Raw = io::Result<u64>;

/// Блоки, доступные непривилегированному пользователю, на размер фрагмента.
/// NUL внутри имени - `InvalidInput` ещё до вызова.
#[cfg(unix)]
#[allow(unsafe_code, clippy::unnecessary_cast)]
fn volume_available_bytes(path: &Path) -> Raw {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};

    let bytes = path.as_os_str().as_bytes();
    let name = CString::new(bytes)?;
    // SAFETY: `statvfs` - набор чисел, нулевое значение допустимо.
    let mut stats = unsafe { std::mem::zeroed::<libc::statvfs>() };
    let probe = name.as_ptr();
    // SAFETY: имя оканчивается нулём, структура живая.
    let status = unsafe { libc::statvfs(probe, &mut stats) };
    (status == 0)
        .then(|| stats.f_bavail as u64 * stats.f_frsize as u64)
        .ok_or_else(io::Error::last_os_error)
}

/// Первый выход `GetDiskFreeSpaceExW` - свободно вызывающему, с учётом квот.
/// Имя передаётся как есть: без `\\?\` и без правки длины.
#[cfg(windows)]
#[allow(unsafe_code)]
fn volume_available_bytes(path: &Path) -> Raw {
    use std::os::windows::ffi::OsStrExt;

    let name: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut caller_free = 0u64;
    let first = name.as_ptr();
    // SAFETY: имя оканчивается нулём и живёт до конца вызова; первый выход
    // указывает на живую переменную, остальные не нужны.
    let status = unsafe {
        windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(
            first,
            &mut caller_free,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    (status != 0)
        .then_some(caller_free)
        .ok_or_else(io::Error::last_os_error)
}

const BYTES_PER_MIB: u64 = 1_048_576;

/// Запас на журнал, опись точки отката и служебные файлы очереди.
pub const MARGIN_BYTES: u64 = 256 << 20;

/// Сумма размеров плюс запас. Запас насыщается, сама сумма нет: при
/// переполнении `u64` отладочная сборка паникует, сборка без проверок
/// оборачивается.
pub fn required_bytes(sizes: &[u64]) -> u64 {
    let mut total = 0u64;
    for size in sizes {
        total += size;
    }
    MARGIN_BYTES.saturating_add(total)
}

/// `Ok`, если свободно не меньше нужного. В отказе путь печатается как передан;
/// нужное округляется в МиБ вверх, свободное вниз, а недостающее называется
/// разностью этих чисел (при нехватке хоть на байт это не меньше 1 МиБ).
pub fn check_space(path: &Path, free: u64, need: u64) -> Checked {
    match free.checked_sub(need) {
        Some(_) => Ok(()),
        None => {
            let need_mib = need.div_ceil(BYTES_PER_MIB);
            let free_mib = free / BYTES_PER_MIB;
            let short_mib = need_mib - free_mib;
            let shown = path.display();
            Err(EngineError::invalid_operation(format!(
                "Not enough disk space on {shown}: need {need_mib} MiB, free {free_mib} MiB (short by {short_mib} MiB). Free some space and try again."
            )))
        }
    }
}

/// Сам путь, если он существует (файл тоже), иначе первый существующий родитель
/// по `Path::parent`. Недоступное считается несуществующим.
pub fn existing_ancestor(path: &Path) -> Anchor<'_> {
    match path.ancestors().find(|candidate| candidate.exists()) {
        Some(found) => Ok(found),
        None => Err(EngineError::file_not_found(format!(
            "No existing folder above {}",
            path.display()
        ))),
    }
}

/// Свободные байты для обычного пользователя на томе пути; если пути нет, на
/// томе ближайшего существующего родителя. Годится только каталог.
pub fn free_bytes(path: &Path) -> Volume {
    let anchor = existing_ancestor(path)?;
    Ok(volume_available_bytes(anchor)?)
}
