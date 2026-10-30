import path from 'node:path';
import fs from 'node:fs';
import * as ftp from 'basic-ftp';
import dotenv from 'dotenv';

// Load environment variables from .env
dotenv.config();

const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
const DELETE_AFTER_UPLOAD = process.argv.includes('--delete-local');

const getFtpConfig = () => ({
  host: process.env.FTP_HOST || '192.168.1.173',
  port: parseInt(process.env.FTP_PORT || '21', 10),
  user: process.env.FTP_USER || 'user',
  password: process.env.FTP_PASSWORD || 'Admin@1234',
  secure: process.env.FTP_SECURE === 'true',
});

const getFtpBaseDir = () => {
  const rootDir = process.env.FTP_ROOT_DIR || '/';
  if (rootDir === '/' || rootDir === '') {
    return '/ecom';
  }
  return rootDir.replace(/\/+$/, '');
};

/**
 * Recursively retrieves all files within a directory
 */
const getAllFiles = (dir) => {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    if (file.startsWith('.')) continue; // ignore hidden/system files
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
};

async function migrateUploads() {
  console.log('========================================================');
  console.log('📦 E-COMMERCE FTP MIGRATION TOOL');
  console.log('========================================================');
  console.log(`Local Uploads Directory: ${UPLOADS_DIR}`);
  console.log(`FTP Server: ${process.env.FTP_HOST}:${process.env.FTP_PORT || 21}`);
  console.log(`Remote Base Directory: ${getFtpBaseDir()}`);
  console.log(`Delete Local Files When Done: ${DELETE_AFTER_UPLOAD ? 'YES' : 'NO'}`);
  console.log('--------------------------------------------------------');

  if (!fs.existsSync(UPLOADS_DIR)) {
    console.error(`❌ Uploads directory not found at: ${UPLOADS_DIR}`);
    process.exit(1);
  }

  const allLocalFiles = getAllFiles(UPLOADS_DIR);
  console.log(`🔍 Discovered ${allLocalFiles.length} files in local uploads directory.\n`);

  if (allLocalFiles.length === 0) {
    console.log('✅ No files to migrate.');
    process.exit(0);
  }

  const client = new ftp.Client();
  client.ftp.timeout = 25000;

  const ensureConnected = async () => {
    if (client.closed) {
      console.log('\n🔄 Reconnecting to FTP server...');
      await client.access(getFtpConfig());
      console.log('✅ Reconnected successfully!\n');
    }
  };

  try {
    console.log('🔌 Connecting to FTP server...');
    await client.access(getFtpConfig());
    console.log('✅ Connected and authenticated successfully!\n');

    const baseDir = getFtpBaseDir();
    let uploadedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // Cache remote directory listings to avoid repeated LIST calls for every file
    const remoteDirCache = new Map();

    const getRemoteList = async (dir) => {
      await ensureConnected();
      if (remoteDirCache.has(dir)) return remoteDirCache.get(dir);
      try {
        const list = await client.list(dir);
        const map = new Map();
        for (const item of list) {
          map.set(item.name, item.size);
        }
        remoteDirCache.set(dir, map);
        return map;
      } catch {
        const empty = new Map();
        remoteDirCache.set(dir, empty);
        return empty;
      }
    };

    const startTime = Date.now();

    for (let i = 0; i < allLocalFiles.length; i++) {
      const localFilePath = allLocalFiles[i];
      const relativePath = path.relative(UPLOADS_DIR, localFilePath);
      // Construct posix remote path: e.g. /ecom/products/robu/filename.jpg
      const remotePath = path.posix.join(baseDir, relativePath.split(path.sep).join('/'));
      const remoteDir = path.posix.dirname(remotePath);
      const filename = path.posix.basename(remotePath);

      const localStat = fs.statSync(localFilePath);
      const localSize = localStat.size;

      const progress = `[${i + 1}/${allLocalFiles.length}]`;

      try {
        await ensureConnected();

        // Ensure remote folder exists
        if (!remoteDirCache.has(remoteDir)) {
          await client.ensureDir(remoteDir);
          await getRemoteList(remoteDir);
        }

        const remoteListing = await getRemoteList(remoteDir);

        // Check if file already exists with same size
        if (remoteListing.has(filename) && remoteListing.get(filename) === localSize) {
          skippedCount++;
          if (i % 30 === 0 || i === allLocalFiles.length - 1) {
            process.stdout.write(`\r${progress} Verified on FTP: ${relativePath.slice(0, 45)}...`);
          }
          continue;
        }

        // Upload file
        await client.ensureDir(remoteDir);
        await client.uploadFrom(localFilePath, filename);

        // Update cache
        remoteListing.set(filename, localSize);
        uploadedCount++;

        const kb = (localSize / 1024).toFixed(1);
        process.stdout.write(`\r${progress} Uploaded (${kb} KB): ${relativePath.slice(0, 45)}\n`);
      } catch (err) {
        if (client.closed || String(err.message).includes('closed') || String(err.message).includes('Timeout')) {
          try {
            await ensureConnected();
            await client.ensureDir(remoteDir);
            await client.uploadFrom(localFilePath, filename);
            uploadedCount++;
            const kb = (localSize / 1024).toFixed(1);
            process.stdout.write(`\r${progress} Re-uploaded (${kb} KB): ${relativePath.slice(0, 45)}\n`);
            continue;
          } catch (retryErr) {
            errorCount++;
            console.error(`\n❌ Error uploading ${relativePath}:`, retryErr.message);
          }
        } else {
          errorCount++;
          console.error(`\n❌ Error uploading ${relativePath}:`, err.message);
        }
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n========================================================');
    console.log('🎉 MIGRATION FINISHED');
    console.log('========================================================');
    console.log(`⏱️ Duration: ${duration}s`);
    console.log(`📤 Newly Uploaded: ${uploadedCount}`);
    console.log(`⏭️ Already on FTP (Verified): ${skippedCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log('--------------------------------------------------------');

    if (errorCount === 0 && DELETE_AFTER_UPLOAD) {
      console.log('🗑️ Purging local uploaded files to free up disk space...');
      for (const filePath of allLocalFiles) {
        try {
          fs.unlinkSync(filePath);
        } catch {}
      }
      console.log('✅ Local uploads cleaned up successfully!');
    }

    console.log(`All files are hosted on your FTP server under ${baseDir}/`);
    console.log('The backend server will stream them seamlessly via /uploads/*');
    console.log('========================================================\n');
  } catch (err) {
    console.error('\n❌ Fatal FTP Migration Error:', err.message);
  } finally {
    client.close();
  }
}

migrateUploads();
