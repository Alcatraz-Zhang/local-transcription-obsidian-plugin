import { describe, expect, it } from "vitest";
import { buildTitleGenerationPrompt, generateTitle } from "./titleGeneration";

describe("buildTitleGenerationPrompt", () => {
  it("includes the user prompt and a strict output constraint", () => {
    const prompt = buildTitleGenerationPrompt("Generate a title.");
    expect(prompt).toContain("Generate a title.");
    expect(prompt).toContain("只返回标题文本本身");
  });
});

describe("generateTitle", () => {
  it("returns trimmed content from a successful chat completion response", async () => {
    const result = await generateTitle({
      endpoint: "https://example.com/v1/chat/completions",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      prompt: "Generate a title.",
      transcript: "Speaker1: hello world",
      request: async () =>
        ({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: "  Hello World Title  " } }]
          })
        }) as Response
    });
    expect(result).toBe("Hello World Title");
  });

  it("throws when the response lacks content", async () => {
    await expect(
      generateTitle({
        endpoint: "https://example.com/v1/chat/completions",
        apiKey: "sk-test",
        model: "gpt-4o-mini",
        prompt: "Generate a title.",
        transcript: "Speaker1: hello world",
        request: async () =>
          ({
            ok: true,
            json: async () => ({ choices: [{ message: { content: "" } }] })
          }) as Response
      })
    ).rejects.toThrow("Title generation response did not include message content");
  });

  it("throws on non-ok response", async () => {
    await expect(
      generateTitle({
        endpoint: "https://example.com/v1/chat/completions",
        apiKey: "sk-test",
        model: "gpt-4o-mini",
        prompt: "Generate a title.",
        transcript: "Speaker1: hello world",
        request: async () =>
          ({
            ok: false,
            status: 500
          }) as Response
      })
    ).rejects.toThrow("Title generation failed with HTTP 500");
  });
});
