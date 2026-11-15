export type AskStreamEvent =
  | { type: "token"; token: string }
  | { type: "reset" }
  | { type: "answer"; answer: string }
  | { type: "done"; contactOffered: boolean }
  | { type: "error" };

export async function readAskEventStream(
  response: Response,
  onEvent: (event: AskStreamEvent) => void,
): Promise<void> {
  if (!response.body) throw new Error("Response stream is unavailable.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const dispatch = (line: string) => {
    if (!line.startsWith("data:")) return;
    const event = JSON.parse(line.slice(5).trimStart()) as AskStreamEvent;
    if (
      event.type === "token" && typeof event.token === "string" ||
      event.type === "reset" ||
      event.type === "answer" && typeof event.answer === "string" ||
      event.type === "done" && typeof event.contactOffered === "boolean" ||
      event.type === "error"
    ) {
      onEvent(event);
    } else {
      throw new Error("Invalid response stream event.");
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        dispatch(buffer.slice(0, newline).replace(/\r$/, ""));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
      if (done) break;
    }
    if (buffer) dispatch(buffer.replace(/\r$/, ""));
  } finally {
    reader.releaseLock();
  }
}
