export type KnowledgeEntry = {
  id: number;
  recordId: string;
  updated: string;
  updatedTime: string;
  content: string;
  archived: boolean;
};

export type KnowledgeRecord = {
  id: string;
  updated_at: string;
  content: string;
  status: "published" | "archived";
};

export function mapKnowledgeRecords(records: KnowledgeRecord[]): KnowledgeEntry[] {
  return records.map((record, index) => {
    const updatedAt = new Date(record.updated_at);
    return {
      id: index + 1,
      recordId: record.id,
      updated: new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(updatedAt),
      updatedTime: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(updatedAt),
      content: record.content,
      archived: record.status === "archived",
    };
  });
}

export function countKnowledgeWords(text: string): number {
  if (!text.trim()) return 0;
  if (typeof Intl.Segmenter === "function") {
    return [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(text)]
      .filter((segment) => segment.isWordLike)
      .length;
  }
  return text.trim().split(/\s+/).length;
}

export function insertKnowledgeTranscript(
  content: string,
  transcript: string,
  cursor: number,
): { content: string; cursor: number } {
  const insertionPoint = Math.max(0, Math.min(cursor, content.length));
  const before = content.slice(0, insertionPoint);
  const after = content.slice(insertionPoint);
  const inserted = `${before && !/\s$/.test(before) ? " " : ""}${transcript.trim()}${after && !/^\s/.test(after) ? " " : ""}`;

  return {
    content: `${before}${inserted}${after}`,
    cursor: insertionPoint + inserted.length,
  };
}
