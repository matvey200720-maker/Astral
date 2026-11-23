// Корень крейта rage-rpf: чтение и запись архивов RPF7.
// Часть имён выводится сюда; остальное доступно только по пути модуля.

pub mod activity;
pub mod append;
pub mod archive;
pub mod describe;
pub mod digest;
pub mod dlc;
pub mod error;
#[doc(hidden)]
pub mod fixtures;
pub mod journal;
pub mod keys;
pub mod layers;
mod ng_inverse;
pub mod seal;
pub mod read_pace;
pub mod source;
pub mod tail;
pub mod tally;
#[doc(hidden)]
pub mod test_keys;
pub mod toc;
pub mod tree;
pub mod write;

pub use archive::{Archive, BinaryInfo, Entry, EntryCipher, EntryId, EntryKind, ResourceInfo};
pub use error::{Result, RpfError};
pub use keys::KeySet;
pub use source::{ByteSource, FileSource, MemSource, OverlaySource, SliceSource};
pub use toc::Encryption;
pub use tree::{Body, Compress, Data, DirNode, FileNode};
pub use digest::{absorb_range, FileDigest, Watermark};
pub use write::{
    extended_size_bytes, write_archive, write_archive_with, Finalizer, Handled, Layout, NestedMode,
    TrialRun, WriteContext, WriteReport, EXTENDED_SIZE_FROM,
};
