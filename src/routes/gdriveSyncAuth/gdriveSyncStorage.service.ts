import { drive_v3, google } from 'googleapis';
import { Readable } from 'stream';

type ListResultItem = {
  Key: string;
  LastModified: string;
  Size: number;
  ETag: string;
  MimeType: string;
};

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export class GoogleDriveSyncStorageService {
  private readonly drive: drive_v3.Drive;
  private readonly appFolderName = 'TypingMind-Cloud-Sync';
  // pathIdCache is optionally shared across requests for the same device token,
  // eliminating redundant Drive folder-lookup API calls on every upload.
  private readonly pathIdCache: Map<string, string>;
  private readonly fileMetaCache = new Map<string, drive_v3.Schema$File | null>();

  public constructor(auth: any, sharedPathCache?: Map<string, string>) {
    this.drive = google.drive({ version: 'v3', auth });
    this.pathIdCache = sharedPathCache ?? new Map<string, string>();
  }

  private async getAppFolderId(): Promise<string> {
    if (this.pathIdCache.has(this.appFolderName)) {
      return this.pathIdCache.get(this.appFolderName)!;
    }

    const q = [
      `mimeType='application/vnd.google-apps.folder'`,
      `name='${escapeDriveQueryValue(this.appFolderName)}'`,
      'trashed=false',
    ].join(' and ');

    const response = await this.drive.files.list({
      q,
      fields: 'files(id, name)',
      pageSize: 10,
      supportsAllDrives: false,
    });

    const existing = response.data.files?.[0];
    if (existing?.id) {
      this.pathIdCache.set(this.appFolderName, existing.id);
      return existing.id;
    }

    const created = await this.drive.files.create({
      requestBody: {
        name: this.appFolderName,
        mimeType: 'application/vnd.google-apps.folder',
      },
      fields: 'id',
    });

    const id = created.data.id;
    if (!id) {
      throw new Error('Failed to create root Google Drive app folder');
    }

    this.pathIdCache.set(this.appFolderName, id);
    return id;
  }

  public async getPathId(path: string, createIfNotExists: boolean): Promise<string | null> {
    const normalized = path.replace(/^\/+|\/+$/g, '');
    if (!normalized) {
      return this.getAppFolderId();
    }

    if (this.pathIdCache.has(normalized)) {
      return this.pathIdCache.get(normalized)!;
    }

    const parts = normalized.split('/').filter(Boolean);
    let parentId = await this.getAppFolderId();
    let currentPath = '';

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      if (this.pathIdCache.has(currentPath)) {
        parentId = this.pathIdCache.get(currentPath)!;
        continue;
      }

      const q = [
        `mimeType='application/vnd.google-apps.folder'`,
        `name='${escapeDriveQueryValue(part)}'`,
        `'${parentId}' in parents`,
        'trashed=false',
      ].join(' and ');

      const response = await this.drive.files.list({
        q,
        fields: 'files(id)',
        pageSize: 10,
      });

      const existing = response.data.files?.[0];
      if (existing?.id) {
        parentId = existing.id;
        this.pathIdCache.set(currentPath, parentId);
        continue;
      }

      if (!createIfNotExists) {
        return null;
      }

      const created = await this.drive.files.create({
        requestBody: {
          name: part,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentId],
        },
        fields: 'id',
      });
      const id = created.data.id;
      if (!id) {
        throw new Error(`Failed to create Google Drive folder path segment: ${part}`);
      }
      parentId = id;
      this.pathIdCache.set(currentPath, parentId);
    }

    return parentId;
  }

  public async ensurePathExists(path: string): Promise<void> {
    await this.getPathId(path, true);
  }

  public async getFileMetadata(path: string): Promise<drive_v3.Schema$File | null> {
    const normalized = path.replace(/^\/+|\/+$/g, '');
    if (this.fileMetaCache.has(normalized)) {
      return this.fileMetaCache.get(normalized)!;
    }

    const parts = normalized.split('/').filter(Boolean);
    const filename = parts.pop();
    const folderPath = parts.join('/');
    if (!filename) {
      return null;
    }

    const parentId = await this.getPathId(folderPath, false);
    if (!parentId) {
      this.fileMetaCache.set(normalized, null);
      return null;
    }

    const q = [
      `name='${escapeDriveQueryValue(filename)}'`,
      `'${parentId}' in parents`,
      'trashed=false',
    ].join(' and ');

    const response = await this.drive.files.list({
      q,
      fields: 'files(id, name, mimeType, size, modifiedTime)',
      pageSize: 10,
    });

    const file = response.data.files?.[0] || null;
    this.fileMetaCache.set(normalized, file);
    return file;
  }

  public async uploadObject(params: {
    key: string;
    body: Buffer;
    isMetadata: boolean;
    contentType?: string;
  }): Promise<{ ETag: string; id: string; modifiedTime: string }> {
    const normalized = params.key.replace(/^\/+/, '');
    const parts = normalized.split('/').filter(Boolean);
    const filename = parts.pop();
    const folderPath = parts.join('/');
    if (!filename) {
      throw new Error('Upload key must include a file name');
    }

    const parentId = await this.getPathId(folderPath, true);
    if (!parentId) {
      throw new Error(`Failed to resolve parent folder for ${normalized}`);
    }
    const existingFile = await this.getFileMetadata(normalized);

    const requestBody: drive_v3.Schema$File = {
      name: filename,
      mimeType: params.isMetadata ? 'application/json' : params.contentType || 'application/octet-stream',
    };
    if (!existingFile) {
      requestBody.parents = [parentId];
    }

    const media = {
      mimeType: params.isMetadata ? 'application/json' : params.contentType || 'application/octet-stream',
      body: Readable.from(Buffer.from(params.body)),
    };

    const response = existingFile?.id
      ? await this.drive.files.update({
          fileId: existingFile.id,
          requestBody,
          media,
          fields: 'id, modifiedTime',
        })
      : await this.drive.files.create({
          requestBody,
          media,
          fields: 'id, modifiedTime',
        });

    const fileId = response.data.id;
    const modifiedTime = response.data.modifiedTime;
    if (!fileId || !modifiedTime) {
      throw new Error(`Google Drive did not return upload metadata for ${normalized}`);
    }
    this.fileMetaCache.delete(normalized);
    return {
      ETag: modifiedTime,
      id: fileId,
      modifiedTime,
    };
  }

  public async downloadObjectBuffer(key: string): Promise<{ buffer: Buffer; file: drive_v3.Schema$File }> {
    const normalized = key.replace(/^\/+/, '');
    const file = await this.getFileMetadata(normalized);
    if (!file?.id) {
      throw new Error(`Google Drive object not found: ${normalized}`);
    }
    const response = await this.drive.files.get(
      { fileId: file.id, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    return {
      buffer: Buffer.from(response.data as ArrayBuffer),
      file,
    };
  }

  public async downloadObjectText(key: string): Promise<{ text: string; file: drive_v3.Schema$File }> {
    const { buffer, file } = await this.downloadObjectBuffer(key);
    return { text: buffer.toString('utf8'), file };
  }

  public async deleteObject(key: string): Promise<void> {
    const normalized = key.replace(/^\/+/, '');
    const file = await this.getFileMetadata(normalized);
    if (!file?.id) {
      return;
    }
    await this.drive.files.delete({ fileId: file.id });
    this.fileMetaCache.delete(normalized);
  }

  public async deleteFolder(folderPath: string): Promise<void> {
    const normalized = folderPath.replace(/^\/+|\/+$/g, '');
    const folderId = await this.getPathId(normalized, false);
    if (!folderId) {
      return;
    }
    await this.drive.files.delete({ fileId: folderId });

    for (const key of Array.from(this.pathIdCache.keys())) {
      if (key === normalized || key.startsWith(`${normalized}/`)) {
        this.pathIdCache.delete(key);
      }
    }
    for (const key of Array.from(this.fileMetaCache.keys())) {
      if (key.startsWith(`${normalized}/`)) {
        this.fileMetaCache.delete(key);
      }
    }
  }

  public async list(prefix = ''): Promise<ListResultItem[]> {
    const normalized = prefix.replace(/^\/+/, '');
    const parentPath = normalized.replace(/\/+$/, '');
    const parentId = await this.getPathId(parentPath, false);
    if (!parentId) {
      return [];
    }

    const files: drive_v3.Schema$File[] = [];
    let pageToken: string | undefined;
    do {
      const response = await this.drive.files.list({
        q: `'${parentId}' in parents and trashed=false`,
        fields: 'nextPageToken, files(id, name, size, modifiedTime, mimeType)',
        pageSize: 1000,
        pageToken,
      });
      files.push(...(response.data.files || []));
      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);

    return files.map((file) => ({
      Key: normalized ? `${normalized.replace(/\/+$/, '')}/${file.name}` : file.name || '',
      LastModified: file.modifiedTime || new Date(0).toISOString(),
      Size: Number(file.size || 0),
      ETag: file.modifiedTime || new Date(0).toISOString(),
      MimeType: file.mimeType || 'application/octet-stream',
    }));
  }

  public async copyObject(sourceKey: string, destinationKey: string): Promise<void> {
    const source = await this.getFileMetadata(sourceKey);
    if (!source?.id) {
      throw new Error(`Source object not found: ${sourceKey}`);
    }

    const destNormalized = destinationKey.replace(/^\/+/, '');
    const parts = destNormalized.split('/').filter(Boolean);
    const destFilename = parts.pop();
    const destFolderPath = parts.join('/');
    if (!destFilename) {
      throw new Error('Destination key must include a file name');
    }
    const destParentId = await this.getPathId(destFolderPath, true);
    if (!destParentId) {
      throw new Error(`Failed to resolve destination parent folder for ${destinationKey}`);
    }

    await this.drive.files.copy({
      fileId: source.id,
      requestBody: {
        name: destFilename,
        parents: [destParentId],
      },
      fields: 'id',
    });
    this.fileMetaCache.delete(destNormalized);
  }
}
