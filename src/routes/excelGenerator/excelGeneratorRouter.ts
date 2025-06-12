import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import * as ExcelJS from 'exceljs';
import express, { Request, Response, Router } from 'express';
import fs from 'fs';
import { StatusCodes } from 'http-status-codes';
import cron from 'node-cron';
import path from 'path';
import { z } from 'zod';

import { createApiRequestBody } from '@/api-docs/openAPIRequestBuilders';
import { createApiResponse } from '@/api-docs/openAPIResponseBuilders';
import { ResponseStatus, ServiceResponse } from '@/common/models/serviceResponse';
import { handleServiceResponse } from '@/common/utils/httpHandlers';

import { ExcelGeneratorRequestBodySchema, ExcelGeneratorResponseSchema } from './excelGeneratorModel';
export const COMPRESS = true;
export const excelGeneratorRegistry = new OpenAPIRegistry();
excelGeneratorRegistry.register('ExcelGenerator', ExcelGeneratorResponseSchema);
excelGeneratorRegistry.registerPath({
  method: 'post',
  path: '/excel-generator/generate',
  tags: ['Excel Generator'],
  request: {
    body: createApiRequestBody(ExcelGeneratorRequestBodySchema, 'application/json'),
  },
  responses: createApiResponse(ExcelGeneratorResponseSchema, 'Success'),
});

// Create folder to contains generated files
const exportsDir = path.join(__dirname, '../../..', 'excel-exports');

// Ensure the exports directory exists
if (!fs.existsSync(exportsDir)) {
  fs.mkdirSync(exportsDir, { recursive: true });
}

// Cron job to delete files older than 1 hour
cron.schedule('0 * * * *', () => {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  // Read the files in the exports directory
  fs.readdir(exportsDir, (err, files) => {
    if (err) {
      console.error(`Error reading directory ${exportsDir}:`, err);
      return;
    }

    files.forEach((file) => {
      const filePath = path.join(exportsDir, file);
      fs.stat(filePath, (err, stats) => {
        if (err) {
          console.error(`Error getting stats for file ${filePath}:`, err);
          return;
        }

        // Check if the file is older than 1 hour
        if (now - stats.mtime.getTime() > oneHour) {
          fs.unlink(filePath, (err) => {
            if (err) {
              console.error(`Error deleting file ${filePath}:`, err);
            } else {
              console.log(`Deleted file: ${filePath}`);
            }
          });
        }
      });
    });
  });
});

const serverUrl = process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';

// This interface now matches the Zod schema's output type
interface SheetData {
  sheetName: string;
  tables: {
    title?: string;
    startCell?: string;
    rows: {
      type: 'static_value' | 'formula';
      value: string;
    }[][];
    columns: {
      name: string;
      type: 'string' | 'number' | 'boolean' | 'percent' | 'currency' | 'date';
      format?: string;
    }[];
    skipHeader?: boolean;
  }[];
}

interface ExcelConfig {
  fontFamily: string;
  tableTitleFontSize: number;
  headerFontSize: number;
  fontSize: number;
  autoFitColumnWidth: boolean;
  autoFilter: boolean;
  borderStyle: ExcelJS.BorderStyle | null;
  wrapText: boolean;
}

const DEFAULT_EXCEL_CONFIGS: ExcelConfig = {
  fontFamily: 'Calibri',
  tableTitleFontSize: 13,
  headerFontSize: 11,
  fontSize: 11,
  autoFitColumnWidth: true,
  autoFilter: false,
  wrapText: false,
  borderStyle: null,
};

// Helper function to convert column letter (e.g., 'A') to column index (e.g., 1)
function columnLetterToNumber(letter: string): number {
  let column = 0;
  for (let i = 0; i < letter.length; i++) {
    column = column * 26 + letter.charCodeAt(i) - 'A'.charCodeAt(0) + 1;
  }
  return column;
}

// Helper function to auto-fit column widths based on content
function autoFitColumns(
  worksheet: ExcelJS.Worksheet,
  startRow: number,
  rows: { type: string; value: string }[][],
  numColumns: number,
  startCol: number
): void {
  for (let colIdx = 0; colIdx < numColumns; colIdx++) {
    let maxLength = 0;

    // Check the max length of the content in the column
    rows.forEach((row) => {
      const cellData = row[colIdx];
      if (cellData != null && cellData.value != null) {
        const cellLength = String(cellData.value).length;
        maxLength = Math.max(maxLength, cellLength);
      }
    });

    // Account for the header row
    const headerCell = worksheet.getCell(startRow, startCol + colIdx).value;
    if (headerCell != null) {
      const headerLength = String(headerCell).length;
      maxLength = Math.max(maxLength, headerLength);
    }

    // Set the column width
    worksheet.getColumn(startCol + colIdx).width = maxLength + 2; // Adding some padding
  }
}

export function execGenExcelFuncs(sheetsData: SheetData[], excelConfigs: ExcelConfig): string {
  const workbook = new ExcelJS.Workbook();
  const borderConfigs = excelConfigs.borderStyle
    ? {
        top: { style: excelConfigs.borderStyle },
        left: { style: excelConfigs.borderStyle },
        bottom: { style: excelConfigs.borderStyle },
        right: { style: excelConfigs.borderStyle },
      }
    : {};
  const titleAlignmentConfigs: any = {
    horizontal: 'center',
    vertical: 'middle',
    wrapText: excelConfigs.wrapText,
  };
  const titleFontConfigs: any = {
    name: excelConfigs.fontFamily,
    bold: true,
    size: excelConfigs.tableTitleFontSize,
  };
  const headerAligmentConfigs: any = {
    wrapText: excelConfigs.wrapText,
    horizontal: 'center',
    vertical: 'middle',
  };
  const headerFontConfigs: any = {
    name: excelConfigs.fontFamily,
    bold: true,
    size: excelConfigs.headerFontSize,
  };
  const cellAlignmentConfigs: any = {
    wrapText: excelConfigs.wrapText,
  };
  const cellFontConfigs: any = {
    name: excelConfigs.fontFamily,
    size: excelConfigs.fontSize,
  };

  sheetsData.forEach(({ sheetName, tables }) => {
    const worksheet = workbook.addWorksheet(sheetName);
    tables.forEach(({ startCell = 'A1', title, rows = [], columns = [], skipHeader }) => {
      const startCol = columnLetterToNumber(startCell);
      const startRow = parseInt(startCell.slice(1));
      let rowIndex = startRow;

      if (title) {
        const titleCell = worksheet.getCell(rowIndex, startCol);
        titleCell.value = title;
        worksheet.mergeCells(rowIndex, startCol, rowIndex, startCol + columns.length - 1);
        titleCell.alignment = titleAlignmentConfigs;
        titleCell.font = titleFontConfigs;
        titleCell.border = borderConfigs;
        rowIndex++;
      }

      const headerRowForFilter = skipHeader ? startRow : startRow + 1;

      if (!skipHeader && columns) {
        columns.forEach((col, colIdx) => {
          const cell = worksheet.getCell(rowIndex, startCol + colIdx);
          cell.value = col.name;
          cell.alignment = headerAligmentConfigs;
          cell.font = headerFontConfigs;
          cell.border = borderConfigs;
        });
        rowIndex++;
      }

      const columnTypes = columns.map((col) => col.type);
      const columnFormats = columns.map((col) => {
        let format: string | undefined = undefined;
        switch (col.type) {
          case 'number':
            format = col.format;
            break;
          case 'percent':
            format = col.format || '0.00%';
            break;
          case 'currency':
            format = col.format || '$#,##0';
            break;
          case 'date':
            format = col.format;
            break;
        }
        return format;
      });

      rows.forEach((rowData) => {
        rowData.forEach((cellData, colIdx) => {
          const { type = 'static_value', value } = cellData;
          const valueType = columnTypes[colIdx];
          const format = columnFormats[colIdx];
          const cell = worksheet.getCell(rowIndex, startCol + colIdx);

          if (type === 'formula') {
            cell.value = { formula: value };
            if (valueType === 'percent' || valueType === 'currency' || valueType === 'number' || valueType === 'date') {
              cell.numFmt = format;
            }
          } else {
            switch (valueType) {
              case 'number':
                cell.value = !isNaN(Number(value)) ? Number(value) : value;
                cell.numFmt = format || '0';
                break;
              case 'boolean':
                cell.value = Boolean(value);
                break;
              case 'date':
                cell.value = new Date(value);
                cell.numFmt = format || 'yyyy-mm-dd';
                break;
              case 'percent':
                cell.value = !isNaN(Number(value)) ? Number(value) / 100 : value;
                cell.numFmt = format || '0.00%';
                break;
              case 'currency':
                cell.value = !isNaN(Number(value)) ? Number(value) : value;
                cell.numFmt = format || '$#,##0.00';
                break;
              default:
                cell.value = String(value);
                break;
            }
          }
          cell.font = cellFontConfigs;
          cell.border = borderConfigs;
          cell.alignment = cellAlignmentConfigs;
        });
        rowIndex++;
      });

      if (excelConfigs.autoFilter) {
        worksheet.autoFilter = {
          from: { row: headerRowForFilter, column: startCol },
          to: { row: rowIndex - 1, column: startCol + columns.length - 1 },
        };
      }

      if (excelConfigs.autoFitColumnWidth) {
        autoFitColumns(worksheet, headerRowForFilter, rows, columns.length, startCol);
      }
    });
  });

  const fileName = `excel-file-${new Date().toISOString().replace(/\D/gi, '')}.xlsx`;
  const filePath = path.join(exportsDir, fileName);

  workbook.xlsx.writeFile(filePath).catch((err) => {
    console.error('Error writing Excel file', err);
  });

  return fileName;
}

export const excelGeneratorRouter: Router = (() => {
  const router = express.Router();
  router.use('/downloads', express.static(exportsDir));

  router.post('/generate', async (_req: Request, res: Response) => {
    try {
      const { sheetsData, excelConfigs } = ExcelGeneratorRequestBodySchema.parse(_req.body);

      const finalConfig: ExcelConfig = {
        ...DEFAULT_EXCEL_CONFIGS,
        ...excelConfigs,
        borderStyle: excelConfigs?.borderStyle === 'none' ? null : (excelConfigs?.borderStyle ?? null),
      };

      const fileName = execGenExcelFuncs(sheetsData, finalConfig);

      const serviceResponse = new ServiceResponse(
        ResponseStatus.Success,
        'File generated successfully',
        {
          downloadUrl: `${serverUrl}/excel-generator/downloads/${fileName}`,
        },
        StatusCodes.OK
      );
      handleServiceResponse(serviceResponse, res);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        const serviceResponse = new ServiceResponse(
          ResponseStatus.Failed,
          'Invalid input',
          { errors: error.errors },
          StatusCodes.BAD_REQUEST
        );
        return handleServiceResponse(serviceResponse, res);
      }
      const errorMessage = (error as Error).message;
      const errorServiceResponse = new ServiceResponse(
        ResponseStatus.Failed,
        `Error: ${errorMessage}`,
        `Sorry, we couldn't generate excel file.`,
        StatusCodes.INTERNAL_SERVER_ERROR
      );
      handleServiceResponse(errorServiceResponse, res);
    }
  });
  return router;
})();
