import { getStorageConfig, syncLocalToFtp, purgeDbBlobs } from './storageService.js';
import ftpService from './ftpStorageService.js';

let cronTimer = null;
let isSyncing = false;

/**
 * Runs a single pass of the FTP synchronization cycle.
 * Verifies FTP connection, pushes pending local files to FTP,
 * and clears legacy DB blobs in safe background batches.
 */
export const runFtpSync = async () => {
  if (isSyncing) {
    return { skipped: true, reason: 'Sync pass already in progress' };
  }

  const config = getStorageConfig();

  // If storage driver is purely local and no FTP credentials configured, skip
  if (!ftpService.isFtpConfigured()) {
    return { skipped: true, reason: 'FTP service is not configured' };
  }

  isSyncing = true;
  try {
    // 1. Check if FTP is reachable
    await ftpService.testConnection();

    // 2. Perform synchronization of pending files
    const result = await syncLocalToFtp({ limit: 50 });
    if (result.syncedCount > 0) {
      console.log(`[FTP Sync Cron] Pushed ${result.syncedCount} pending local file(s) to FTP server.`);
    }

    // 3. Purge a small batch of legacy database blobs if any remain
    await purgeDbBlobs({ batchSize: 10, maxBatches: 1 }).catch(() => {});

    return result;
  } catch (err) {
    // FTP server is currently unreachable or offline — will retry on next cron tick
    return { skipped: true, error: err.message };
  } finally {
    isSyncing = false;
  }
};

/**
 * Starts the background periodic FTP synchronization cron job.
 * Default interval: 60 seconds (configurable via FTP_SYNC_INTERVAL_MS).
 */
export const startFtpSyncCron = (intervalMs = null) => {
  if (cronTimer) return;

  const ms = intervalMs || parseInt(process.env.FTP_SYNC_INTERVAL_MS || '900000', 10);
  console.log(`⏱️ FTP Background Sync Cron scheduled to run every ${Math.round(ms / 1000)}s`);

  // Initial sync check 5 seconds after server startup
  const initialTimer = setTimeout(() => {
    runFtpSync().catch(() => {});
  }, 5000);
  if (initialTimer.unref) initialTimer.unref();

  cronTimer = setInterval(() => {
    runFtpSync().catch(() => {});
  }, ms);

  // Unref timer so it doesn't block clean Node.js process exits/tests
  if (cronTimer.unref) {
    cronTimer.unref();
  }
};

/**
 * Stops the periodic FTP synchronization cron job
 */
export const stopFtpSyncCron = () => {
  if (cronTimer) {
    clearInterval(cronTimer);
    cronTimer = null;
    console.log('[FTP Sync Cron] Background sync timer stopped.');
  }
};

export default {
  runFtpSync,
  startFtpSyncCron,
  stopFtpSyncCron,
};
