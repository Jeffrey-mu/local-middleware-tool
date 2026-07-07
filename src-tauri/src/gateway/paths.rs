use std::path::PathBuf;

pub fn data_dir() -> PathBuf {
    std::env::var("AIGATE_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join("data")
        })
}
