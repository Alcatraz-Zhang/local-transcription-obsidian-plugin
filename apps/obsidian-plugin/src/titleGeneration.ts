export function buildTitleGenerationPrompt(userPrompt: string): string {
  return [
    userPrompt.trim(),
    "只返回标题文本本身，不要返回解释、引号、Markdown 或任何额外内容。"
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function generateTitle(options: {
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
        { role: "system", content: buildTitleGenerationPrompt(options.prompt) },
        { role: "user", content: options.transcript }
      ]
    })
  });
  if (!response.ok) {
    throw new Error(`Title generation failed with HTTP ${response.status}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Title generation response did not include message content");
  }
  return content.trim();
}
