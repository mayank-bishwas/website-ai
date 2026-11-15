export async function readSseData(
  response: Response,
  onData: (data: string) => void,
): Promise<void> {
  if (!response.body) throw new Error("Streaming response body is unavailable.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (line.startsWith("data:")) onData(line.slice(5).trimStart());
        newline = buffer.indexOf("\n");
      }
      if (done) break;
    }
    if (buffer.startsWith("data:")) onData(buffer.slice(5).trimStart());
  } finally {
    reader.releaseLock();
  }
}
