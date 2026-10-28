import path from 'node:path';
import fs from 'node:fs';
import { Readable, Writable } from 'node:stream';
import * as ftp from 'basic-ftp';

// Directory for caching frequently accessed FTP media on local disk
const CACHE_DIR = path.resolve(process.cwd(), '.cache/ftp_media');

// Ensure cache directory exists
try {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
} catch (e) {
  console.warn('[FTP Storage] Failed to initialize cache directory:', e.message);
}

/**
 * Returns FTP configuration from environment variables
 */
export const getFtpConfig = () => ({
  host: process.env.FTP_HOST || '192.168.1.173',
  port: parseInt(process.env.FTP_PORT || '21', 10),
  user: process.env.FTP_USER || 'user',
  password: process.env.FTP_PASSWORD || 'Admin@1234',
  secure: process.env.FTP_SECURE === 'true',
});

/**
 * Check if FTP storage is enabled and configured
 */
export const isFtpConfigured = () => {
  return process.env.FTP_ENABLED !== 'false' && Boolean(process.env.FTP_HOST);
};

/**
 * Returns the sanitized base remote directory on FTP server.
 * Defaults to '/ecom' if FTP_ROOT_DIR is '/' or unset to prevent root-level clutter.
 */
export const getFtpBaseDir = () => {
  const rootDir = process.env.FTP_ROOT_DIR || '/';
  if (rootDir === '/' || rootDir === '') {
    return '/ecom';
  }
  return rootDir.replace(/\/+$/, '');
};

/**
 * Builds full remote posix path for a file under a given folder
 * e.g. /ecom/products/products-1793077901943-40313b51b321.webp
 */
export const buildRemotePath = (folder = 'general', filename) => {
  const baseDir = getFtpBaseDir();
  return path.posix.join(baseDir, folder, filename);
};

/**
 * Executes a callback with an authenticated FTP client and automatically closes connection
 */
export const withFtpClient = async (callback) => {
  const client = new ftp.Client();
  client.ftp.timeout = 15000; // 15 seconds timeout
  try {
    await client.access(getFtpConfig());
    return await callback(client);
  } finally {
    client.close();
  }
};

/**
 * Uploads a Buffer to the FTP server at the specified remote path
 *
 * @param {Buffer} buffer - Binary data to upload
 * @param {string} remotePath - Posix remote path (e.g. /ecom/products/image.webp)
 * @returns {Promise<{ success: boolean, remotePath: string, size: number }>}
 */
export const uploadBuffer = async (buffer, remotePath) => {
  return await withFtpClient(async (client) => {
    const remoteDir = path.posix.dirname(remotePath);
    const remoteFilename = path.posix.basename(remotePath);

    // Recursively ensure destination directory exists on FTP server
    await client.ensureDir(remoteDir);

    // Stream buffer into FTP file
    const stream = Readable.from(buffer);
    await client.uploadFrom(stream, remoteFilename);

    // Also update local cache for instant zero-latency subsequent reads
    try {
      const localCachedPath = path.join(CACHE_DIR, remoteFilename);
      await fs.promises.writeFile(localCachedPath, buffer);
    } catch (cacheErr) {
      // Non-fatal cache write warning
      console.warn('[FTP Storage] Cache write warning:', cacheErr.message);
    }

    return {
      success: true,
      remotePath,
      size: buffer.length,
    };
  });
};

/**
 * Uploads a Readable stream directly to the FTP server
 */
export const uploadStream = async (readableStream, remotePath) => {
  return await withFtpClient(async (client) => {
    const remoteDir = path.posix.dirname(remotePath);
    const remoteFilename = path.posix.basename(remotePath);

    await client.ensureDir(remoteDir);
    await client.uploadFrom(readableStream, remoteFilename);

    return {
      success: true,
      remotePath,
    };
  });
};

/**
 * Downloads a file from FTP server into a Buffer
 *
 * @param {string} remotePath - Full posix remote path
 * @returns {Promise<Buffer>}
 */
export const downloadBuffer = async (remotePath) => {
  const remoteFilename = path.posix.basename(remotePath);
  const localCachedPath = path.join(CACHE_DIR, remoteFilename);

  // Return from local disk cache if available
  if (fs.existsSync(localCachedPath)) {
    try {
      return await fs.promises.readFile(localCachedPath);
    } catch {
      // fallback to FTP download if disk read fails
    }
  }

  return await withFtpClient(async (client) => {
    const chunks = [];
    const writable = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    });

    await client.downloadTo(writable, remotePath);
    const fullBuffer = Buffer.concat(chunks);

    // Write to cache in background
    fs.promises.writeFile(localCachedPath, fullBuffer).catch(() => {});

    return fullBuffer;
  });
};

/**
 * Streams a remote FTP file directly into a Writable stream (e.g. Express HTTP response)
 *
 * @param {string} remotePath - Full posix remote path
 * @param {import('stream').Writable} destinationStream - Target writable stream
 */
export const downloadStream = async (remotePath, destinationStream) => {
  const remoteFilename = path.posix.basename(remotePath);
  const localCachedPath = path.join(CACHE_DIR, remoteFilename);

  // If already in local cache, pipe from local disk for maximum speed
  if (fs.existsSync(localCachedPath)) {
    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(localCachedPath);
      readStream.on('error', reject);
      destinationStream.on('finish', resolve);
      readStream.pipe(destinationStream);
    });
  }

  // Otherwise, stream from FTP and concurrently save to local disk cache
  return await withFtpClient(async (client) => {
    const chunks = [];
    const passThrough = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk);
        destinationStream.write(chunk, encoding, callback);
      },
      final(callback) {
        destinationStream.end(callback);
        // Persist to cache
        fs.promises.writeFile(localCachedPath, Buffer.concat(chunks)).catch(() => {});
      },
    });

    await client.downloadTo(passThrough, remotePath);
  });
};

/**
 * Deletes a file on the FTP server
 *
 * @param {string} remotePath - Posix remote path
 */
export const deleteFile = async (remotePath) => {
  return await withFtpClient(async (client) => {
    await client.remove(remotePath);
    // Also remove from local cache if present
    const remoteFilename = path.posix.basename(remotePath);
    const localCachedPath = path.join(CACHE_DIR, remoteFilename);
    if (fs.existsSync(localCachedPath)) {
      try {
        await fs.promises.unlink(localCachedPath);
      } catch {}
    }
    return { success: true };
  });
};

/**
 * Lists files in an FTP directory
 */
export const listFiles = async (remoteDir = '/') => {
  return await withFtpClient(async (client) => {
    return await client.list(remoteDir);
  });
};

/**
 * Tests FTP connectivity and authentication
 */
export const testConnection = async () => {
  return await withFtpClient(async (client) => {
    const pwd = await client.pwd();
    return {
      success: true,
      message: 'Connected to FTP server successfully',
      pwd,
      config: {
        host: process.env.FTP_HOST || '192.168.1.173',
        port: parseInt(process.env.FTP_PORT || '21', 10),
        user: process.env.FTP_USER || 'user',
        rootDir: getFtpBaseDir(),
      },
    };
  });
};

export default {
  getFtpConfig,
  isFtpConfigured,
  getFtpBaseDir,
  buildRemotePath,
  uploadBuffer,
  uploadStream,
  downloadBuffer,
  downloadStream,
  deleteFile,
  listFiles,
  testConnection,
};
