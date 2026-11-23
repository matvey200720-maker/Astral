//! План по размерам: раскладка нового архива до первого байта тела.
//!
//! По списку записей с путями, размерами и хранимым видом (ресурс, двоичная запись
//! как есть или лежащая сжатой) считается всё, что зависит только от размеров:
//! таблица записей и блок имён, длина головы, место каждого тела, порядок записи
//! тел, длина файла. Тела не читаются и не готовятся: ни одна запись на диск не
//! идёт. План ложится тем же кодом, что `Layout::prepare` у записи готового дерева
//! (`Layout::assemble`), поэтому раскладка у двух путей одна и та же, пока равны
//! хранимые длины и виды записей.
//!
//! Слова RSC7 ресурса (`system`, `graphics`) в раскладку не входят: они лежат
//! только в записи оглавления. Их можно назвать заранее (публикация считает их по
//! первым 16 байтам ресурса) — тогда голова файла известна до записи тел; если
//! слов нет, оглавление собирается, когда тело пришло.

use std::collections::HashMap;

use super::{
    limit, tabulate, Layout, Meta, Node, Origin, Plan, EXTENDED_SIZE_FROM, TOO_BIG_TOC,
    TOO_MANY_NAMES,
};
use crate::{
    append::{AppendError, Code},
    error::RpfError,
    keys::KeySet,
    toc::BLOCK,
    tree::{Body, Compress, Data, DirNode},
};

/// Хранимый вид записи.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SizedKind {
    /// Ресурс RSC7. Слова (`system`, `graphics`) — из первых 16 байт ресурса;
    /// `None` — они станут известны, когда тело придёт.
    Resource { words: Option<(u32, u32)> },
    /// Двоичная запись. `None` — лежит как есть (длина записи = длина данных);
    /// `Some(n)` — лежит сжатой, `n` — длина распакованных данных.
    Binary { unpacked: Option<u32> },
}

/// Одна запись будущего архива.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SizedFile {
    /// Путь внутри архива с прямыми косыми, без начальной косой; звенья ASCII.
    pub path: String,
    pub kind: SizedKind,
    /// Сколько байт запись занимает в файле.
    pub len: u64,
}

/// Где тело лежит в файле.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Place {
    pub offset: u64,
    /// Длина тела.
    pub len: u64,
    /// Место с добивкой до границы блока.
    pub span: u64,
}

/// Раскладка нового архива по размерам.
pub struct SizedPlan {
    layout: Layout<'static>,
    files: Vec<SizedFile>,
    /// Номер файла по порядку таблицы для каждой входной записи.
    table_no: Vec<usize>,
    places: Vec<Place>,
    order: Vec<usize>,
}

fn refused(code: Code, text: impl Into<String>) -> AppendError {
    AppendError::refused(code, text)
}

fn argument(text: impl Into<String>) -> AppendError {
    AppendError::Other(RpfError::argument(text))
}

/// Звенья пути: непустые, без `.` и `..`, ASCII без управляющих знаков и без
/// обратной косой. Имя не из ASCII блок имён не передаст (`UnsupportedName`).
fn parts_of(path: &str) -> Result<Vec<&str>, AppendError> {
    if path.is_empty() {
        return Err(argument("An entry path is empty."));
    }
    let mut parts = Vec::new();
    for part in path.split('/') {
        if part.is_empty() || part == "." || part == ".." {
            return Err(argument(format!("The entry path {path:?} is not valid.")));
        }
        if !part.is_ascii() {
            return Err(refused(
                Code::UnsupportedName,
                format!("The entry path {path:?} is not ASCII."),
            ));
        }
        if part.bytes().any(|b| b < 0x20 || b == 0x7f || b == b'\\') {
            return Err(argument(format!("The entry path {path:?} is not valid.")));
        }
        parts.push(part);
    }
    Ok(parts)
}

fn plan_of(file: &SizedFile) -> Result<Plan<'static>, AppendError> {
    let len = file.len;
    if len > limit::ENTRY {
        return Err(refused(
            Code::EntryTooLarge,
            format!("{} is too large for an RPF7 entry.", file.path),
        ));
    }
    let meta_len = |meta: Meta, fix_head: bool| Plan {
        meta,
        len,
        origin: Origin::Pending,
        fix_head,
    };
    match file.kind {
        SizedKind::Resource { words } => {
            if len < limit::RESOURCE_HEADER as u64 {
                return Err(argument(format!(
                    "{}: the resource is shorter than its header.",
                    file.path
                )));
            }
            let (system, graphics) = words.unwrap_or((0, 0));
            let meta = Meta::Resource {
                stored: len.min(EXTENDED_SIZE_FROM) as u32,
                system,
                graphics,
            };
            Ok(meta_len(meta, len >= EXTENDED_SIZE_FROM))
        }
        SizedKind::Binary { unpacked: None } => Ok(meta_len(Meta::plain(len), false)),
        SizedKind::Binary { unpacked: Some(unc) } => {
            if len == 0 || len > limit::DEFLATED as u64 {
                return Err(argument(format!(
                    "{}: a packed entry is longer than 24 bits or empty.",
                    file.path
                )));
            }
            let meta = Meta::Binary {
                stored: len as u32,
                unc,
                encrypted: false,
            };
            Ok(meta_len(meta, false))
        }
    }
}

/// Дерево из путей: тела — пустышки, их никто не читает. Имена каталогов в одном
/// написании: два написания одного каталога (`A/x` и `a/y`) — отказ, архив не
/// пишет их одним каталогом молча.
fn tree_of(files: &[SizedFile]) -> Result<DirNode, AppendError> {
    let mut root = DirNode::new("");
    let blank = || Body::Binary {
        data: Data::memory(Vec::new()),
        compress: Compress::Store,
    };
    for file in files {
        let parts = parts_of(&file.path)?;
        let Some((leaf, folders)) = parts.split_last() else {
            return Err(argument("An entry path is empty."));
        };
        let mut dir = &mut root;
        for part in folders {
            dir = dir.ensure_dir(part).map_err(AppendError::from)?;
            if dir.name != *part {
                return Err(argument(format!(
                    "The directory {part:?} is written in two ways."
                )));
            }
        }
        let replaced = dir.put_file(leaf, blank()).map_err(AppendError::from)?;
        if replaced {
            return Err(argument(format!(
                "The entry {:?} is listed twice.",
                file.path
            )));
        }
    }
    Ok(root)
}

fn plan_failure(error: RpfError) -> AppendError {
    match error {
        RpfError::Format(text) if text == TOO_BIG_TOC => refused(
            Code::BodyStartTooHigh,
            "A body would start beyond the last block an entry can name.",
        ),
        RpfError::Format(text) if text == TOO_MANY_NAMES => refused(
            Code::NameOffsetTooHigh,
            "A file name would lie beyond the 16-bit name offset.",
        ),
        other => AppendError::from(other),
    }
}

/// Годится ли место для тела: запись по смещению `offset` от начала архива
/// (кратно 512) не нарушает пределов формата. Те же проверки, что у раздачи
/// мест в `SizedPlan::prepare` (длина записи, блок, который запись назвать
/// не может). Нужна сборке «следом», где места раздаются по мере прихода тел.
pub fn check_place(file: &SizedFile, offset: u64) -> Result<(), AppendError> {
    let plan = plan_of(file)?;
    let block = offset / BLOCK;
    if block > plan.block_ceiling() || plan.reads_as_directory_at(block) {
        return Err(plan_failure(RpfError::format(TOO_BIG_TOC)));
    }
    Ok(())
}

impl SizedPlan {
    /// Раскладка по списку записей. Отказ — до любой записи на диск: пути, имена
    /// не из ASCII (`UnsupportedName`), повтор пути, длина записи больше 4 ГиБ
    /// (`EntryTooLarge`), смещение имени за 16 бит (`NameOffsetTooHigh`), тело на
    /// блоке, который запись назвать не может (`BodyStartTooHigh`).
    pub fn prepare(files: Vec<SizedFile>) -> Result<SizedPlan, AppendError> {
        let root = tree_of(&files)?;
        let rows = tabulate(&root);

        // путь каждой строки таблицы: дети идут после родителя
        let mut paths = vec![String::new(); rows.len()];
        for at in 0..rows.len() {
            if let Node::Dir(_) = rows[at].node {
                for kid in rows[at].kids.clone() {
                    paths[kid] = if at == 0 {
                        rows[kid].node.name().to_owned()
                    } else {
                        format!("{}/{}", paths[at], rows[kid].node.name())
                    };
                }
            }
        }
        let mut by_path: HashMap<String, usize> = HashMap::with_capacity(files.len());
        for (at, file) in files.iter().enumerate() {
            by_path.insert(file.path.to_ascii_lowercase(), at);
        }

        let mut plans = Vec::with_capacity(files.len());
        let mut table_no = vec![usize::MAX; files.len()];
        for (at, row) in rows.iter().enumerate() {
            let Some(no) = row.file_no else { continue };
            let Some(&input) = by_path.get(&paths[at].to_ascii_lowercase()) else {
                return Err(argument("An entry of the plan was lost."));
            };
            plans.push(plan_of(&files[input])?);
            table_no[input] = no;
        }
        let layout = Layout::assemble(&rows, plans).map_err(plan_failure)?;

        let at_no = layout.body_places();
        let places: Vec<Place> = table_no
            .iter()
            .map(|&no| {
                let (offset, len) = at_no[no];
                Place {
                    offset,
                    len,
                    span: len.div_ceil(BLOCK) * BLOCK,
                }
            })
            .collect();
        let mut input_of = vec![0usize; files.len()];
        for (input, &no) in table_no.iter().enumerate() {
            input_of[no] = input;
        }
        let order = layout.write_order().iter().map(|&no| input_of[no]).collect();
        Ok(SizedPlan {
            layout,
            files,
            table_no,
            places,
            order,
        })
    }

    /// Записи, как их назвали (по входному порядку).
    pub fn files(&self) -> &[SizedFile] {
        &self.files
    }

    /// Длина готового файла, кратна 512.
    pub fn size(&self) -> u64 {
        self.layout.size()
    }

    /// Сколько байт с начала файла занимает голова вместе с добивкой до границы
    /// блока: тела начинаются с этого места.
    pub fn head_len(&self) -> u64 {
        self.layout.head_len()
    }

    /// Число записей оглавления: корень, каталоги и файлы.
    pub fn entries(&self) -> usize {
        self.layout.report().entries
    }

    /// Место тела входной записи.
    pub fn place(&self, input: usize) -> Place {
        self.places[input]
    }

    /// Входные записи в том порядке, в каком их тела ложатся в файл.
    pub fn order(&self) -> &[usize] {
        &self.order
    }

    /// Номер файла по порядку таблицы (для сверки с готовым архивом).
    pub fn table_no(&self, input: usize) -> usize {
        self.table_no[input]
    }

    /// Раскладка и таблица как у `Layout` (для сверки с записью по готовым файлам).
    pub fn layout(&self) -> &Layout<'static> {
        &self.layout
    }

    /// Голова файла без шифра: оглавление и нули до границы данных.
    pub fn plain_head(&self) -> Vec<u8> {
        self.layout.plain_head()
    }

    /// Все слова ресурсов названы: голова известна до записи тел.
    pub fn words_known(&self) -> bool {
        self.files.iter().all(|file| match file.kind {
            SizedKind::Resource { words } => words.is_some(),
            SizedKind::Binary { .. } => true,
        })
    }

    /// Голова файла после доводки NG: имя архива и длина файла выбирают ключ.
    /// Слова ресурсов должны быть названы (`words_known`).
    pub fn sealed_head(&self, name: &str, keys: &KeySet) -> Result<Vec<u8>, AppendError> {
        if !self.words_known() {
            return Err(argument("The words of a resource are not known yet."));
        }
        self.layout.sealed_head(name, keys).map_err(AppendError::from)
    }
}
