export function buildPostProcessingPrompt(userPrompt: string): string {
  return [
    userPrompt.trim(),
    "preserve every timestamp and speaker label exactly. Lines may begin like [00:00:00 - 00:00:05] Speaker1:. Keep those prefixes unchanged and keep one utterance per line. Return only the polished transcript."
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
