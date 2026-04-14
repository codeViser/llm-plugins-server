import express, { NextFunction, Request, Response, Router } from 'express';
import { google } from 'googleapis';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

import { env } from '@/common/utils/envConfig';
import { buildGoogleAuthUrl, ensureValidOAuthClientForConnection, getConnectionPublicView } from '@/common/utils/googleConnectionVault';
import { createFormattedGoogleDoc, updateFormattedGoogleDoc } from '@/common/utils/googleDocsFormatter';

// Import PDF parsing library for PDF text extraction
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse');

// Import DOCX parsing library for Word document text extraction
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mammoth = require('mammoth');

// Import Excel parsing library for spreadsheet text extraction
import * as ExcelJS from 'exceljs';

export const googleWorkspaceRouter: Router = express.Router();

// New Middleware: Expects private server-issued Google Workspace connection token as Bearer token
export const verifyGoogleWorkspaceConnectionAndSetClient = async (req: Request, res: Response, next: NextFunction) => {
  // Accept token from custom header (primary) or Authorization Bearer (fallback).
  // Using a custom header avoids plugin-sandbox restrictions that strip Authorization.
  const xToken = (req.headers['x-connection-token'] as string | undefined)?.trim() || '';
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const deviceToken = xToken || bearerToken;

  if (!deviceToken) {
    return res
      .status(StatusCodes.UNAUTHORIZED)
      .json({ error: 'Workspace connection token missing.' });
  }

  try {
    const reqProtocol = ((req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim()) || req.protocol;
    const reqHost = req.get('host');
    if (!reqHost) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: 'Missing request host.' });
    }

    const { oauth2Client } = await ensureValidOAuthClientForConnection({
      deviceToken,
      reqProtocol,
      reqHost,
      expectedAppType: 'workspace',
    });

    (req as any).oauth2Client = oauth2Client;
    (req as any).workspaceDeviceToken = deviceToken;
    next();
  } catch (error: any) {
    return res.status(StatusCodes.UNAUTHORIZED).json({
      error: error.message || 'Invalid or expired Workspace connection token.',
    });
  }
};

googleWorkspaceRouter.get('/auth/start', (req: Request, res: Response) => {
  const reqProtocol = ((req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim()) || req.protocol;
  const reqHost = req.get('host');
  if (!reqHost) {
    return res.status(StatusCodes.BAD_REQUEST).send('Missing request host');
  }
  const authUrl = buildGoogleAuthUrl({ reqProtocol, reqHost, appType: 'workspace', mode: 'manual' });
  res.redirect(authUrl);
});

googleWorkspaceRouter.get('/auth/status', (req: Request, res: Response) => {
  const xToken = (req.headers['x-connection-token'] as string | undefined)?.trim() || '';
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const deviceToken = xToken || bearerToken;
  if (!deviceToken) {
    return res.status(StatusCodes.UNAUTHORIZED).json({ error: 'Workspace connection token missing.' });
  }
  const connection = getConnectionPublicView(deviceToken);
  if (!connection || connection.appType !== 'workspace') {
    return res.status(StatusCodes.NOT_FOUND).json({ error: 'Workspace connection not found.' });
  }
  return res.status(StatusCodes.OK).json({ ok: true, connection });
});

// Apply this new middleware to all operational routes in this router
googleWorkspaceRouter.use(verifyGoogleWorkspaceConnectionAndSetClient);

// Schemas for validation
const listFilesSchema = z.object({
  query: z.object({
    pageSize: z.string().regex(/^\d+$/).transform(Number).optional(),
    orderBy: z.string().optional(),
    q: z.string().optional(),
    corpora: z.string().optional(),
    includeItemsFromAllDrives: z
      .string()
      .transform((v) => v === 'true')
      .optional(),
    pageToken: z.string().optional(),
  }),
});

const searchFilesSchema = z.object({
  query: z.object({
    q: z.string().min(1, { message: 'Search query (q) is required.' }),
    pageSize: z.string().regex(/^\d+$/).transform(Number).optional(),
    pageToken: z.string().optional(),
    orderBy: z.string().optional(),
    corpora: z.string().optional(),
    includeItemsFromAllDrives: z
      .string()
      .transform((v) => v === 'true')
      .optional(),
  }),
});

const fileIdSchema = z.object({
  params: z.object({
    fileId: z.string(),
  }),
});

const createFileSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    mimeType: z.string().min(1),
    content: z.string().optional(),
    folderId: z.string().optional(),
    useFormatting: z.boolean().optional(),
    category: z.string().optional(),
    addHeaders: z.boolean().optional(),
  }),
});

const updateFileSchema = z.object({
  params: z.object({
    fileId: z.string(),
  }),
  body: z.object({
    content: z.string(),
    mimeType: z.string().optional(), // For non-GDoc files
    useFormatting: z.boolean().optional(),
    category: z.string().optional(),
    replaceContent: z.boolean().optional(),
    addHeaders: z.boolean().optional(),
  }),
});

// Placeholder for Drive routes (List, Read, Write, Search)
googleWorkspaceRouter.get('/drive/files', async (req: Request, res: Response) => {
  try {
    const { query } = listFilesSchema.parse(req);
    const oauth2Client = (req as any).oauth2Client;
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    const listParams: any = {
      pageSize: query.pageSize || 20,
      fields:
        'nextPageToken, files(id, name, mimeType, webViewLink, iconLink, modifiedTime, createdTime, owners, shared, capabilities)',
      orderBy: query.orderBy || 'modifiedTime desc',
      q: query.q || 'trashed=false',
      corpora: query.corpora || 'user',
      includeItemsFromAllDrives: query.includeItemsFromAllDrives || false,
      supportsAllDrives: true,
    };

    if (query.pageToken) {
      listParams.pageToken = query.pageToken;
    }

    const response = await drive.files.list(listParams);
    res.status(StatusCodes.OK).json(response.data);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid input', details: error.errors });
    }
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
  try {
    const { query } = searchFilesSchema.parse(req);
    const oauth2Client = (req as any).oauth2Client;
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    const searchParams: any = {
      q: query.q,
      pageSize: query.pageSize || 20,
      fields: 'nextPageToken, files(id, name, mimeType, webViewLink, iconLink, modifiedTime)',
      corpora: query.corpora || 'user',
      includeItemsFromAllDrives: query.includeItemsFromAllDrives || false,
      supportsAllDrives: true,
    };

    if (query.orderBy) {
      searchParams.orderBy = query.orderBy;
    }

    if (query.pageToken) {
      searchParams.pageToken = query.pageToken;
    }

    const response = await drive.files.list(searchParams);
    res.status(StatusCodes.OK).json(response.data);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid input', details: error.errors });
    }
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
  try {
    const { params } = fileIdSchema.parse(req);
    const fileId = params.fileId;
    const oauth2Client = (req as any).oauth2Client;
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const docs = google.docs({ version: 'v1', auth: oauth2Client });

    // Get file metadata to determine type
    const metadataResponse = await drive.files.get({ fileId: fileId, fields: 'id, name, mimeType, webViewLink' });
    const mimeType = metadataResponse.data.mimeType;

    if (mimeType === 'application/vnd.google-apps.document') {
      // Handle Google Docs using the Docs API
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
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      // Handle .docx files using Drive API export method
      console.log(`Attempting to export .docx file (${fileId}) as text`);
      try {
        const exportResponse = await drive.files.export(
          { fileId: fileId, mimeType: 'text/plain' },
          { responseType: 'text' }
        );
        console.log(`Successfully exported .docx file (${fileId}) as text`);
        res.status(StatusCodes.OK).json({
          id: fileId,
          name: metadataResponse.data.name,
          mimeType,
          content: exportResponse.data,
          webViewLink: metadataResponse.data.webViewLink,
          message: 'Content extracted from .docx file',
        });
      } catch (exportError: any) {
        // If export fails (e.g., for non-Google Workspace files), try parsing with mammoth
        console.warn(
          `Export failed for .docx file ${fileId}, attempting binary download and parsing:`,
          exportError.message
        );
        try {
          // Download the .docx file as binary data
          const fileContentResponse = await drive.files.get(
            { fileId: fileId, alt: 'media' },
            { responseType: 'arraybuffer' }
          );

          // Use mammoth to extract text from the .docx file
          const result = await mammoth.extractRawText({ buffer: Buffer.from(fileContentResponse.data as ArrayBuffer) });

          console.log(`Successfully extracted text from .docx file ${fileId} using mammoth`);
          res.status(StatusCodes.OK).json({
            id: fileId,
            name: metadataResponse.data.name,
            mimeType,
            content: result.value,
            webViewLink: metadataResponse.data.webViewLink,
            message: 'Content extracted from .docx file using document parser',
            warnings: result.messages.length > 0 ? result.messages.map((msg: any) => msg.message) : undefined,
          });
        } catch (parseError: any) {
          console.error(`Both export and mammoth parsing failed for .docx file ${fileId}:`, parseError.message);
          res.status(StatusCodes.OK).json({
            id: fileId,
            name: metadataResponse.data.name,
            mimeType,
            message:
              'This .docx file content cannot be directly displayed as text. The file may need to be converted to Google Docs format first, or downloaded for local processing.',
            webViewLink: metadataResponse.data.webViewLink,
            error: `Export failed: ${exportError.message}, Document parsing failed: ${parseError.message}`,
            recommendation:
              'Try uploading this file as a Google Doc for better text extraction support, or use drive_download_file for raw access',
          });
        }
      }
    } else if (
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || // .xlsx
      mimeType === 'application/vnd.ms-excel' || // .xls
      mimeType === 'application/vnd.ms-excel.sheet.macroEnabled.12' || // .xlsm
      mimeType === 'application/vnd.oasis.opendocument.spreadsheet' // .ods
    ) {
      // Handle Excel files using Drive API export method with ExcelJS fallback
      console.log(`Attempting to export Excel file (${fileId}) as text`);
      try {
        const exportResponse = await drive.files.export(
          { fileId: fileId, mimeType: 'text/plain' },
          { responseType: 'text' }
        );
        console.log(`Successfully exported Excel file (${fileId}) as text`);
        res.status(StatusCodes.OK).json({
          id: fileId,
          name: metadataResponse.data.name,
          mimeType,
          content: exportResponse.data,
          webViewLink: metadataResponse.data.webViewLink,
          message: 'Content extracted from Excel file',
        });
      } catch (exportError: any) {
        // If export fails, try parsing with ExcelJS (for .xlsx and .xlsm files)
        if (
          mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
          mimeType === 'application/vnd.ms-excel.sheet.macroEnabled.12'
        ) {
          console.warn(
            `Export failed for Excel file ${fileId}, attempting binary download and parsing:`,
            exportError.message
          );
          try {
            // Download the Excel file as binary data
            const fileContentResponse = await drive.files.get(
              { fileId: fileId, alt: 'media' },
              { responseType: 'arraybuffer' }
            );

            // Use ExcelJS to parse the Excel file
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(fileContentResponse.data as ArrayBuffer);

            let content = '';
            let sheetCount = 0;
            let totalRows = 0;

            // Extract text from all sheets
            workbook.eachSheet((worksheet) => {
              sheetCount++;
              content += `=== Sheet: ${worksheet.name} ===\n`;

              worksheet.eachRow((row) => {
                const rowValues: string[] = [];
                row.eachCell((cell, colNumber) => {
                  let cellValue = '';
                  if (cell.value !== null && cell.value !== undefined) {
                    // Handle different cell value types
                    if (typeof cell.value === 'object' && 'formula' in cell.value) {
                      cellValue = `=${cell.value.formula}`;
                    } else if (typeof cell.value === 'object' && 'richText' in cell.value) {
                      cellValue = cell.value.richText.map((rt: any) => rt.text).join('');
                    } else {
                      cellValue = String(cell.value);
                    }
                  }
                  rowValues[colNumber - 1] = cellValue;
                });

                // Join row values with tabs, filtering out empty cells at the end
                const trimmedRowValues = rowValues.filter((val, idx) => {
                  // Keep cell if it has content or if there are non-empty cells after it
                  return val || rowValues.slice(idx + 1).some((v) => v);
                });

                if (trimmedRowValues.length > 0 && trimmedRowValues.some((val) => val)) {
                  content += trimmedRowValues.join('\t') + '\n';
                  totalRows++;
                }
              });
              content += '\n';
            });

            console.log(
              `Successfully extracted text from Excel file ${fileId} using ExcelJS: ${sheetCount} sheets, ${totalRows} rows`
            );
            res.status(StatusCodes.OK).json({
              id: fileId,
              name: metadataResponse.data.name,
              mimeType,
              content: content.trim(),
              webViewLink: metadataResponse.data.webViewLink,
              message: 'Content extracted from Excel file using spreadsheet parser',
              excelInfo: {
                sheets: sheetCount,
                totalRows: totalRows,
                extractionMethod: 'ExcelJS',
              },
            });
          } catch (parseError: any) {
            console.error(`Both export and ExcelJS parsing failed for Excel file ${fileId}:`, parseError.message);
            res.status(StatusCodes.OK).json({
              id: fileId,
              name: metadataResponse.data.name,
              mimeType,
              message:
                'This Excel file content cannot be directly displayed as text. The file may need to be converted to Google Sheets format first, or downloaded for local processing.',
              webViewLink: metadataResponse.data.webViewLink,
              error: `Export failed: ${exportError.message}, Spreadsheet parsing failed: ${parseError.message}`,
              recommendation:
                'Try uploading this file as a Google Sheet for better text extraction support, or use drive_download_file for raw access',
            });
          }
        } else {
          // For .xls and .ods files, just provide error message since ExcelJS doesn't handle them well
          console.warn(`Export failed for legacy Excel file ${fileId} (${mimeType}):`, exportError.message);
          res.status(StatusCodes.OK).json({
            id: fileId,
            name: metadataResponse.data.name,
            mimeType,
            message:
              'This legacy Excel file format cannot be directly displayed as text. Please convert to .xlsx format or upload as a Google Sheet.',
            webViewLink: metadataResponse.data.webViewLink,
            error: `Export to text failed: ${exportError.message}`,
            recommendation: 'Convert to modern .xlsx format or upload as Google Sheets for better compatibility',
          });
        }
      }
    } else if (
      mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' || // .pptx
      mimeType === 'application/msword' || // .doc
      mimeType === 'application/vnd.ms-powerpoint' || // .ppt
      mimeType === 'application/vnd.ms-word.document.macroEnabled.12' || // .docm
      mimeType === 'application/vnd.ms-powerpoint.presentation.macroEnabled.12' || // .pptm
      mimeType === 'application/rtf' || // Rich Text Format
      mimeType === 'application/vnd.oasis.opendocument.text' || // .odt
      mimeType === 'application/vnd.oasis.opendocument.presentation' // .odp
    ) {
      // Handle other Microsoft Office and document files using Drive API export method
      console.log(`Attempting to export ${mimeType} file (${fileId}) as text`);
      try {
        const exportResponse = await drive.files.export(
          { fileId: fileId, mimeType: 'text/plain' },
          { responseType: 'text' }
        );
        console.log(`Successfully exported ${mimeType} file (${fileId}) as text`);
        res.status(StatusCodes.OK).json({
          id: fileId,
          name: metadataResponse.data.name,
          mimeType,
          content: exportResponse.data,
          webViewLink: metadataResponse.data.webViewLink,
          message: 'Content extracted from document file',
        });
      } catch (exportError: any) {
        // If export fails, provide metadata and download link
        console.warn(`Export failed for document file ${fileId} (${mimeType}):`, exportError.message);
        res.status(StatusCodes.OK).json({
          id: fileId,
          name: metadataResponse.data.name,
          mimeType,
          message:
            'This document file content cannot be directly displayed as text. The file may need to be converted to Google Workspace format first, or downloaded for local processing.',
          webViewLink: metadataResponse.data.webViewLink,
          error: `Export to text failed: ${exportError.message}`,
          supportedFormats: 'This file type may be readable if uploaded as a Google Workspace document',
        });
      }
    } else if (
      mimeType &&
      (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml')
    ) {
      // For other text-based files, download directly
      const fileContentResponse = await drive.files.get({ fileId: fileId, alt: 'media' }, { responseType: 'text' });
      res
        .status(StatusCodes.OK)
        .json({ id: fileId, name: metadataResponse.data.name, mimeType, content: fileContentResponse.data });
    } else if (mimeType === 'application/pdf') {
      // Handle PDF files using pdf-parse library
      console.log(`Attempting to extract text from PDF file (${fileId})`);
      try {
        // Download PDF binary data from Google Drive
        const pdfResponse = await drive.files.get({ fileId: fileId, alt: 'media' }, { responseType: 'arraybuffer' });

        // Parse PDF content to extract text
        const pdfData = await pdfParse(Buffer.from(pdfResponse.data as ArrayBuffer));

        console.log(`Successfully extracted text from PDF file (${fileId}), ${pdfData.numpages} pages`);
        res.status(StatusCodes.OK).json({
          id: fileId,
          name: metadataResponse.data.name,
          mimeType,
          content: pdfData.text,
          webViewLink: metadataResponse.data.webViewLink,
          message: 'Text content extracted from PDF file',
          pdfInfo: {
            pages: pdfData.numpages,
            info: pdfData.info,
          },
        });
      } catch (pdfError: any) {
        console.warn(`PDF text extraction failed for file ${fileId}:`, pdfError.message);
        res.status(StatusCodes.OK).json({
          id: fileId,
          name: metadataResponse.data.name,
          mimeType,
          message:
            'PDF text extraction failed. This may be an image-based PDF or corrupted file. Download the file directly for manual processing.',
          webViewLink: metadataResponse.data.webViewLink,
          error: `PDF parsing failed: ${pdfError.message}`,
          recommendation: 'For image-based PDFs, consider using OCR tools or converting to text format',
        });
      }
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
    if (error instanceof z.ZodError) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid input', details: error.errors });
    }
    const fileId = req.params.fileId; // Fallback for error message if parsing fails
    console.error(`Error reading file ${fileId}:`, error);
    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
      return res.status(error.response.status).json({
        error:
          'Google API authorization error. The token might be expired or invalid. Please re-authenticate via TypingMind.',
        details: error.message,
      });
    }

    // Provide more specific error messages based on the error type
    let errorMessage = `Failed to read file ${fileId}`;
    if (error.message.includes('notFound')) {
      errorMessage = `File with ID ${fileId} was not found or you don't have permission to access it`;
    } else if (error.message.includes('quotaExceeded')) {
      errorMessage = `API quota exceeded. Please try again later`;
    } else if (error.message.includes('rateLimitExceeded')) {
      errorMessage = `Rate limit exceeded. Please try again later`;
    }

    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: errorMessage, details: error.message });
  }
});

// Raw file download endpoint - streams binary file data to client
googleWorkspaceRouter.get('/drive/files/:fileId/download', async (req: Request, res: Response) => {
  try {
    const { params } = fileIdSchema.parse(req);
    const fileId = params.fileId;
    const oauth2Client = (req as any).oauth2Client;
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    // Get file metadata first
    const metadataResponse = await drive.files.get({
      fileId: fileId,
      fields: 'id, name, mimeType, size, webViewLink',
    });

    console.log(
      `Initiating raw download for file ${fileId}: ${metadataResponse.data.name} (${metadataResponse.data.mimeType})`
    );

    // Download raw file data as stream
    const fileResponse = await drive.files.get({ fileId: fileId, alt: 'media' }, { responseType: 'stream' });

    // Set appropriate headers for file download
    const mimeType = metadataResponse.data.mimeType || 'application/octet-stream';
    const fileName = metadataResponse.data.name || `file_${fileId}`;
    const fileSize = metadataResponse.data.size;

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    // Set content length if available
    if (fileSize) {
      res.setHeader('Content-Length', fileSize);
    }

    // Add custom headers with file metadata
    res.setHeader('X-File-Name', fileName);
    res.setHeader('X-File-ID', fileId);
    res.setHeader('X-File-MIME-Type', mimeType);

    console.log(`Streaming raw file data for ${fileId}: ${fileName}`);

    // Stream the file data directly to the response
    fileResponse.data.pipe(res);

    // Handle stream errors
    fileResponse.data.on('error', (streamError: any) => {
      console.error(`Stream error for file ${fileId}:`, streamError);
      if (!res.headersSent) {
        res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
          error: `Failed to stream file ${fileId}`,
          details: streamError.message,
        });
      }
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid input', details: error.errors });
    }
    const fileId = req.params.fileId; // Fallback for error message if parsing fails
    console.error(`Error downloading file ${fileId}:`, error);

    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
      return res.status(error.response.status).json({
        error:
          'Google API authorization error. The token might be expired or invalid. Please re-authenticate via TypingMind.',
        details: error.message,
      });
    }

    // Provide more specific error messages
    let errorMessage = `Failed to download file ${fileId}`;
    if (error.message.includes('notFound')) {
      errorMessage = `File with ID ${fileId} was not found or you don't have permission to download it`;
    } else if (error.message.includes('quotaExceeded')) {
      errorMessage = `API quota exceeded. Please try again later`;
    } else if (error.message.includes('rateLimitExceeded')) {
      errorMessage = `Rate limit exceeded. Please try again later`;
    } else if (error.message.includes('downloadNotSupported')) {
      errorMessage = `This file type cannot be downloaded directly. Try exporting to a supported format first`;
    }

    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      error: errorMessage,
      details: error.message,
      recommendation: 'For Google Workspace files, consider using drive_read_file_content for text extraction instead',
    });
  }
});

// Write/Update File Content (Drive & Docs) with enhanced formatting support
googleWorkspaceRouter.post('/drive/files/:fileId/content', async (req: Request, res: Response) => {
  try {
    const { params, body } = updateFileSchema.parse(req);
    const fileId = params.fileId;
    const oauth2Client = (req as any).oauth2Client;
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const docs = google.docs({ version: 'v1', auth: oauth2Client });
    const { content, mimeType: newMimeType, useFormatting, category, replaceContent, addHeaders } = body;

    const metadataResponse = await drive.files.get({ fileId: fileId, fields: 'mimeType' });
    const currentMimeType = metadataResponse.data.mimeType;

    if (currentMimeType === 'application/vnd.google-apps.document') {
      // For Google Docs, use enhanced formatting if requested
      if (useFormatting) {
        console.log(`Updating Google Doc with formatting: ${fileId}`);
        try {
          if (replaceContent) {
            // Replace entire document content with formatted content
            const document = await docs.documents.get({ documentId: fileId, fields: 'body' });
            const existingContentEndIndex =
              document.data.body?.content?.[document.data.body.content.length - 1]?.endIndex || 1;

            const requests: any[] = [];
            if (existingContentEndIndex > 1) {
              requests.push({
                deleteContentRange: {
                  range: {
                    startIndex: 1,
                    endIndex: existingContentEndIndex - 1,
                  },
                },
              });
            }

            // Use formatted content creation at the beginning
            const { convertToGoogleDocsRequests, parseContent } = await import('@/common/utils/googleDocsFormatter');
            const parsedContent = parseContent(content);
            const contentRequests = convertToGoogleDocsRequests(parsedContent, 1);
            requests.push(...contentRequests);

            await docs.documents.batchUpdate({ documentId: fileId, requestBody: { requests } });
          } else {
            // Append formatted content to existing document
            await updateFormattedGoogleDoc(docs, fileId, content, category || 'Update', addHeaders !== false);
          }
          res.status(StatusCodes.OK).json({ message: 'Google Doc updated with formatting successfully.' });
        } catch (formattingError: any) {
          console.warn(`Formatted update failed, falling back to basic update:`, formattingError.message);
          // Fall back to basic update
          const document = await docs.documents.get({ documentId: fileId, fields: 'body' });
          const existingContentEndIndex =
            document.data.body?.content?.[document.data.body.content.length - 1]?.endIndex || 1;

          const requests: any[] = [];
          if (replaceContent && existingContentEndIndex > 1) {
            requests.push({
              deleteContentRange: {
                range: {
                  startIndex: 1,
                  endIndex: existingContentEndIndex - 1,
                },
              },
            });
            requests.push({
              insertText: {
                location: { index: 1 },
                text: content,
              },
            });
          } else {
            requests.push({
              insertText: {
                location: { index: existingContentEndIndex },
                text: `\n${content}`,
              },
            });
          }
          await docs.documents.batchUpdate({ documentId: fileId, requestBody: { requests } });
          res.status(StatusCodes.OK).json({ message: 'Google Doc updated successfully (basic formatting).' });
        }
      } else {
        // Basic Google Doc update (original logic)
        const document = await docs.documents.get({ documentId: fileId, fields: 'body' });
        const existingContentEndIndex =
          document.data.body?.content?.[document.data.body.content.length - 1]?.endIndex || 1;

        const requests: any[] = [];
        if (replaceContent && existingContentEndIndex > 1) {
          requests.push({
            deleteContentRange: {
              range: {
                startIndex: 1,
                endIndex: existingContentEndIndex - 1,
              },
            },
          });
          requests.push({
            insertText: {
              location: { index: 1 },
              text: content,
            },
          });
        } else {
          requests.push({
            insertText: {
              location: { index: existingContentEndIndex },
              text: replaceContent ? content : `\n${content}`,
            },
          });
        }
        await docs.documents.batchUpdate({ documentId: fileId, requestBody: { requests } });
        res.status(StatusCodes.OK).json({ message: 'Google Doc updated successfully.' });
      }
    } else {
      // For other file types, update using Drive API v3 upload (overwrite)
      const media = {
        mimeType: newMimeType || currentMimeType || undefined,
        body: content,
      };
      await drive.files.update({ fileId: fileId, media: media });
      res.status(StatusCodes.OK).json({ message: 'File updated successfully.' });
    }
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid input', details: error.errors });
    }
    const fileId = req.params.fileId; // Fallback for error message if parsing fails
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

// Create File (Drive & Docs) with enhanced formatting support
googleWorkspaceRouter.post('/drive/files', async (req: Request, res: Response) => {
  try {
    const { body } = createFileSchema.parse(req);
    const oauth2Client = (req as any).oauth2Client;
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const docs = google.docs({ version: 'v1', auth: oauth2Client });
    const { name, mimeType, content, folderId, useFormatting, category, addHeaders } = body;

    const fileMetadata: any = {
      name: name,
      mimeType: mimeType,
    };
    if (folderId) {
      fileMetadata.parents = [folderId];
    }

    let createdFile;
    if (mimeType === 'application/vnd.google-apps.document') {
      // Check if enhanced formatting should be used
      if (useFormatting && content && typeof content === 'string') {
        console.log(`Creating formatted Google Doc: ${name}`);
        try {
          createdFile = await createFormattedGoogleDoc(
            docs,
            drive,
            name,
            content,
            folderId,
            category || 'Document',
            addHeaders !== false
          );
        } catch (formattingError: any) {
          console.warn(`Formatted creation failed, falling back to basic creation:`, formattingError.message);
          // Fall back to basic creation if formatting fails
          const doc = await docs.documents.create({ requestBody: { title: name } });
          if (doc.data.documentId && folderId) {
            await drive.files.update({
              fileId: doc.data.documentId,
              addParents: folderId,
              removeParents: 'root',
              fields: 'id, parents',
            });
          }
          createdFile = {
            id: doc.data.documentId,
            name: name,
            mimeType: mimeType,
            webViewLink: `https://docs.google.com/document/d/${doc.data.documentId}/edit`,
          };
          // Add content without formatting
          if (doc.data.documentId) {
            await docs.documents.batchUpdate({
              documentId: doc.data.documentId,
              requestBody: {
                requests: [{ insertText: { location: { index: 1 }, text: content } }],
              },
            });
          }
        }
      } else {
        // Create Google Doc with basic formatting (original logic)
        const doc = await docs.documents.create({ requestBody: { title: name } });
        if (doc.data.documentId && folderId) {
          await drive.files.update({
            fileId: doc.data.documentId,
            addParents: folderId,
            removeParents: 'root',
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
    if (error instanceof z.ZodError) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid input', details: error.errors });
    }
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
