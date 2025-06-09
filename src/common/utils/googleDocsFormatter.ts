/**
 * Google Docs Markdown Formatter
 * Sophisticated parsing and formatting logic for Google Docs API
 * Based on the Google Apps Script formatting logic
 */

// Style definitions adapted for Google Docs API
export const textStyles = {
  code: {
    weightedFontFamily: { fontFamily: 'Courier New', weight: 400 },
    backgroundColor: { color: { rgbColor: { red: 0.93, green: 0.93, blue: 0.93 } } },
  },
  bold: { bold: true },
  italic: { italic: true },
  heading1: { bold: true, fontSize: { magnitude: 16, unit: 'PT' } },
  heading2: { bold: true, fontSize: { magnitude: 14, unit: 'PT' } },
  heading3: { bold: true, fontSize: { magnitude: 12, unit: 'PT' } },
  heading4: { bold: true, fontSize: { magnitude: 11, unit: 'PT' } },
  heading5: { bold: false, fontSize: { magnitude: 11, unit: 'PT' } },
  heading6: {
    bold: false,
    fontSize: { magnitude: 10, unit: 'PT' },
    foregroundColor: { color: { rgbColor: { red: 0.4, green: 0.4, blue: 0.4 } } },
  },
  listItem: { bold: false },
  link: {
    foregroundColor: { color: { rgbColor: { red: 0.06, green: 0.3, blue: 0.8 } } },
    underline: true,
  },
  checkbox: {
    weightedFontFamily: { fontFamily: 'Arial', weight: 400 },
    fontSize: { magnitude: 11, unit: 'PT' },
  },
  tableHeader: { bold: true },
  blockquote: {
    italic: true,
    foregroundColor: { color: { rgbColor: { red: 0.4, green: 0.4, blue: 0.4 } } },
  },
};

export interface ParsedContent {
  type: 'text' | 'table' | 'horizontal_rule';
  text?: string;
  style?: any;
  headers?: string[];
  rows?: string[][];
  link?: { url: string };
}

/**
 * Detects if a Markdown table starts at the given line index
 */
function detectTableStart(lines: string[], startIndex: number): { numColumns: number } | null {
  if (startIndex + 1 >= lines.length) return null;

  const headerLine = lines[startIndex].trim();
  const separatorLine = lines[startIndex + 1].trim();

  if (!headerLine.includes('|') || !separatorLine.includes('|')) return null;
  if (!headerLine.match(/^\|?.*\|.*\|?$/)) return null;
  if (!separatorLine.match(/^\|?\s*[:|-]{3,}\s*[:|\-\s]*\|/)) return null;

  const separatorParts = separatorLine
    .replace(/^\|+|\|+$/g, '')
    .split('|')
    .map((s) => s.trim());
  if (separatorParts.length === 0 || separatorParts.some((part) => !part.match(/^:?--+[:|-]*:?$/))) return null;

  const numColumns = separatorParts.length;
  const headerParts = headerLine.replace(/^\|+|\|+$/g, '').split('|');

  if (headerParts.length !== numColumns) {
    console.warn(
      `Table header columns (${headerParts.length}) != separator columns (${numColumns}) at line ${startIndex}`
    );
  }

  return { numColumns };
}

/**
 * Parses a Markdown table starting from a given index
 */
function parseMarkdownTable(
  lines: string[],
  startIndex: number,
  numColumns: number
): {
  headers: string[];
  rows: string[][];
  linesConsumed: number;
} {
  const headers: string[] = [];
  const rows: string[][] = [];
  let linesConsumed = 0;

  const headerLine = lines[startIndex].trim();
  const parsedHeaders = headerLine
    .replace(/^\|+|\|+$/g, '')
    .split('|')
    .map((cell) => cell.trim());

  // Normalize headers array to match numColumns
  while (parsedHeaders.length < numColumns) parsedHeaders.push('');
  if (parsedHeaders.length > numColumns) parsedHeaders.splice(numColumns);
  headers.push(...parsedHeaders);

  linesConsumed++; // Header line
  linesConsumed++; // Separator line

  let rowIndex = startIndex + linesConsumed;
  while (rowIndex < lines.length) {
    const rowLine = lines[rowIndex].trim();
    if (!rowLine.includes('|')) break;

    const cells = rowLine
      .replace(/^\|+|\|+$/g, '')
      .split('|')
      .map((cell) => cell.trim());
    while (cells.length < numColumns) cells.push('');
    if (cells.length > numColumns) cells.splice(numColumns);

    rows.push(cells);
    linesConsumed++;
    rowIndex++;
  }

  return { headers, rows, linesConsumed };
}

/**
 * Main content parsing function that converts markdown text to structured content
 */
export function parseContent(text: string): ParsedContent[] {
  const content: ParsedContent[] = [];

  // Normalize line endings and handle LaTeX content
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = text.replace(/(?:\\\[|\$\$|\\\()[\s\S]*?(?:\\\]|\$\$|\\\))/g, (match) => {
    return match.replace(/\n/g, ' ').replace(/\s+/g, ' ');
  });

  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Check for Table
    const tableMatch = detectTableStart(lines, i);
    if (tableMatch) {
      const tableData = parseMarkdownTable(lines, i, tableMatch.numColumns);
      if (tableData.rows.length > 0) {
        content.push({
          type: 'table',
          headers: tableData.headers,
          rows: tableData.rows,
        });
      } else {
        // If table parsing failed, treat as regular text
        content.push({ type: 'text', text: lines[i] + '\n', style: {} });
        if (i + 1 < lines.length) {
          content.push({ type: 'text', text: lines[i + 1] + '\n', style: {} });
        }
      }
      i += tableData.linesConsumed;
      continue;
    }

    // Check for Code Block
    const codeBlockMatch = line.trim().match(/^```([\w-]*)$/);
    if (codeBlockMatch) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().match(/^```$/)) {
        codeLines.push(lines[i]);
        i++;
      }
      if (codeLines.length > 0) {
        content.push({
          type: 'text',
          text: codeLines.join('\n') + '\n',
          style: textStyles.code,
        });
      }
      i++; // Skip closing ```
      continue;
    }

    // Check for Horizontal Rule
    if (line.match(/^([-*_])\s*\1\s*\1\s*$/)) {
      content.push({ type: 'horizontal_rule' });
      i++;
      continue;
    }

    // Check for Empty Line
    if (line.trim() === '') {
      content.push({ type: 'text', text: '\n', style: {} });
      i++;
      continue;
    }

    // Check for Heading (H1-H6)
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2].trim();
      const headingStyle = (textStyles as any)[`heading${level}`] || { bold: true };

      parseInlineTextContent(headingText, content, headingStyle);
      content.push({ type: 'text', text: '\n', style: {} });
      console.log(`Parsed heading level ${level}`);
      i++;
      continue;
    }

    // Check for List
    const listMatch = line.match(/^(\s*)([-*]|\d+\.|(?:[-*] \[[ xX]\]))\s*(.*)/);
    if (listMatch) {
      const indent = listMatch[1].length;
      const marker = listMatch[2];
      const itemText = listMatch[3];
      const listLevel = Math.floor(indent / 2);

      let prefix: string;
      let itemStyle = { ...textStyles.listItem };

      if (marker.match(/\[ \]/)) {
        prefix = '☐ ';
        itemStyle = { ...itemStyle, ...textStyles.checkbox };
      } else if (marker.match(/\[[xX]\]/)) {
        prefix = '☒ ';
        itemStyle = { ...itemStyle, ...textStyles.checkbox };
      } else if (marker === '-' || marker === '*') {
        prefix = '• ';
      } else {
        prefix = marker + ' ';
      }

      content.push({
        type: 'text',
        text: '  '.repeat(listLevel) + prefix,
        style: itemStyle,
      });
      parseInlineTextContent(itemText, content, itemStyle);
      content.push({ type: 'text', text: '\n', style: {} });
      i++;
      continue;
    }

    // Check for Blockquote
    if (line.startsWith('>')) {
      const quoteText = line.replace(/^>\s*/, '');
      content.push({
        type: 'text',
        text: '    ',
        style: {},
      });
      parseInlineTextContent(quoteText, content, textStyles.blockquote);
      content.push({ type: 'text', text: '\n', style: {} });
      i++;
      continue;
    }

    // Default: Regular Paragraph
    parseInlineTextContent(line, content, {});
    content.push({ type: 'text', text: '\n', style: {} });
    i++;
  }

  console.log(`Finished parsing content. Total elements: ${content.length}`);
  return content;
}

/**
 * Parses inline formatting (bold, italic, code, links) within a text segment
 */
function parseInlineTextContent(text: string, content: ParsedContent[], baseStyle: any): void {
  // Handle LaTeX content as plain text
  const latexContents: string[] = [];
  const latexRegex = /(\\\[([\s\S]*?)\\\]|\$\$(?:.|\n)*?\$\$|(?<!\\)\$((?:\\.|[^$\\])+?)(?<!\\)\$|\\\(([\s\S]*?)\\\))/g;

  text = text.replace(latexRegex, (match, fullMatch, bracketContent, dollarContent, parenContent) => {
    const coreContent =
      bracketContent || dollarContent || parenContent || (match.startsWith('$$') ? match.slice(2, -2) : match);
    const placeholder = `‖LATEX_CONTENT_${latexContents.length}‖`;
    latexContents.push(coreContent.trim().replace(/\s+/g, ' '));
    return placeholder;
  });

  // Define inline formatting markers
  const markers = [
    { name: 'bold', regex: /(\*\*)(.*?)\1/ },
    { name: 'italic', regex: /(\*)(.*?)\1/ },
    { name: 'code', regex: /(`)(.*?)\1/ },
    { name: 'link', regex: /\[(.*?)\]\((.*?)\)/ },
  ];

  function processSegment(segment: string, currentStyle: any): void {
    if (!segment) return;

    let bestMatch: any = null;
    let bestMatchIndex = segment.length;

    markers.forEach((markerInfo) => {
      const match = segment.match(markerInfo.regex);
      if (match && match.index !== undefined && match.index < bestMatchIndex) {
        // Skip italic inside bold and vice versa conflicts
        if (markerInfo.name === 'italic' && match.index > 0 && segment[match.index - 1] === '*') return;
        if (markerInfo.name === 'bold' && match.index > 0 && segment[match.index - 1] === '*') return;

        bestMatchIndex = match.index;
        bestMatch = { marker: markerInfo, matchData: match };
      }
    });

    if (!bestMatch) {
      if (segment) {
        content.push({ type: 'text', text: segment, style: currentStyle });
      }
      return;
    }

    const textBefore = segment.slice(0, bestMatchIndex);
    if (textBefore) {
      content.push({ type: 'text', text: textBefore, style: currentStyle });
    }

    const marker = bestMatch.marker;
    const matchData = bestMatch.matchData;
    let contentInside = '';
    let styleInside = { ...currentStyle };
    const textAfterIndex = bestMatchIndex + matchData[0].length;

    switch (marker.name) {
      case 'bold':
        styleInside.bold = true;
        contentInside = matchData[2];
        break;
      case 'italic':
        if (!currentStyle.bold) {
          styleInside.italic = true;
        }
        contentInside = matchData[2];
        break;
      case 'code':
        styleInside = { ...currentStyle, ...textStyles.code };
        contentInside = matchData[2];
        break;
      case 'link': {
        const linkText = matchData[1];
        let linkUrl = matchData[2].trim();
        try {
          linkUrl = encodeURI(decodeURI(linkUrl));
        } catch (e) {
          // Ignore encoding errors
        }
        styleInside = { ...currentStyle, ...textStyles.link };
        contentInside = linkText;
        content.push({ type: 'text', text: contentInside, style: styleInside, link: { url: linkUrl } });
        processSegment(segment.slice(textAfterIndex), currentStyle);
        return;
      }
    }

    processSegment(contentInside, styleInside);
    processSegment(segment.slice(textAfterIndex), currentStyle);
  }

  const initialContentLength = content.length;
  processSegment(text, baseStyle);

  // Replace LaTeX placeholders
  for (let i = initialContentLength; i < content.length; i++) {
    if (content[i].type === 'text' && content[i].text) {
      content[i].text = content[i].text!.replace(/‖LATEX_CONTENT_(\d+)‖/g, (placeholderMatch, indexStr) => {
        const index = parseInt(indexStr);
        if (index >= 0 && index < latexContents.length) {
          return `\\[ ${latexContents[index]} \\]`;
        } else {
          console.error('Could not find LaTeX content for index', index);
          return placeholderMatch;
        }
      });
    }
  }
}

/**
 * Converts parsed content to Google Docs API batchUpdate requests
 * Uses single-pass text insertion with excellent table formatting for reliability
 */
export function convertToGoogleDocsRequests(parsedContent: ParsedContent[], startIndex: number = 1): any[] {
  const requests: any[] = [];

  // Single pass: convert all content to formatted text
  let fullText = '';
  const textSegments: Array<{ start: number; end: number; style?: any; link?: { url: string } }> = [];
  const tableMarkers: Array<{ position: number; headers: string[]; rows: string[][]; marker: string }> = [];

  let currentPosition = 0;
  let tableCount = 0;

  for (const item of parsedContent) {
    if (item.type === 'text' && item.text) {
      const segmentStart = currentPosition;
      const segmentEnd = currentPosition + item.text.length;

      textSegments.push({
        start: segmentStart,
        end: segmentEnd,
        style: item.style,
        link: item.link,
      });

      fullText += item.text;
      currentPosition += item.text.length;
    } else if (item.type === 'table' && item.headers && item.rows) {
      // Convert table to beautifully formatted text with excellent spacing
      const tableResult = convertTableToText(item.headers, item.rows);
      const tableText = tableResult.text;

      const segmentStart = currentPosition;
      const segmentEnd = currentPosition + tableText.length;

      // Add the table text
      textSegments.push({
        start: segmentStart,
        end: segmentEnd,
        style: {},
      });

      // Add bold formatting for header segments
      for (const headerSegment of tableResult.headerSegments) {
        textSegments.push({
          start: segmentStart + headerSegment.start,
          end: segmentStart + headerSegment.end,
          style: textStyles.tableHeader,
        });
      }

      fullText += tableText;
      currentPosition += tableText.length;
    } else if (item.type === 'horizontal_rule') {
      const ruleText = '\n' + '─'.repeat(50) + '\n';
      const ruleText = '\n' + '─'.repeat(50) + '\n';
      const segmentStart = currentPosition;
      const segmentEnd = currentPosition + ruleText.length;

      textSegments.push({
        start: segmentStart,
        end: segmentEnd,
        style: {},
      });

      fullText += ruleText;
      currentPosition += ruleText.length;
    }
  }

  // Insert all text at once
  if (fullText) {
    requests.push({
      insertText: {
        location: { index: startIndex },
        text: fullText,
      },
    });

    // Apply formatting to text segments (sort by start position to handle overlapping styles)
    const sortedSegments = textSegments.sort((a, b) => a.start - b.start);

    for (const segment of sortedSegments) {
      const actualStart = startIndex + segment.start;
      const actualEnd = startIndex + segment.end;

      // Apply text styling if present
      if (segment.style && Object.keys(segment.style).length > 0) {
        const textStyle: any = {};

        if (segment.style.bold !== undefined) textStyle.bold = segment.style.bold;
        if (segment.style.italic !== undefined) textStyle.italic = segment.style.italic;
        if (segment.style.underline !== undefined) textStyle.underline = segment.style.underline;
        if (segment.style.strikethrough !== undefined) textStyle.strikethrough = segment.style.strikethrough;
        if (segment.style.strikethrough !== undefined) textStyle.strikethrough = segment.style.strikethrough;
        if (segment.style.fontSize) textStyle.fontSize = segment.style.fontSize;
        if (segment.style.fontFamily) {
          textStyle.weightedFontFamily = { fontFamily: segment.style.fontFamily, weight: 400 };
        }
        if (segment.style.fontFamily) {
          textStyle.weightedFontFamily = { fontFamily: segment.style.fontFamily, weight: 400 };
        }
        if (segment.style.weightedFontFamily) textStyle.weightedFontFamily = segment.style.weightedFontFamily;
        if (segment.style.foregroundColor) textStyle.foregroundColor = segment.style.foregroundColor;
        if (segment.style.backgroundColor) textStyle.backgroundColor = segment.style.backgroundColor;

        if (Object.keys(textStyle).length > 0) {
          requests.push({
            updateTextStyle: {
              range: {
                startIndex: actualStart,
                endIndex: actualEnd,
              },
              textStyle: textStyle,
              fields: Object.keys(textStyle).join(','),
            },
          });
        }
      }

      // Apply link if present
      if (segment.link && segment.link.url) {
        requests.push({
          updateTextStyle: {
            range: {
              startIndex: actualStart,
              endIndex: actualEnd,
            },
            textStyle: {
              link: { url: segment.link.url },
            },
            fields: 'link',
          },
        });
      }
    }
  }

  // Second pass: replace table markers with actual tables (in reverse order to maintain indices)
  for (let i = tableMarkers.length - 1; i >= 0; i--) {
    const table = tableMarkers[i];
    const markerStart = table.position;
    const markerEnd = table.position + table.marker.length;

    // Delete the marker
    requests.push({
      deleteContentRange: {
        range: {
          startIndex: markerStart,
          endIndex: markerEnd,
        },
      },
    });

    // Insert the actual table
    const numRows = table.rows.length + 1; // +1 for header row
    const numColumns = table.headers.length;

    requests.push({
      insertTable: {
        location: { index: markerStart },
        rows: numRows,
        columns: numColumns,
      },
    });

    // Since populating table cells is complex, we'll add the table data as text after the table
    // This gives users both the boxed table structure AND visible content
    const tableTextData = convertTableToText(table.headers, table.rows).text;

    // Insert the table data after the table structure
    // Tables typically take up some space, so we insert after
    const textInsertPosition = markerStart + 10; // Approximate position after table

    requests.push({
      insertText: {
        location: { index: textInsertPosition },
        text: '\n' + tableTextData + '\n',
      },
    });
  }

  return requests;
}

/**
 * Converts table headers and rows to a beautifully formatted text representation
 * Supports multi-line content and excellent spacing like professional tables
 */
function convertTableToText(
  headers: string[],
  rows: string[][]
): { text: string; headerSegments: { start: number; end: number }[] } {
  if (!headers.length || !rows.length) return { text: '', headerSegments: [] };

  // Clean up headers and rows by removing markdown formatting for display
  const cleanHeaders = headers.map((header) => cleanMarkdownText(header).replace(/\n/g, ' '));
  const cleanRows = rows.map((row) => row.map((cell) => cleanMarkdownText(cell).replace(/\n/g, ' ')));

  // Calculate column widths with better spacing
  const columnWidths: number[] = [];

  // Start with header widths
  cleanHeaders.forEach((header, i) => {
    columnWidths[i] = Math.max(header.length, 8); // Minimum 8 chars per column
  });

  // Check row widths
  cleanRows.forEach((row) => {
    row.forEach((cell, i) => {
      if (i < columnWidths.length) {
        columnWidths[i] = Math.max(columnWidths[i] || 8, cell.length);
      }
    });
  });

  // Add generous padding for readability
  const paddedWidths = columnWidths.map((width) => Math.max(width + 4, 12));

  let tableText = '\n\n'; // Extra spacing before table
  const headerSegments: { start: number; end: number }[] = [];

  // Create top border
  const topBorder = paddedWidths.map((width) => '═'.repeat(width)).join('═╤═');
  tableText += '╔═' + topBorder + '═╗\n';

  // Create header row with padding
  const headerCells = cleanHeaders.map((header, i) => {
    const padding = paddedWidths[i] - header.length;
    const leftPad = Math.floor(padding / 2);
    const rightPad = padding - leftPad;
    return ' '.repeat(leftPad) + header + ' '.repeat(rightPad);
  });
  const headerRow = '║ ' + headerCells.join(' │ ') + ' ║';

  // Calculate header content positions (excluding border characters)
  const headerRowStart = tableText.length + 2; // After '║ '
  const headerContentLength = headerCells.join(' │ ').length;
  const headerRowEnd = headerRowStart + headerContentLength;

  tableText += headerRow + '\n';

  // Mark the header content for bold formatting (excluding borders)
  headerSegments.push({ start: headerRowStart, end: headerRowEnd });

  // Create separator row
  const separator = paddedWidths.map((width) => '═'.repeat(width)).join('═╪═');
  tableText += '╠═' + separator + '═╣\n';

  // Create data rows with borders
  cleanRows.forEach((row) => {
    const dataCells = row.map((cell, i) => {
      const width = paddedWidths[i] || 12;
      const padding = width - cell.length;
      const leftPad = Math.floor(padding / 2);
      const rightPad = padding - leftPad;
      return ' '.repeat(leftPad) + cell + ' '.repeat(rightPad);
    });
    const dataRow = '║ ' + dataCells.join(' │ ') + ' ║';
    tableText += dataRow + '\n';
  });

  // Create bottom border
  const bottomBorder = paddedWidths.map((width) => '═'.repeat(width)).join('═╧═');
  tableText += '╚═' + bottomBorder + '═╝\n';

  tableText += '\n'; // Extra spacing after table

  return { text: tableText, headerSegments };
}

/**
 * Removes markdown formatting from text for display purposes
 */
function cleanMarkdownText(text: string): string {
  if (!text) return '';

  return text
    .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold **text**
    .replace(/\*(.*?)\*/g, '$1') // Remove italic *text*
    .replace(/`(.*?)`/g, '$1') // Remove code `text`
    .replace(/\[(.*?)\]\(.*?\)/g, '$1') // Remove links [text](url) -> text
    .trim();
}

/**
 * Creates a formatted Google Doc with parsed markdown content
 */
export async function createFormattedGoogleDoc(
  docs: any,
  drive: any,
  docName: string,
  contentText: string,
  folderId?: string,
  category: string = 'misc',
  addHeader: boolean = true
  category: string = 'misc',
  addHeader: boolean = true
): Promise<{ id: string; name: string; mimeType: string; webViewLink: string }> {
  // Create the document
  const doc = await docs.documents.create({ requestBody: { title: docName } });
  const docId = doc.data.documentId;

  if (!docId) {
    throw new Error('Failed to create document - no document ID returned');
  }

  // Move to folder if specified
  if (folderId) {
    await drive.files.update({
      fileId: docId,
      addParents: folderId,
      removeParents: 'root',
      fields: 'id, parents',
    });
  }

  // Parse the content
  const parsedContent = parseContent(contentText);
  console.log(`Parsed content for new doc contains ${parsedContent.length} elements.`);

  // Convert to Google Docs API requests
  const requests: any[] = [];

  let startIndex = 1;

  // Add header if requested
  if (addHeader) {
    const headerText = `----- ${category} - ${new Date().toLocaleString()} -----\n\n`;
    requests.push({
      insertText: {
        location: { index: 1 },
        text: headerText,
      },
    });
    startIndex = 1 + headerText.length;
  }
  let startIndex = 1;

  // Add header if requested
  if (addHeader) {
    const headerText = `----- ${category} - ${new Date().toLocaleString()} -----\n\n`;
    requests.push({
      insertText: {
        location: { index: 1 },
        text: headerText,
      },
    });
    startIndex = 1 + headerText.length;
  }

  // Add parsed content
  const contentRequests = convertToGoogleDocsRequests(parsedContent, startIndex);
  const contentRequests = convertToGoogleDocsRequests(parsedContent, startIndex);
  requests.push(...contentRequests);

  // Apply all requests in batch
  if (requests.length > 0) {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests },
    });
  }

  console.log(`Successfully created and populated formatted doc: ${docId}`);

  return {
    id: docId,
    name: docName,
    mimeType: 'application/vnd.google-apps.document',
    webViewLink: `https://docs.google.com/document/d/${docId}/edit`,
  };
}

/**
 * Updates an existing Google Doc with formatted content
 */
export async function updateFormattedGoogleDoc(
  docs: any,
  docId: string,
  contentText: string,
  category: string = 'misc',
  addHeader: boolean = true
  category: string = 'misc',
  addHeader: boolean = true
): Promise<void> {
  // Get current document to find where to append
  const document = await docs.documents.get({ documentId: docId, fields: 'body' });
  const existingContentEndIndex = document.data.body?.content?.[document.data.body.content.length - 1]?.endIndex || 1;

  // Parse the content
  const parsedContent = parseContent(contentText);
  console.log(`Parsed content for appending contains ${parsedContent.length} elements.`);

  // Convert to Google Docs API requests
  const requests: any[] = [];

  let startIndex = existingContentEndIndex;

  // Add header if requested
  if (addHeader) {
    const headerText = `\n----- ${category} - ${new Date().toLocaleString()} -----\n\n`;
    requests.push({
      insertText: {
        location: { index: existingContentEndIndex },
        text: headerText,
      },
    });
    startIndex = existingContentEndIndex + headerText.length;
  }
  let startIndex = existingContentEndIndex;

  // Add header if requested
  if (addHeader) {
    const headerText = `\n----- ${category} - ${new Date().toLocaleString()} -----\n\n`;
    requests.push({
      insertText: {
        location: { index: existingContentEndIndex },
        text: headerText,
      },
    });
    startIndex = existingContentEndIndex + headerText.length;
  }

  // Add parsed content
  const contentRequests = convertToGoogleDocsRequests(parsedContent, startIndex);
  const contentRequests = convertToGoogleDocsRequests(parsedContent, startIndex);
  requests.push(...contentRequests);

  // Apply all requests in batch
  if (requests.length > 0) {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests },
    });
  }

  console.log(`Successfully appended formatted content to doc: ${docId}`);
}
