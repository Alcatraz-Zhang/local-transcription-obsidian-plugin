export function buildPostProcessingPrompt(userPrompt: string): string {
  return [
    userPrompt.trim(),
    "请严格保留每一行开头的时间戳和说话人标签。行首可能类似 [00:00:00 - 00:00:05] Speaker1:，这些前缀必须原样保留。保持每行一个发言片段。只返回处理后的转录稿，不要输出任何额外内容。"
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function mergeProcessedTranscript(processed: string, raw: string, keepOriginal: boolean): string {
  if (!keepOriginal || processed.trim() === raw.trim()) {
    return processed;
  }
  return `${processed.trim()}\n\n---\n\n## Original transcription\n\n${raw.trim()}`;
}

export async function postProcessTranscript(options: {
  endpoint: string;
  apiKey: string;
  model: string;
  prompt: string;
  transcript: string;
  request: typeof fetch;
}): Promise<string> {
  const response = await options.request(options.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`
    },
    body: JSON.stringify({
      model: options.model,
      messages: [
        { role: "system", content: buildPostProcessingPrompt(options.prompt) },
        { role: "user", content: options.transcript }
      ]
    })
  });
  if (!response.ok) {
    throw new Error(`Post-processing failed with HTTP ${response.status}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Post-processing response did not include message content");
  }
  return content.trim();
}
