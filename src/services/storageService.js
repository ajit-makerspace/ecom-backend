import path from 'node:path';
import fs from 'node:fs';
import db from '../config/db.js';
import ftpService from './ftpStorageService.js';

/**
 * Safely resolves a path relative to a base directory and verifies it is confined within baseDir.
 * Prevents directory traversal attacks (e.g. ../../.env).
 * Returns the absolute resolved path if safe and strictly within baseDir, or null otherwise.
 */
export const safePathResolve = (baseDir, ...segments) => {
  if (!baseDir || segments.some((s) => typeof s !== 'string' || s.includes('\0'))) {
    return null;
  }
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, ...segments);
  const relative = path.relative(resolvedBase, resolvedTarget);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return resolvedTarget;
};

/**
 * Returns storage configuration parsed from environment variables
 */
export const getStorageConfig = () => {
  const rawDriver = (process.env.STORAGE_DRIVER || process.env.STORAGE_TYPE || '').toLowerCase().trim();
  const driver = rawDriver === 'local' ? 'local' : (ftpService.isFtpConfigured() ? 'ftp' : 'local');

  // Internal files directory: default to <cwd>/internal-files or custom path
  const internalFilesDir = process.env.INTERNAL_FILES_DIR
    ? path.resolve(process.env.INTERNAL_FILES_DIR)
    : path.resolve(process.cwd(), 'internal-files');

  const keepLocalCache = process.env.FTP_KEEP_LOCAL_CACHE !== 'false';

  return {
    driver, // 'ftp' | 'local'
    internalFilesDir,
    keepLocalCache,
  };
};

/**
 * Returns the absolute directory path for internal-files and ensures it exists
 */
export const getInternalFilesDir = () => {
  const { internalFilesDir } = getStorageConfig();
  if (!fs.existsSync(internalFilesDir)) {
    try {
      fs.mkdirSync(internalFilesDir, { recursive: true });
    } catch (err) {
      console.warn(`[Storage Service] Could not create internal files dir ${internalFilesDir}:`, err.message);
    }
  }
  return internalFilesDir;
};

/**
 * Computes the full local absolute file path for a given folder and filename
 */
export const getLocalFilePath = (folder = 'general', filename) => {
  const root = getInternalFilesDir();
  const safeFolder = (folder || 'general').replace(/[^a-zA-Z0-9_-]/g, '');
  const safeFilename = path.basename(filename || '');
  return safePathResolve(root, safeFolder, safeFilename) || path.join(root, safeFolder, safeFilename);
};

/**
 * Ensures the target folder inside internal-files exists
 */
export const ensureLocalFolder = (folder = 'general') => {
  const root = getInternalFilesDir();
  const safeFolder = (folder || 'general').replace(/[^a-zA-Z0-9_-]/g, '');
  const dirPath = path.join(root, safeFolder);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
};

/**
 * Saves a file buffer to the configured storage driver (FTP or local /internal-files)
 * Gracefully falls back to local storage if FTP is unavailable.
 *
 * @param {Object} params
 * @param {Buffer} params.buffer - File binary buffer
 * @param {string} params.filename - Safe target filename (e.g., banner-1700000000.webp)
 * @param {string} params.folder - Subfolder (products, banners, etc.)
 * @param {string} params.mimeType - MIME type of file
 * @returns {Promise<{ storageType: string, storagePath: string, localPath: string, isFallback: boolean }>}
 */
export const saveFile = async ({ buffer, filename, folder = 'general', mimeType, asyncFtp = false }) => {
  const { driver, keepLocalCache } = getStorageConfig();
  const localDir = ensureLocalFolder(folder);
  const localFilePath = path.join(localDir, filename);

  // Always write locally to internal-files first for instant read availability
  await fs.promises.writeFile(localFilePath, buffer);

  // Case 1: Configured for FTP storage
  if (driver === 'ftp' && ftpService.isFtpConfigured()) {
    const remotePath = ftpService.buildRemotePath(folder, filename);

    // High performance mode: return HTTP response immediately, sync to FTP in background
    if (asyncFtp) {
      setImmediate(async () => {
        try {
          await ftpService.uploadBuffer(buffer, remotePath);
          await db.query(
            `UPDATE media_files
             SET storage_type = 'ftp',
                 storage_path = $1,
                 data = NULL,
                 updated_at = NOW()
             WHERE filename = $2`,
            [remotePath, filename]
          );
          console.log(`[Storage Service] Background FTP upload complete: ${filename} -> ${remotePath}`);
        } catch (bgErr) {
          console.warn(`[Storage Service] Background FTP upload deferred for ${filename} (${bgErr.message}). Scheduled for cron sync.`);
        }
      });

      return {
        storageType: 'pending_ftp',
        storagePath: path.posix.join(folder, filename),
        localPath: localFilePath,
        isFallback: false,
      };
    }

    // Synchronous FTP upload (for CLI scripts and test fixtures)
    try {
      await ftpService.uploadBuffer(buffer, remotePath);

      return {
        storageType: 'ftp',
        storagePath: remotePath,
        localPath: localFilePath,
        isFallback: false,
      };
    } catch (ftpErr) {
      console.warn(
        `[Storage Service] FTP upload failed (${ftpErr.message}). Falling back to local storage in /internal-files/${folder}/${filename}`
      );

      return {
        storageType: 'pending_ftp',
        storagePath: path.posix.join(folder, filename),
        localPath: localFilePath,
        isFallback: true,
      };
    }
  }

  // Case 2: Configured for Local storage (or FTP disabled)
  return {
    storageType: 'local',
    storagePath: path.posix.join(folder, filename),
    localPath: localFilePath,
    isFallback: false,
  };
};

/**
 * Reads a file buffer based on its storage location
 *
 * @param {Object} params
 * @param {string} params.storageType - 'ftp' | 'local' | 'pending_ftp'
 * @param {string} [params.storagePath] - FTP remote path or relative local path
 * @param {string} params.filename - Base filename
 * @param {string} [params.folder] - Folder name
 * @returns {Promise<Buffer|null>}
 */
export const readFile = async ({ storageType, storagePath, filename, folder = 'general' }) => {
  const root = getInternalFilesDir();

  // 1. Check local internal-files directory first (fastest)
  const candidatePaths = [
    storagePath ? safePathResolve(root, storagePath) : null,
    folder && filename ? safePathResolve(root, folder, filename) : null,
    filename ? safePathResolve(root, filename) : null,
  ].filter(Boolean);

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        return await fs.promises.readFile(p);
      } catch (readErr) {
        console.warn(`[Storage Service] Local read failed for ${p}:`, readErr.message);
      }
    }
  }

  // 2. If stored on FTP (or fallback failed locally), download from FTP
  if (storageType === 'ftp' || ftpService.isFtpConfigured()) {
    const remotePath = storagePath && storagePath.startsWith('/')
      ? storagePath
      : ftpService.buildRemotePath(folder, filename);

    try {
      const ftpBuffer = await ftpService.downloadBuffer(remotePath);
      if (ftpBuffer && ftpBuffer.length > 0) {
        // Cache to local internal-files for subsequent reads
        try {
          const localPath = getLocalFilePath(folder, filename);
          ensureLocalFolder(folder);
          await fs.promises.writeFile(localPath, ftpBuffer);
        } catch {}
        return ftpBuffer;
      }
    } catch (ftpErr) {
      // FTP download not available
    }
  }

  // 3. Fallback: Check classic uploads folder
  const cwdUploads = path.resolve(process.cwd(), 'uploads');
  const legacyPaths = [
    folder && filename ? safePathResolve(cwdUploads, folder, filename) : null,
    filename ? safePathResolve(cwdUploads, filename) : null,
  ].filter(Boolean);

  for (const lp of legacyPaths) {
    if (fs.existsSync(lp)) {
      try {
        return await fs.promises.readFile(lp);
      } catch {}
    }
  }

  return null;
};

/**
 * Deletes a file from both local internal-files and remote FTP
 */
export const deleteFile = async ({ storageType, storagePath, filename, folder = 'general' }) => {
  const localPath = getLocalFilePath(folder, filename);
  if (fs.existsSync(localPath)) {
    try {
      await fs.promises.unlink(localPath);
    } catch (e) {
      console.warn(`[Storage Service] Could not delete local file ${localPath}:`, e.message);
    }
  }

  if ((storageType === 'ftp' || storagePath) && ftpService.isFtpConfigured()) {
    const remotePath = storagePath && storagePath.startsWith('/')
      ? storagePath
      : ftpService.buildRemotePath(folder, filename);
    try {
      await ftpService.deleteFile(remotePath);
    } catch (e) {
      console.warn(`[Storage Service] Could not delete remote FTP file ${remotePath}:`, e.message);
    }
  }

  return { success: true };
};

/**
 * Synchronizes pending local files in /internal-files to the FTP server
 * and updates the database records (data = NULL, storage_type = 'ftp')
 */
export const syncLocalToFtp = async ({ limit = 50 } = {}) => {
  if (!ftpService.isFtpConfigured()) {
    return {
      success: false,
      message: 'FTP is not configured or disabled.',
      syncedCount: 0,
      failedCount: 0,
    };
  }

  const { driver } = getStorageConfig();

  // Find records that are marked pending_ftp, or local records when driver is ftp
  const query = `
    SELECT id, filename, folder, mime_type, storage_type, storage_path
    FROM media_files
    WHERE storage_type = 'pending_ftp'
       OR (storage_type = 'local' AND $1 = 'ftp')
    ORDER BY id ASC
    LIMIT $2
  `;
  const { rows } = await db.query(query, [driver, limit]);

  if (rows.length === 0) {
    return {
      success: true,
      message: 'No pending local files to sync.',
      syncedCount: 0,
      failedCount: 0,
    };
  }

  let syncedCount = 0;
  let failedCount = 0;

  for (const row of rows) {
    try {
      // Find file on local disk
      const localPath = getLocalFilePath(row.folder, row.filename);
      let buffer = null;

      if (fs.existsSync(localPath)) {
        buffer = await fs.promises.readFile(localPath);
      } else {
        // Try fallback path with storage_path
        const altPath = path.join(getInternalFilesDir(), row.storage_path || row.filename);
        if (fs.existsSync(altPath)) {
          buffer = await fs.promises.readFile(altPath);
        }
      }

      if (!buffer || buffer.length === 0) {
        console.warn(`[FTP Sync] File not found on local disk for media #${row.id} (${row.filename})`);
        failedCount++;
        continue;
      }

      const remotePath = ftpService.buildRemotePath(row.folder, row.filename);
      await ftpService.uploadBuffer(buffer, remotePath);

      // Update database record: point to FTP and ensure data blob is NULL
      await db.query(
        `UPDATE media_files
         SET storage_type = 'ftp',
             storage_path = $1,
             data = NULL,
             updated_at = NOW()
         WHERE id = $2`,
        [remotePath, row.id]
      );

      syncedCount++;
      console.log(`[FTP Sync] Successfully pushed ${row.filename} to FTP (${remotePath})`);
    } catch (itemErr) {
      failedCount++;
      console.error(`[FTP Sync Error] Failed to push ${row.filename}:`, itemErr.message);
    }
  }

  return {
    success: true,
    syncedCount,
    failedCount,
    totalProcessed: rows.length,
  };
};

/**
 * Purges any existing database blobs from PostgreSQL by dumping them to internal-files / FTP
 * and nullifying the data column to free up database storage.
 * Runs in safe batches so large databases do not exhaust Node memory or stall connections.
 */
export const purgeDbBlobs = async ({ batchSize = 25, maxBatches = 20 } = {}) => {
  try {
    let processedTotal = 0;

    for (let b = 0; b < maxBatches; b++) {
      const { rows } = await db.query(
        `SELECT id, filename, folder, mime_type, storage_type, storage_path, data
         FROM media_files
         WHERE data IS NOT NULL
         ORDER BY id ASC
         LIMIT $1`,
        [batchSize]
      );

      if (!rows || rows.length === 0) break;

      console.log(`[Storage Cleanup] Processing batch ${b + 1} (${rows.length} records) with DB blobs...`);

      for (const row of rows) {
        if (row.data) {
          const localPath = getLocalFilePath(row.folder, row.filename);
          ensureLocalFolder(row.folder);

          if (!fs.existsSync(localPath)) {
            await fs.promises.writeFile(localPath, row.data);
          }

          let newStorageType = row.storage_type || 'local';
          let newStoragePath = row.storage_path || path.posix.join(row.folder, row.filename);

          if (ftpService.isFtpConfigured()) {
            try {
              const remotePath = ftpService.buildRemotePath(row.folder, row.filename);
              await ftpService.uploadBuffer(row.data, remotePath);
              newStorageType = 'ftp';
              newStoragePath = remotePath;
            } catch (e) {
              newStorageType = 'pending_ftp';
            }
          }

          await db.query(
            `UPDATE media_files
             SET data = NULL,
                 storage_type = $1,
                 storage_path = $2,
                 updated_at = NOW()
             WHERE id = $3`,
            [newStorageType, newStoragePath, row.id]
          );
          processedTotal++;
        }
      }
    }

    if (processedTotal > 0) {
      console.log(`[Storage Cleanup] Successfully migrated and purged ${processedTotal} media blob(s) from PostgreSQL.`);
    }
  } catch (err) {
    console.warn('[Storage Cleanup Warning]:', err.message);
  }
};

/**
 * Diagnostic info for admin and monitoring
 */
export const getStorageDiagnostics = async () => {
  const config = getStorageConfig();
  const internalFilesDir = getInternalFilesDir();

  let pendingSyncCount = 0;
  let totalMediaCount = 0;
  let ftpStatus = null;

  try {
    const res = await db.query(`
      SELECT 
        COUNT(*)::int AS total,
        COUNT(CASE WHEN storage_type = 'pending_ftp' THEN 1 END)::int AS pending,
        COUNT(CASE WHEN data IS NOT NULL THEN 1 END)::int AS blobs
      FROM media_files
    `);
    totalMediaCount = res.rows[0]?.total || 0;
    pendingSyncCount = res.rows[0]?.pending || 0;
  } catch {}

  try {
    ftpStatus = await ftpService.testConnection();
  } catch (e) {
    ftpStatus = { success: false, message: e.message };
  }

  return {
    configuredDriver: config.driver,
    internalFilesDir,
    keepLocalCache: config.keepLocalCache,
    totalMediaRecords: totalMediaCount,
    pendingSyncToFtp: pendingSyncCount,
    ftpStatus,
  };
};

export default {
  safePathResolve,
  getStorageConfig,
  getInternalFilesDir,
  getLocalFilePath,
  ensureLocalFolder,
  saveFile,
  readFile,
  deleteFile,
  syncLocalToFtp,
  purgeDbBlobs,
  getStorageDiagnostics,
};
