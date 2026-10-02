/**
 * Calls `onEvent` for each JSON line in a streamed body. Chunks can split a
 * line (or a multi-byte character) anywhere, so text is decoded in streaming
 * mode and only complete lines are parsed.
 */
export async function readNdjson<E>(body: ReadableStream<Uint8Array>, onEvent: (event: E) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (final: boolean) => {
    const lines = buffer.split("\n");
    buffer = final ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      if (line.trim()) onEvent(JSON.parse(line) as E);
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    flush(false);
  }
  buffer += decoder.decode();
  flush(true);
}
