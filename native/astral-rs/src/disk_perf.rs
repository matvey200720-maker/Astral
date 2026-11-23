//! Занятость физического диска (20.11.2026, регулятор диска, `packages/install-engine/disk-governor.js`).
//!
//! Слово владельца: «диск не должен долбиться в сотку, он должен ограничиваться на 50 %». Чтобы держать занятость, её надо видеть. «Активное время» Диспетчера задач — это
//! 100 минус доля времени, когда у диска не было ни одного запроса: драйвер диска ведёт для неё накопительные счётчики, и читает их `IOCTL_DISK_PERFORMANCE` (тот же вызов,
//! откуда берут свои числа PDH и `psutil`). Права записи и администратора не нужны: том и диск открываются с нулевым доступом, как в `psutil.disk_io_counters`.
//!
//! Функция отдаёт сырые накопительные счётчики; разность двух отсчётов и проценты считает JS (`disk-sensor.js: createNativeSensor`). Один отсчёт — два системных вызова,
//! микросекунды: датчик не заводит процессов и не нагружает диск сам. Сверка: на одном окне `IOCTL` и PDH дали занятость 4,1 % и 4,8 %, отклик 0,29 и 0,22 мс, структура —
//! 88 байт (проверено прототипом на этом же ПК).
//!
//! JS зовёт `diskPerformance("C")` через `@modovik/native-rs`; нет модуля, старый модуль без функции, отказ системы — `null`, регулятор берёт запасной датчик.

use napi_derive::napi;

/// Накопительные счётчики физического диска, на котором лежит том. Время — в единицах по 100 нс, как у Windows; числа `f64`: на секундных окнах разностей точности хватает
/// (часы Windows — 1,3e17 с шагом 16 единиц).
#[napi(object)]
pub struct DiskPerformance {
    /// Номер физического диска (`\\.\PhysicalDriveN`).
    pub device: u32,
    /// Накопленное время простоя диска.
    pub idle_time: f64,
    /// Часы драйвера на момент отсчёта; прирост — длина окна.
    pub query_time: f64,
    /// Накопленное время запросов на чтение и на запись (запросы считаются каждый свои, при очереди сумма больше окна).
    pub read_time: f64,
    pub write_time: f64,
    pub read_count: f64,
    pub write_count: f64,
    /// Запросов в очереди прямо сейчас.
    pub queue_depth: u32,
    pub bytes_read: f64,
    pub bytes_written: f64,
}

/// Буква тома — одна латинская, без двоеточия. Всё остальное — не том.
fn letter_of(volume: &str) -> Option<char> {
    let mut chars = volume.trim().trim_end_matches(':').chars();
    let letter = chars.next()?;
    (chars.next().is_none() && letter.is_ascii_alphabetic()).then(|| letter.to_ascii_uppercase())
}

#[cfg(windows)]
mod system {
    use super::DiskPerformance;
    use std::ffi::c_void;

    type Handle = *mut c_void;

    const FILE_SHARE_READ: u32 = 1;
    const FILE_SHARE_WRITE: u32 = 2;
    const OPEN_EXISTING: u32 = 3;
    const INVALID_HANDLE: isize = -1;
    /// `IOCTL_STORAGE_GET_DEVICE_NUMBER`.
    const IOCTL_STORAGE_GET_DEVICE_NUMBER: u32 = 0x002D_1080;
    /// `IOCTL_DISK_PERFORMANCE`.
    const IOCTL_DISK_PERFORMANCE: u32 = 0x0007_0020;

    /// `STORAGE_DEVICE_NUMBER`.
    #[repr(C)]
    #[derive(Default)]
    struct StorageDeviceNumber {
        device_type: u32,
        device_number: u32,
        partition_number: u32,
    }

    /// `DISK_PERFORMANCE`: 88 байт; Rust выравнивает хвост так же, как Windows (по 8).
    #[repr(C)]
    #[derive(Default)]
    pub(super) struct RawDiskPerformance {
        bytes_read: i64,
        bytes_written: i64,
        read_time: i64,
        write_time: i64,
        idle_time: i64,
        read_count: u32,
        write_count: u32,
        queue_depth: u32,
        split_count: u32,
        query_time: i64,
        storage_device_number: u32,
        storage_manager_name: [u16; 8],
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateFileW(name: *const u16, access: u32, share: u32, security: *const c_void, disposition: u32, flags: u32, template: Handle) -> Handle;
        fn DeviceIoControl(handle: Handle, code: u32, input: *const c_void, input_len: u32, output: *mut c_void, output_len: u32, returned: *mut u32, overlapped: *mut c_void) -> i32;
        fn CloseHandle(handle: Handle) -> i32;
    }

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Открывает устройство с нулевым доступом (достаточно для `DeviceIoControl` с запросом сведений); `None` — не открылось.
    fn open(path: &str) -> Option<Handle> {
        let name = wide(path);
        // SAFETY: имя — строка с нулём на конце, остальные аргументы — числа и пустые указатели.
        let handle = unsafe { CreateFileW(name.as_ptr(), 0, FILE_SHARE_READ | FILE_SHARE_WRITE, std::ptr::null(), OPEN_EXISTING, 0, std::ptr::null_mut()) };
        (handle as isize != INVALID_HANDLE && !handle.is_null()).then_some(handle)
    }

    /// Открывает устройство, зовёт `work`, закрывает описатель ровно один раз.
    fn with_device<T>(path: &str, work: impl FnOnce(Handle) -> Option<T>) -> Option<T> {
        let handle = open(path)?;
        let answer = work(handle);
        // SAFETY: описатель получен выше, не пуст и закрывается один раз.
        unsafe { CloseHandle(handle) };
        answer
    }

    fn query<T: Default>(handle: Handle, code: u32) -> Option<T> {
        let mut out = T::default();
        let mut returned = 0u32;
        // SAFETY: `out` — живое значение этого кадра нужной длины; входа нет.
        let ok = unsafe { DeviceIoControl(handle, code, std::ptr::null(), 0, (&mut out as *mut T).cast(), std::mem::size_of::<T>() as u32, &mut returned, std::ptr::null_mut()) };
        (ok != 0).then_some(out)
    }

    /// Номер физического диска, на котором лежит том `letter`.
    pub fn disk_of(letter: char) -> Option<u32> {
        with_device(&format!("\\\\.\\{letter}:"), |handle| query::<StorageDeviceNumber>(handle, IOCTL_STORAGE_GET_DEVICE_NUMBER).map(|number| number.device_number))
    }

    pub fn performance(letter: char) -> Option<DiskPerformance> {
        let device = disk_of(letter)?;
        let raw = with_device(&format!("\\\\.\\PhysicalDrive{device}"), |handle| query::<RawDiskPerformance>(handle, IOCTL_DISK_PERFORMANCE))?;
        Some(DiskPerformance {
            device,
            idle_time: raw.idle_time as f64,
            query_time: raw.query_time as f64,
            read_time: raw.read_time as f64,
            write_time: raw.write_time as f64,
            read_count: f64::from(raw.read_count),
            write_count: f64::from(raw.write_count),
            queue_depth: raw.queue_depth,
            bytes_read: raw.bytes_read as f64,
            bytes_written: raw.bytes_written as f64,
        })
    }

    #[cfg(test)]
    pub fn raw_size() -> usize {
        std::mem::size_of::<RawDiskPerformance>()
    }
}

#[cfg(not(windows))]
mod system {
    use super::DiskPerformance;

    pub fn performance(_letter: char) -> Option<DiskPerformance> {
        None
    }
}

/// Накопительные счётчики физического диска тома `volume` («C» или «C:») или `null`: не Windows, не том, диск не открылся, система отказала. Исключений нет.
#[napi]
pub fn disk_performance(volume: String) -> Option<DiskPerformance> {
    system::performance(letter_of(&volume)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn letter_is_one_latin_letter_with_or_without_colon() {
        assert_eq!(letter_of("c"), Some('C'));
        assert_eq!(letter_of("D:"), Some('D'));
        assert_eq!(letter_of(" e: "), Some('E'));
        for bad in ["", ":", "CC", "C:\\", "1", "я", "\\\\.\\C:"] {
            assert_eq!(letter_of(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn not_a_volume_answers_null_without_touching_the_system() {
        assert!(disk_performance("не том".to_string()).is_none());
        assert!(disk_performance(String::new()).is_none());
    }

    #[cfg(windows)]
    #[test]
    fn raw_structure_is_the_size_windows_expects() {
        // `DISK_PERFORMANCE` — 88 байт (проверено прототипом: 80 давало ERROR_INSUFFICIENT_BUFFER).
        assert_eq!(system::raw_size(), 88);
    }

    #[cfg(windows)]
    #[test]
    fn system_volume_reports_a_clock_that_moves() {
        let letter = std::env::var("SystemDrive").ok().and_then(|drive| letter_of(&drive)).unwrap_or('C');
        let first = system::performance(letter).expect("диск системного тома открывается без прав администратора");
        std::thread::sleep(std::time::Duration::from_millis(50));
        let second = system::performance(letter).expect("второй отсчёт");
        assert!(second.query_time > first.query_time, "часы драйвера идут вперёд");
        assert!(second.idle_time >= first.idle_time, "простой накопительный");
        assert_eq!(first.device, second.device);
    }
}
