export type MessageBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "table"; rows: string[][] };

function cellsFromRow(line: string): string[] {
  const escapedPipe = "\u0000";
  const normalized = line.trim().replace(/\\\|/g, escapedPipe);
  const withoutEdges = normalized.replace(/^\|/, "").replace(/\|$/, "");
  return withoutEdges.split("|").map((cell) => cell.replaceAll(escapedPipe, "|").trim());
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function isTableStart(lines: string[], index: number): boolean {
  return index + 1 < lines.length && lines[index].includes("|") && isTableSeparator(lines[index + 1]);
}

export function parseAssistantMarkdown(markdown: string): MessageBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MessageBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const rows = [cellsFromRow(line)];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(cellsFromRow(lines[index]));
        index += 1;
      }
      const width = rows[0].length;
      blocks.push({ type: "table", rows: rows.map((row) => [...row.slice(0, width), ...Array(Math.max(0, width - row.length)).fill("")]) });
      continue;
    }

    if (/^#{1,3}\s+/.test(line)) {
      blocks.push({ type: "heading", text: line.replace(/^#{1,3}\s+/, "").trim() });
      index += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, "").trim());
        index += 1;
      }
      blocks.push({ type: "list", items });
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^#{1,3}\s+/.test(lines[index]) && !/^\s*[-*]\s+/.test(lines[index]) && !isTableStart(lines, index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
  }

  return blocks;
}

