# Auto Title Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional auto-title generation feature to the Obsidian plugin that reuses the post-processing LLM endpoint and applies the generated title to both `{{title}}` and the note filename.

**Architecture:** Add two settings (`titleGenerationEnabled`, `titleGenerationPrompt`) and a small `titleGeneration.ts` module that mirrors `postProcessing.ts`. In `createTranscriptNote`, generate the title after post-processing (if enabled) and use it as the `title` template variable. Version is bumped to `0.2.2` and a GitHub release is created at the end.

**Tech Stack:** TypeScript, Obsidian API, vitest, esbuild, Git, GitHub CLI.

---

## File Structure

- `apps/obsidian-plugin/src/settings.ts` — add `titleGenerationEnabled` and `titleGenerationPrompt` fields and defaults.
- `apps/obsidian-plugin/src/titleGeneration.ts` — new module for building the title prompt and calling the LLM.
- `apps/obsidian-plugin/src/titleGeneration.test.ts` — unit tests for the new module.
- `apps/obsidian-plugin/src/main.ts` — wire title generation into `createTranscriptNote` and add settings UI.
- `apps/obsidian-plugin/src/template.test.ts` — add a test for `safeNoteFileName` with generated-title-like input.
- Versioned files — bump from `0.2.1` to `0.2.2`.

---

### Task 1: Add settings fields and defaults

**Files:**
- Modify: `apps/obsidian-plugin/src/settings.ts`

- [ ] **Step 1: Add fields to the settings interface**

Add `titleGenerationEnabled` and `titleGenerationPrompt` to `LocalTranscriptionSettings`:

```ts
export interface LocalTranscriptionSettings {
  gatewayUrl: string;
  audioSavePath: string;
  transcriptSavePath: string;
  speakerProfilesPath: string;
  autoApplySpeakerConfidence: number;
  suggestSpeakerConfidence: number;
  noteFilenameTemplate: string;
  noteTemplate: string;
  outputMode: OutputMode;
  language: string;
  asrModel: string;
  postProcessingEnabled: boolean;
  postProcessingUrl: string;
  postProcessingModel: string;
  postProcessingPrompt: string;
  keepOriginalTranscription: boolean;
  titleGenerationEnabled: boolean;
  titleGenerationPrompt: string;
}
```

- [ ] **Step 2: Add the default prompt constant and default value**

Below `DEFAULT_POST_PROCESSING_PROMPT`, add:

```ts
export const DEFAULT_TITLE_GENERATION_PROMPT = [
  "请根据以下转录稿生成一个简洁、准确的笔记标题，直接表达内容主题。",
  "要求：",
  "1. 标题长度控制在 30 个汉字或 60 个字符以内。",
  "2. 不要包含时间戳、说话人标签或无关修饰。",
  "3. 不要返回解释、引号或 Markdown 格式，只返回标题文本本身。"
].join("\n");
```

Update `DEFAULT_SETTINGS`:

```ts
export const DEFAULT_SETTINGS: LocalTranscriptionSettings = {
  gatewayUrl: "http://localhost:17003",
  audioSavePath: "Recordings/Audio",
  transcriptSavePath: "Recordings/Transcripts",
  speakerProfilesPath: ".local-transcription/speakers.json",
  autoApplySpeakerConfidence: 0.85,
  suggestSpeakerConfidence: 0.65,
  noteFilenameTemplate: "{{datetime}} - {{title}}",
  noteTemplate: "![[{{audioFile}}]]\n\n{{transcription}}",
  outputMode: "speaker_timestamp",
  language: "auto",
  asrModel: "auto",
  postProcessingEnabled: false,
  postProcessingUrl: "https://api.openai.com/v1/chat/completions",
  postProcessingModel: "",
  postProcessingPrompt: DEFAULT_POST_PROCESSING_PROMPT,
  keepOriginalTranscription: true,
  titleGenerationEnabled: false,
  titleGenerationPrompt: DEFAULT_TITLE_GENERATION_PROMPT
};
```

- [ ] **Step 3: Run plugin typecheck**

Run: `npm run build -w @local-transcription/obsidian-plugin`

Expected: Typecheck passes (other files will still compile because the new fields are not yet read).

- [ ] **Step 4: Commit**

```bash
git add apps/obsidian-plugin/src/settings.ts
git commit -m "feat(settings): add title generation enabled and prompt defaults"
```

---

### Task 2: Create the title generation module

**Files:**
- Create: `apps/obsidian-plugin/src/titleGeneration.ts`
- Create: `apps/obsidian-plugin/src/titleGeneration.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/obsidian-plugin/src/titleGeneration.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w @local-transcription/obsidian-plugin -- src/titleGeneration.test.ts`

Expected: FAIL with module not found or function not defined.

- [ ] **Step 3: Implement the module**

Create `apps/obsidian-plugin/src/titleGeneration.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w @local-transcription/obsidian-plugin -- src/titleGeneration.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/obsidian-plugin/src/titleGeneration.ts apps/obsidian-plugin/src/titleGeneration.test.ts
git commit -m "feat(title): add title generation module with tests"
```

---

### Task 3: Wire title generation into note creation

**Files:**
- Modify: `apps/obsidian-plugin/src/main.ts`

- [ ] **Step 1: Import the new module and helpers**

At the top of `main.ts`, add:

```ts
import { generateTitle } from "./titleGeneration";
```

`safeNoteFileName` is already imported from `./template`.

- [ ] **Step 2: Generate title inside createTranscriptNote**

In `createTranscriptNote`, after the post-processing block and before the `variables` object, add:

```ts
    let title = defaultTitleFromFile(sourceName);
    if (this.pluginSettings.titleGenerationEnabled) {
      const apiKey = await this.getPostProcessingApiKey();
      if (!apiKey) {
        throw new Error("Post-processing API key is not configured");
      }
      try {
        const generated = await generateTitle({
          endpoint: this.pluginSettings.postProcessingUrl,
          apiKey,
          model: this.pluginSettings.postProcessingModel,
          prompt: this.pluginSettings.titleGenerationPrompt,
          transcript: finalText,
          request: fetch
        });
        title = safeNoteFileName(generated);
      } catch (error) {
        new Notice(
          `Title generation failed: ${error instanceof Error ? error.message : String(error)}. Using filename as title.`
        );
      }
    }
```

Then change the existing `variables` line from:

```ts
    const variables = { audioFile: audioPath, transcription: finalText, title, date, datetime };
```

to use the resolved `title` variable (it already does; just ensure `title` is declared once).

- [ ] **Step 3: Remove the old title assignment**

Remove or update the earlier line in `transcribeBlob` that assigns `const title = defaultTitleFromFile(sourceName);`. The title should be resolved inside `createTranscriptNote`, so `transcribeBlob` no longer needs to compute it. Change:

```ts
    const title = defaultTitleFromFile(sourceName);
    const audioPath = await this.saveAudio(blob, sourceName);
```

to:

```ts
    const audioPath = await this.saveAudio(blob, sourceName);
```

And change the call `await this.createTranscriptNote(job, audioPath, title);` to `await this.createTranscriptNote(job, audioPath, sourceName);`.

Then update `createTranscriptNote` signature from:

```ts
  private async createTranscriptNote(job: GatewayJob, audioPath: string, title: string): Promise<void> {
```

to:

```ts
  private async createTranscriptNote(job: GatewayJob, audioPath: string, sourceName: string): Promise<void> {
```

- [ ] **Step 4: Run tests**

Run: `npm run test -w @local-transcription/obsidian-plugin`

Expected: All existing tests pass. If any test mocks `createTranscriptNote` arguments, update the mock call.

- [ ] **Step 5: Commit**

```bash
git add apps/obsidian-plugin/src/main.ts
git commit -m "feat(title): generate title from transcript and use it for note filename"
```

---

### Task 4: Add settings UI

**Files:**
- Modify: `apps/obsidian-plugin/src/main.ts`

- [ ] **Step 1: Add the title generation toggle and prompt textarea**

Inside `LocalTranscriptionSettingTab.display()`, after the post-processing block and before the end of `display()`, add:

```ts
    new Setting(containerEl)
      .setName("Auto-generate title")
      .setDesc("Generate the note title from the transcript using the post-processing LLM.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.pluginSettings.titleGenerationEnabled).onChange(async (value) => {
          this.plugin.pluginSettings.titleGenerationEnabled = value;
          await this.plugin.saveSettings();
          this.display();
        })
      );
    if (this.plugin.pluginSettings.titleGenerationEnabled) {
      new Setting(containerEl)
        .setName("Title generation prompt")
        .addTextArea((text) => {
          text.inputEl.rows = 10;
          text.inputEl.addClass("local-transcription-title-generation-prompt");
          text.setValue(this.plugin.pluginSettings.titleGenerationPrompt).onChange(async (value) => {
            this.plugin.pluginSettings.titleGenerationPrompt = value;
            await this.plugin.saveSettings();
          });
        });
    }
```

- [ ] **Step 2: Run build to verify TypeScript**

Run: `npm run build -w @local-transcription/obsidian-plugin`

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/obsidian-plugin/src/main.ts
git commit -m "feat(settings): add auto-generate title UI"
```

---

### Task 5: Add safeNoteFileName test for generated titles

**Files:**
- Modify: `apps/obsidian-plugin/src/template.test.ts`

- [ ] **Step 1: Add a generated-title test case**

Add inside `describe("safeNoteFileName", ...)`:

```ts
  it("sanitizes generated titles so they can be used as filenames", () => {
    expect(safeNoteFileName("Team Sync: Q3 Roadmap?")).toBe("Team Sync- Q3 Roadmap-");
  });
```

- [ ] **Step 2: Run the test**

Run: `npm run test -w @local-transcription/obsidian-plugin -- src/template.test.ts`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/obsidian-plugin/src/template.test.ts
git commit -m "test(template): add generated title filename sanitization test"
```

---

### Task 6: Bump version to 0.2.2

**Files:**
- Modify: `package.json`
- Modify: `apps/obsidian-plugin/package.json`
- Modify: `apps/obsidian-plugin/manifest.json`
- Modify: `services/gateway/pyproject.toml`
- Modify: `services/gateway/Dockerfile`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Update all version strings**

Replace `0.2.1` with `0.2.2` in each of the following locations:

- `package.json` line 3: `"version": "0.2.2"`
- `apps/obsidian-plugin/package.json` line 3: `"version": "0.2.2"`
- `apps/obsidian-plugin/manifest.json` line 4: `"version": "0.2.2"`
- `services/gateway/pyproject.toml` line 3: `version = "0.2.2"`
- `services/gateway/Dockerfile` line 14: `ARG IMAGE_VERSION=0.2.2`
- `services/gateway/Dockerfile` line 18: `org.opencontainers.image.version="${IMAGE_VERSION}"` (value comes from ARG, no change needed)
- `docker-compose.yml` line 7: `image: local-transcription:0.2.2`

- [ ] **Step 2: Verify no 0.2.1 references remain**

Run: `grep -R "0.2.1" --include="*.json" --include="*.toml" --include="*.yml" --include="Dockerfile" .`

Expected: No matches in versioned files (excluding `node_modules`, `.git`, `graphify-out`).

- [ ] **Step 3: Commit**

```bash
git add package.json apps/obsidian-plugin/package.json apps/obsidian-plugin/manifest.json services/gateway/pyproject.toml services/gateway/Dockerfile docker-compose.yml
git commit -m "chore(release): bump version to 0.2.2"
```

---

### Task 7: Final build and test

- [ ] **Step 1: Run the full plugin test suite**

Run: `npm run test:plugin`

Expected: All tests pass.

- [ ] **Step 2: Run the full build**

Run: `npm run build`

Expected: `apps/obsidian-plugin/main.js`, `manifest.json`, and `styles.css` are produced/updated.

- [ ] **Step 3: Commit build artifacts**

```bash
git add apps/obsidian-plugin/main.js apps/obsidian-plugin/manifest.json apps/obsidian-plugin/styles.css
git commit -m "build: regenerate plugin artifacts for v0.2.2"
```

---

### Task 8: Create release tag and GitHub release

- [ ] **Step 1: Create and push the tag**

Run:

```bash
git tag v0.2.2
git push origin v0.2.2
```

Expected: Tag pushed to remote.

- [ ] **Step 2: Create the GitHub release with assets**

Run:

```bash
gh release create v0.2.2 \
  --title "v0.2.2" \
  --notes "## 0.2.2 - 2026-06-13

- Added optional auto-generate title feature. When enabled in settings, the plugin uses the configured post-processing LLM to generate a concise title from the transcript and applies it to both the note content ({{title}}) and the note filename.
- Added a configurable title generation prompt that appears when the feature is enabled.

BRAT/Obsidian assets are attached directly: manifest.json, main.js, and styles.css." \
  apps/obsidian-plugin/manifest.json \
  apps/obsidian-plugin/main.js \
  apps/obsidian-plugin/styles.css
```

Expected: Release `v0.2.2` is published with the three assets attached.

---

## Self-Review

**Spec coverage:**
- Settings fields and defaults: Task 1.
- Title generation module: Task 2.
- Integration into note creation with fallback: Task 3.
- Settings UI: Task 4.
- Tests: Tasks 2 and 5.
- Version bump and release: Tasks 6 and 8.

**Placeholder scan:** No TBD, TODO, or vague steps.

**Type consistency:** `titleGenerationEnabled` and `titleGenerationPrompt` are added once in `settings.ts` and used consistently in `main.ts` and `titleGeneration.ts`.
