use std::ffi::{CStr, CString};
use std::io::ErrorKind;
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::ipc::types::{AppError, DiskOverview, FdaStatus};

/// macOS System Settings deep link to Full Disk Access privacy preferences.
pub const FDA_SETTINGS_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

/// Non-blocking TCC probe for macOS Full Disk Access.
///
/// Probes `~/Library/Safari` first and falls back to `~/Library/Mail` if
/// `Safari` does not exist on the machine.
pub fn probe_full_disk_access() -> FdaStatus {
    let Some(home) = dirs::home_dir() else {
        return FdaStatus {
            granted: false,
            probed_path: "~/Library/Safari".to_string(),
            settings_url: FDA_SETTINGS_URL.to_string(),
        };
    };

    let safari = home.join("Library/Safari");
    match std::fs::read_dir(&safari) {
        Ok(_) => FdaStatus {
            granted: true,
            probed_path: safari.to_string_lossy().into_owned(),
            settings_url: FDA_SETTINGS_URL.to_string(),
        },
        Err(err) if err.kind() == ErrorKind::PermissionDenied => FdaStatus {
            granted: false,
            probed_path: safari.to_string_lossy().into_owned(),
            settings_url: FDA_SETTINGS_URL.to_string(),
        },
        Err(err) if err.kind() == ErrorKind::NotFound => {
            let mail = home.join("Library/Mail");
            let granted = std::fs::read_dir(&mail).is_ok();
            FdaStatus {
                granted,
                probed_path: mail.to_string_lossy().into_owned(),
                settings_url: FDA_SETTINGS_URL.to_string(),
            }
        }
        Err(_) => FdaStatus {
            granted: false,
            probed_path: safari.to_string_lossy().into_owned(),
            settings_url: FDA_SETTINGS_URL.to_string(),
        },
    }
}

/// Open macOS System Settings directly to the Full Disk Access pane.
pub fn open_fda_settings() -> Result<(), AppError> {
    let status = Command::new("/usr/bin/open")
        .arg(FDA_SETTINGS_URL)
        .status()
        .map_err(|err| AppError::Internal(format!("Failed to launch System Settings: {err}")))?;

    if status.success() {
        Ok(())
    } else {
        Err(AppError::Internal(format!(
            "/usr/bin/open exited with status: {status}"
        )))
    }
}

/// Determine whether `path` should be skipped during a scan rooted at `scan_root`.
///
/// Enforces macOS APFS firmlink and virtual mount safety:
/// - Always skips `/dev`, `/net`, `/home`, `/.vol`.
/// - Skips `/System/Volumes/Data` unless `scan_root` explicitly targets inside `/System/Volumes/Data`.
/// - Skips `/Volumes` when scanning `/` (or any root outside `/Volumes`), while allowing
///   explicit scans targeting `/Volumes/<volume>`.
pub fn should_skip_path(path: &Path, scan_root: &Path) -> bool {
    // Virtual / pseudo filesystems that must never be traversed.
    if path.starts_with("/dev")
        || path.starts_with("/net")
        || path.starts_with("/home")
        || path.starts_with("/.vol")
    {
        return true;
    }

    // Prevent APFS Catalina+ firmlink double-counting of the Data volume.
    if path.starts_with("/System/Volumes/Data") && !scan_root.starts_with("/System/Volumes/Data") {
        return true;
    }

    // Do not cross into external/network mounts under `/Volumes` during root `/` scans,
    // while allowing explicit user-selected targets inside `/Volumes/<volume>`.
    if path.starts_with("/Volumes") && !scan_root.starts_with("/Volumes") {
        return true;
    }

    false
}

/// Query filesystem capacity statistics for `path` (defaults to `/`) using `libc::statvfs`.
pub fn get_disk_overview(path: Option<&Path>) -> Result<DiskOverview, AppError> {
    let target = path.unwrap_or_else(|| Path::new("/"));
    let c_path = CString::new(target.as_os_str().as_bytes())
        .map_err(|_| AppError::InvalidPath(target.display().to_string()))?;

    let mut vfs: libc::statvfs = unsafe { std::mem::zeroed() };
    let rc = unsafe { libc::statvfs(c_path.as_ptr(), &mut vfs) };
    if rc != 0 {
        return Err(AppError::from(std::io::Error::last_os_error()));
    }

    let block_size: u64 = if vfs.f_frsize > 0 {
        #[allow(clippy::unnecessary_cast)]
        {
            vfs.f_frsize as u64
        }
    } else {
        #[allow(clippy::unnecessary_cast)]
        {
            vfs.f_bsize as u64
        }
    };

    #[allow(clippy::unnecessary_cast)]
    let total_bytes = (vfs.f_blocks as u64).saturating_mul(block_size);
    #[allow(clippy::unnecessary_cast)]
    let available_bytes = (vfs.f_bavail as u64).saturating_mul(block_size);
    let used_bytes = total_bytes.saturating_sub(available_bytes);

    let mount_point = resolve_mount_point(&c_path, target);
    let volume_name = resolve_volume_name(&mount_point);

    Ok(DiskOverview {
        mount_point: mount_point.to_string_lossy().into_owned(),
        volume_name,
        total_bytes,
        available_bytes,
        used_bytes,
        purgeable_bytes: None,
    })
}

fn resolve_mount_point(c_path: &CString, fallback: &Path) -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        let mut sfs: libc::statfs = unsafe { std::mem::zeroed() };
        let rc = unsafe { libc::statfs(c_path.as_ptr(), &mut sfs) };
        if rc == 0 {
            let mnt = unsafe { CStr::from_ptr(sfs.f_mntonname.as_ptr()) };
            if let Ok(mnt_str) = mnt.to_str() {
                if !mnt_str.is_empty() {
                    return PathBuf::from(mnt_str);
                }
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = c_path;

    fallback.to_path_buf()
}

fn resolve_volume_name(mount_point: &Path) -> String {
    if mount_point == Path::new("/") {
        // On macOS, `/Volumes/<BootVolumeName>` is typically a symlink pointing to `/`.
        if let Ok(entries) = std::fs::read_dir("/Volumes") {
            for entry in entries.flatten() {
                let entry_path = entry.path();
                if let Ok(link_target) = std::fs::read_link(&entry_path) {
                    if link_target == Path::new("/") {
                        if let Some(name) = entry_path.file_name().and_then(|n| n.to_str()) {
                            return name.to_string();
                        }
                    }
                }
            }
        }
        return "Macintosh HD".to_string();
    }

    mount_point
        .file_name()
        .and_then(|n| n.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| mount_point.to_string_lossy().into_owned())
}
