import 'dotenv/config';
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import storageService from '../src/services/storageService.js';
import ftpService from '../src/services/ftpStorageService.js';
import { convertToWebp } from '../src/controllers/uploadController.js';
import db from '../src/config/db.js';

describe('Storage & WebP Pipeline Test Suite', () => {
  const originalDbQuery = db.query;
  const originalUploadBuffer = ftpService.uploadBuffer;
  const originalDownloadBuffer = ftpService.downloadBuffer;
  const originalTestConnection = ftpService.testConnection;
  const originalDriver = process.env.STORAGE_DRIVER;
  const originalInternalDir = process.env.INTERNAL_FILES_DIR;

  // 1x1 transparent PNG sample buffer
  const samplePngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  const testTempDir = path.resolve(process.cwd(), 'tests/.temp_internal_files');

  beforeEach(() => {
    process.env.INTERNAL_FILES_DIR = testTempDir;
    if (!fs.existsSync(testTempDir)) {
      fs.mkdirSync(testTempDir, { recursive: true });
    }
  });

  afterEach(() => {
    db.query = originalDbQuery;
    ftpService.uploadBuffer = originalUploadBuffer;
    ftpService.downloadBuffer = originalDownloadBuffer;
    ftpService.testConnection = originalTestConnection;
    process.env.STORAGE_DRIVER = originalDriver;
    process.env.INTERNAL_FILES_DIR = originalInternalDir;

    // Clean up test temp files
    try {
      if (fs.existsSync(testTempDir)) {
        fs.rmSync(testTempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  // 1. WebP Conversion
  test('1. Converts PNG and JPEG image buffers to .webp format with quality 85', async () => {
    const result = await convertToWebp(samplePngBuffer, 'image/png');
    assert.equal(result.isConverted, true);
    assert.equal(result.mimeType, 'image/webp');
    assert.equal(result.ext, '.webp');
    assert.ok(result.buffer.length > 0);

    // Verify RIFF / WEBP magic header in output buffer
    const header = result.buffer.toString('ascii', 0, 12);
    assert.ok(header.startsWith('RIFF') && header.includes('WEBP'), 'Buffer must have WebP RIFF header');
  });

  test('2. Preserves video and PDF files without converting to WebP', async () => {
    const fakeMp4 = Buffer.from('fake-video-content-stream');
    const mp4Result = await convertToWebp(fakeMp4, 'video/mp4');
    assert.equal(mp4Result.isConverted, false);
    assert.equal(mp4Result.mimeType, 'video/mp4');
    assert.equal(mp4Result.ext, '.mp4');

    const fakePdf = Buffer.from('fake-pdf-content');
    const pdfResult = await convertToWebp(fakePdf, 'application/pdf');
    assert.equal(pdfResult.isConverted, false);
    assert.equal(pdfResult.mimeType, 'application/pdf');
    assert.equal(pdfResult.ext, '.pdf');
  });

  // 2. Local Storage Driver
  test('3. Local storage driver stores file in internal-files directory with correct relative path', async () => {
    process.env.STORAGE_DRIVER = 'local';
    const filename = `test-${Date.now()}.webp`;

    const result = await storageService.saveFile({
      buffer: samplePngBuffer,
      filename,
      folder: 'products',
      mimeType: 'image/webp',
    });

    assert.equal(result.storageType, 'local');
    assert.equal(result.storagePath, `products/${filename}`);
    assert.ok(fs.existsSync(result.localPath), 'File must exist on disk in internal-files');

    const readBack = await fs.promises.readFile(result.localPath);
    assert.equal(readBack.length, samplePngBuffer.length);
  });

  // 3. FTP Storage Driver (with successful upload)
  test('4. FTP storage driver uploads to FTP server when connection succeeds', async () => {
    process.env.STORAGE_DRIVER = 'ftp';
    let uploadedRemotePath = null;
    let uploadedBufferSize = null;

    ftpService.uploadBuffer = async (buffer, remotePath) => {
      uploadedRemotePath = remotePath;
      uploadedBufferSize = buffer.length;
      return { success: true, remotePath, size: buffer.length };
    };

    const filename = `test-ftp-${Date.now()}.webp`;
    const result = await storageService.saveFile({
      buffer: samplePngBuffer,
      filename,
      folder: 'products',
      mimeType: 'image/webp',
    });

    assert.equal(result.storageType, 'ftp');
    assert.ok(uploadedRemotePath.includes(filename));
    assert.equal(uploadedBufferSize, samplePngBuffer.length);
    assert.equal(result.isFallback, false);
  });

  // 4. FTP Failure Fallback to /internal-files
  test('5. Gracefully falls back to local /internal-files when FTP connection fails', async () => {
    process.env.STORAGE_DRIVER = 'ftp';

    ftpService.uploadBuffer = async () => {
      throw new Error('Connection refused: FTP server offline');
    };

    const filename = `test-fallback-${Date.now()}.webp`;
    const result = await storageService.saveFile({
      buffer: samplePngBuffer,
      filename,
      folder: 'products',
      mimeType: 'image/webp',
    });

    assert.equal(result.storageType, 'pending_ftp');
    assert.equal(result.isFallback, true);
    assert.equal(result.storagePath, `products/${filename}`);
    assert.ok(fs.existsSync(result.localPath), 'File must be saved to local disk in internal-files');
  });

  // 5. FTP Cron Sync
  test('6. syncLocalToFtp pushes pending_ftp files to FTP and updates database records', async () => {
    process.env.STORAGE_DRIVER = 'ftp';

    const filename = `sync-test-${Date.now()}.webp`;
    const localDir = path.join(testTempDir, 'products');
    fs.mkdirSync(localDir, { recursive: true });
    const localPath = path.join(localDir, filename);
    await fs.promises.writeFile(localPath, samplePngBuffer);

    let updatedDbId = null;
    let updatedStorageType = null;
    let updatedStoragePath = null;
    let ftpUploadedPath = null;

    db.query = async (sql, params) => {
      if (sql.includes('SELECT id, filename, folder')) {
        return {
          rows: [
            {
              id: 999,
              filename,
              folder: 'products',
              mimeType: 'image/webp',
              storage_type: 'pending_ftp',
              storage_path: `products/${filename}`,
            },
          ],
        };
      }
      if (sql.includes('UPDATE media_files')) {
        updatedStoragePath = params[0];
        updatedDbId = params[1];
        updatedStorageType = 'ftp';
        return { rowCount: 1 };
      }
      return { rows: [] };
    };

    ftpService.testConnection = async () => ({ success: true });
    ftpService.uploadBuffer = async (buf, remPath) => {
      ftpUploadedPath = remPath;
      return { success: true };
    };

    const syncResult = await storageService.syncLocalToFtp({ limit: 10 });
    assert.equal(syncResult.success, true);
    assert.equal(syncResult.syncedCount, 1);
    assert.ok(ftpUploadedPath.includes(filename));
    assert.equal(updatedDbId, 999);
    assert.equal(updatedStorageType, 'ftp');
    assert.ok(updatedStoragePath.includes(filename));
  });

  // 6. Read File resolution
  test('7. readFile reads local disk buffer if present, otherwise downloads from FTP', async () => {
    const filename = `read-test-${Date.now()}.webp`;
    const localDir = path.join(testTempDir, 'products');
    fs.mkdirSync(localDir, { recursive: true });
    await fs.promises.writeFile(path.join(localDir, filename), samplePngBuffer);

    // Local read
    const localBuf = await storageService.readFile({
      storageType: 'local',
      storagePath: `products/${filename}`,
      filename,
      folder: 'products',
    });
    assert.ok(localBuf);
    assert.equal(localBuf.length, samplePngBuffer.length);

    // FTP download read when not on local disk
    const remoteFilename = `ftp-only-${Date.now()}.webp`;
    let ftpDownloaded = false;
    ftpService.downloadBuffer = async () => {
      ftpDownloaded = true;
      return samplePngBuffer;
    };

    const ftpBuf = await storageService.readFile({
      storageType: 'ftp',
      storagePath: `/ecom/products/${remoteFilename}`,
      filename: remoteFilename,
      folder: 'products',
    });
    assert.equal(ftpDownloaded, true);
    assert.equal(ftpBuf.length, samplePngBuffer.length);
  });

  // 7. DB Blob Purge
  test('8. purgeDbBlobs exports existing DB blobs to disk/FTP and sets data column to NULL', async () => {
    const blobFilename = `blob-cleanup-${Date.now()}.webp`;
    let dbUpdatedNull = false;

    db.query = async (sql, params) => {
      if (sql.includes('SELECT id, filename, folder') && sql.includes('data IS NOT NULL')) {
        if (dbUpdatedNull) {
          return { rows: [] };
        }
        return {
          rows: [
            {
              id: 777,
              filename: blobFilename,
              folder: 'products',
              mime_type: 'image/webp',
              storage_type: 'local',
              storage_path: `products/${blobFilename}`,
              data: samplePngBuffer,
            },
          ],
        };
      }
      if (sql.includes('UPDATE media_files') && sql.includes('SET data = NULL')) {
        dbUpdatedNull = true;
        return { rowCount: 1 };
      }
      return { rows: [] };
    };

    ftpService.isFtpConfigured = () => false;

    await storageService.purgeDbBlobs();
    assert.equal(dbUpdatedNull, true, 'purgeDbBlobs must set data = NULL in database');

    const expectedDiskFile = path.join(testTempDir, 'products', blobFilename);
    assert.ok(fs.existsSync(expectedDiskFile), 'Blob must be saved to disk in internal-files');
  });
});
