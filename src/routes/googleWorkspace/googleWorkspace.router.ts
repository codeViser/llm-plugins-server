import express, { NextFunction, Request, Response, Router } from 'express';
import { google } from 'googleapis';
import { StatusCodes } from 'http-status-codes';

import { env } from '@/common/utils/envConfig';

export const googleWorkspaceRouter: Router = express.Router();

// New Middleware: Expects Google Access Token as Bearer token
export const verifyGoogleAccessTokenAndSetClient = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res
      .status(StatusCodes.UNAUTHORIZED)
      .json({ error: 'User not authenticated: Missing or invalid Authorization header.' });
  }

  const googleAccessToken = authHeader.split(' ')[1];

  if (!googleAccessToken) {
    return res.status(StatusCodes.UNAUTHORIZED).json({ error: 'User not authenticated: No access token provided.' });
  }

  // We still need CLIENT_ID and CLIENT_SECRET to instantiate the OAuth2 client object,
  // even if this instance is primarily used to set the access token for API calls.
  // These are used by the library for some internal mechanics or if you were to use it for token refresh (though TM should handle refresh).
  const oauth2Client = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET
    // No callback URL needed here as we are not initiating auth, just using a token
  );

  oauth2Client.setCredentials({
    access_token: googleAccessToken,
    // Note: We don't have the refresh token here. TypingMind is expected to manage token refresh.
    // If the access token is expired, Google API calls will fail, and TypingMind should ideally re-authenticate the user.
  });

  // Make OAuth2 client available in the request object
  (req as any).oauth2Client = oauth2Client;
  (req as any).googleAccessToken = googleAccessToken; // Also store the raw token if needed
  next();
};

// Apply this new middleware to all routes in this router
googleWorkspaceRouter.use(verifyGoogleAccessTokenAndSetClient);

// Placeholder for Drive routes (List, Read, Write, Search)
googleWorkspaceRouter.get('/drive/files', async (req: Request, res: Response) => {
  const oauth2Client = (req as any).oauth2Client;
  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  try {
    const listParams: any = {
      // Type as any for flexibility with query params
      pageSize: parseInt(req.query.pageSize as string) || 20,
      fields:
        'nextPageToken, files(id, name, mimeType, webViewLink, iconLink, modifiedTime, createdTime, owners, shared, capabilities)',
      orderBy: (req.query.orderBy as string) || 'modifiedTime desc',
      q: (req.query.q as string) || 'trashed=false',
      corpora: (req.query.corpora as string) || 'user',
      includeItemsFromAllDrives: req.query.includeItemsFromAllDrives === 'true',
      supportsAllDrives: true,
    };

    if (req.query.pageToken) {
      listParams.pageToken = req.query.pageToken as string;
    }

    const response = await drive.files.list(listParams);
    res.status(StatusCodes.OK).json(response.data);
  } catch (error: any) {
    console.error('Error listing drive files:', error);
    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
      return res.status(error.response.status).json({
        error:
          'Google API authorization error. The token might be expired or invalid. Please re-authenticate via TypingMind.',
        details: error.message,
      });
    }
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Failed to list files', details: error.message });
  }
});

// --- Add other Drive, Docs, Sheets, Slides routes here ---

// Example: Search files (including within Docs content if possible)
googleWorkspaceRouter.get('/drive/search', async (req: Request, res: Response) => {
  const oauth2Client = (req as any).oauth2Client;
  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  const query = req.query.q as string;

  if (!query) {
    return res.status(StatusCodes.BAD_REQUEST).json({ error: 'Search query (q) is required.' });
  }

  try {
    const searchParams: any = {
      q: query,
      pageSize: parseInt(req.query.pageSize as string) || 20,
      fields: 'nextPageToken, files(id, name, mimeType, webViewLink, iconLink, modifiedTime)',
      corpora: (req.query.corpora as string) || 'user',
      includeItemsFromAllDrives: req.query.includeItemsFromAllDrives === 'true',
      supportsAllDrives: true,
    };

    // Only add orderBy if it's explicitly provided by the client and is valid,
    // otherwise, let Google handle relevance-based ordering for search queries.
    if (req.query.orderBy) {
      searchParams.orderBy = req.query.orderBy as string;
    }

    if (req.query.pageToken) {
      searchParams.pageToken = req.query.pageToken as string;
    }

    const response = await drive.files.list(searchParams);
    res.status(StatusCodes.OK).json(response.data);
  } catch (error: any) {
    console.error('Error searching Drive:', error);
    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
      return res.status(error.response.status).json({
        error:
          'Google API authorization error. The token might be expired or invalid. Please re-authenticate via TypingMind.',
        details: error.message,
      });
    }
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Failed to search Drive', details: error.message });
  }
});

// Placeholder for Read File Content (Drive & Docs)
googleWorkspaceRouter.get('/drive/files/:fileId/content', async (req: Request, res: Response) => {
  const oauth2Client = (req as any).oauth2Client;
  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  const docs = google.docs({ version: 'v1', auth: oauth2Client });
  const fileId = req.params.fileId;

  try {
    // Get file metadata to determine type
    const metadataResponse = await drive.files.get({ fileId: fileId, fields: 'id, name, mimeType, webViewLink' });
    const mimeType = metadataResponse.data.mimeType;

    if (mimeType === 'application/vnd.google-apps.document') {
      const docResponse = await docs.documents.get({ documentId: fileId });
      // Basic text extraction from Google Doc
      let content = '';
      docResponse.data.body?.content?.forEach((item) => {
        item.paragraph?.elements?.forEach((elem) => {
          content += elem.textRun?.content || '';
        });
      });
      res
        .status(StatusCodes.OK)
        .json({ id: fileId, name: metadataResponse.data.name, mimeType, content, fullDoc: docResponse.data });
    } else if (
      mimeType &&
      (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml')
    ) {
      // For other text-based files, download directly
      const fileContentResponse = await drive.files.get({ fileId: fileId, alt: 'media' }, { responseType: 'text' });
      res
        .status(StatusCodes.OK)
        .json({ id: fileId, name: metadataResponse.data.name, mimeType, content: fileContentResponse.data });
    } else {
      // For binary files or other Google Workspace types, provide metadata and download link
      res.status(StatusCodes.OK).json({
        id: fileId,
        name: metadataResponse.data.name,
        mimeType,
        message: 'This file type content cannot be directly displayed. Use download endpoint.',
        webViewLink: metadataResponse.data.webViewLink,
      });
    }
  } catch (error: any) {
    console.error(`Error reading file ${fileId}:`, error);
    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
      return res.status(error.response.status).json({
        error:
          'Google API authorization error. The token might be expired or invalid. Please re-authenticate via TypingMind.',
        details: error.message,
      });
    }
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: `Failed to read file ${fileId}`, details: error.message });
  }
});

// Placeholder for Write/Update File Content (Drive & Docs)
googleWorkspaceRouter.post('/drive/files/:fileId/content', async (req: Request, res: Response) => {
  const oauth2Client = (req as any).oauth2Client;
  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  const docs = google.docs({ version: 'v1', auth: oauth2Client });
  const fileId = req.params.fileId;
  const { content, mimeType: newMimeType } = req.body; // mimeType for updating raw files

  if (typeof content !== 'string') {
    return res.status(StatusCodes.BAD_REQUEST).json({ error: 'Content must be a string.' });
  }

  try {
    const metadataResponse = await drive.files.get({ fileId: fileId, fields: 'mimeType' });
    const currentMimeType = metadataResponse.data.mimeType;

    if (currentMimeType === 'application/vnd.google-apps.document') {
      // For Google Docs, clear existing content and insert new content
      // This is a simplified update; for more complex edits, use batchUpdate with specific requests
      const document = await docs.documents.get({ documentId: fileId, fields: 'body' });
      const existingContentEndIndex =
        document.data.body?.content?.[document.data.body.content.length - 1]?.endIndex || 1;

      const requests: any[] = [];
      if (existingContentEndIndex > 1) {
        requests.push({
          deleteContentRange: {
            range: {
              startIndex: 1, // Start from the beginning of the document body
              endIndex: existingContentEndIndex - 1, // Delete up to the end of current content
            },
          },
        });
      }
      requests.push({
        insertText: {
          location: { index: 1 }, // Insert at the beginning
          text: content,
        },
      });
      await docs.documents.batchUpdate({ documentId: fileId, requestBody: { requests } });
      res.status(StatusCodes.OK).json({ message: 'Google Doc updated successfully.' });
    } else {
      // For other file types, update using Drive API v3 upload (overwrite)
      const media = {
        mimeType: newMimeType || currentMimeType, // Use newMimeType if provided, else current
        body: content,
      };
      await drive.files.update({ fileId: fileId, media: media });
      res.status(StatusCodes.OK).json({ message: 'File updated successfully.' });
    }
  } catch (error: any) {
    console.error(`Error writing to file ${fileId}:`, error);
    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
      return res.status(error.response.status).json({
        error:
          'Google API authorization error. The token might be expired or invalid. Please re-authenticate via TypingMind.',
        details: error.message,
      });
    }
    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json({ error: `Failed to write to file ${fileId}`, details: error.message });
  }
});

// Placeholder for Create File (Drive & Docs)
googleWorkspaceRouter.post('/drive/files', async (req: Request, res: Response) => {
  const oauth2Client = (req as any).oauth2Client;
  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  const docs = google.docs({ version: 'v1', auth: oauth2Client });
  const { name, mimeType, content, folderId } = req.body;

  if (!name || !mimeType) {
    return res.status(StatusCodes.BAD_REQUEST).json({ error: 'File name and mimeType are required.' });
  }

  try {
    const fileMetadata: any = {
      name: name,
      mimeType: mimeType,
    };
    if (folderId) {
      fileMetadata.parents = [folderId];
    }

    let createdFile;
    if (mimeType === 'application/vnd.google-apps.document') {
      // Create Google Doc
      const doc = await docs.documents.create({ requestBody: { title: name } });
      if (doc.data.documentId && folderId) {
        // If created as a Doc, and folderId is specified, move it (Drive API doesn't support parent on Docs.create)
        await drive.files.update({
          fileId: doc.data.documentId,
          addParents: folderId,
          removeParents: 'root', // Assuming it was created in root
          fields: 'id, parents',
        });
      }
      createdFile = {
        id: doc.data.documentId,
        name: name,
        mimeType: mimeType,
        webViewLink: `https://docs.google.com/document/d/${doc.data.documentId}/edit`,
      };
      // Optionally, add content to the new doc
      if (content && doc.data.documentId && typeof content === 'string') {
        await docs.documents.batchUpdate({
          documentId: doc.data.documentId,
          requestBody: {
            requests: [{ insertText: { location: { index: 1 }, text: content } }],
          },
        });
      }
    } else {
      // Create other file types (e.g., text file)
      const media = {
        mimeType: mimeType,
        body: content || '', // Content can be empty for some file types
      };
      const file = await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id, name, mimeType, webViewLink',
      });
      createdFile = file.data;
    }
    res.status(StatusCodes.CREATED).json(createdFile);
  } catch (error: any) {
    console.error('Error creating file:', error);
    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
      return res.status(error.response.status).json({
        error:
          'Google API authorization error. The token might be expired or invalid. Please re-authenticate via TypingMind.',
        details: error.message,
      });
    }
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Failed to create file', details: error.message });
  }
});
