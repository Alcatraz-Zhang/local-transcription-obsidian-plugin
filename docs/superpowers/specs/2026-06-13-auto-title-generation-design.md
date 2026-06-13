# Auto Title Generation Design

## Goal

Add an optional auto-title generation feature to the Obsidian plugin. When enabled, the plugin asks the configured post-processing LLM to produce a concise title from the transcript and uses that title for both the `{{title}}` template variable and the note filename.

## Background

The plugin currently derives the note title from the source audio filename via `defaultTitleFromFile(sourceName)`. The title is used as the `{{title}}` template variable and as part of the filename through `noteFilenameTemplate` (`{{datetime}} - {{title}}`).

The plugin already supports LLM post-processing of transcripts using an OpenAI-compatible chat endpoint, model, and API key stored in Obsidian `secretStorage`.

## Decision Log

- Reuse the existing post-processing endpoint, model, and API key. Title generation only adds a new prompt setting.
- Generate the title from the final transcript text: post-processed text when post-processing is enabled, otherwise raw transcript text.
- The generated title replaces the filename-derived title for both `{{title}}` and the note filename.
- On LLM failure, fall back to the filename-derived title and surface a Notice instead of failing transcription.

## Architecture

```text
Settings
  titleGenerationEnabled: boolean
  titleGenerationPrompt: string

CreateTranscriptNote
  finalText = postProcessingEnabled ? postProcess(rawText) : rawText
  title = titleGenerationEnabled ? generateTitle(finalText) : defaultTitleFromFile(sourceName)
  filename = safeNoteFileName(expandTemplate(noteFilenameTemplate, { ..., title }))
  content = expandTemplate(noteTemplate, { ..., title })
```

## Settings

Add two fields to `LocalTranscriptionSettings` in `apps/obsidian-plugin/src/settings.ts`:

- `titleGenerationEnabled`: boolean, default `false`
- `titleGenerationPrompt`: string, default Chinese prompt (see below)

UI placement: directly below the existing **Post-processing** section in `LocalTranscriptionSettingTab`.

When the toggle is off, the prompt textarea is hidden. When on, the textarea is shown, similar to how post-processing options expand.

### Default Prompt

```text
请根据以下转录稿生成一个简洁、准确的笔记标题，直接表达内容主题。
要求：
1. 标题长度控制在 30 个汉字或 60 个字符以内。
2. 不要包含时间戳、说话人标签或无关修饰。
3. 不要返回解释、引号或 Markdown 格式，只返回标题文本本身。
```

The implementation appends a final instruction to ensure only the title is returned.

## Core Logic

### `apps/obsidian-plugin/src/titleGeneration.ts` (new)

- `buildTitleGenerationPrompt(userPrompt: string): string` — combines the user prompt with a mandatory "only return the title" constraint.
- `generateTitle(options: { endpoint; apiKey; model; prompt; transcript; request }): Promise<string>` — calls the LLM with the transcript and returns the trimmed content.

This mirrors `postProcessing.ts` but uses the title prompt and returns the result directly without merging.

### `apps/obsidian-plugin/src/main.ts`

In `createTranscriptNote`:

1. Compute `finalText` exactly as today.
2. If `titleGenerationEnabled`:
   - Read the post-processing API key.
   - Call `generateTitle` with `finalText`, the configured endpoint/model, and `titleGenerationPrompt`.
   - Sanitize the result with `safeNoteFileName`.
   - If generation fails, log the error, show a Notice, and fall back to `defaultTitleFromFile(sourceName)`.
3. Otherwise use `defaultTitleFromFile(sourceName)`.
4. Use the resolved `title` for `variables.title` and the filename.

## Error Handling

- Missing API key when title generation is enabled: throw an explicit error, matching post-processing behavior.
- LLM call fails or returns empty content: fall back to filename-derived title and show a Notice so transcription is not lost.

## Testing

- Unit tests for `buildTitleGenerationPrompt` and `generateTitle` in `apps/obsidian-plugin/src/titleGeneration.test.ts`.
- Unit tests for `safeNoteFileName` behavior with generated titles.
- Settings defaults test updated in existing settings-related tests if any.
- Build and plugin tests must pass: `npm run build` and `npm run test:plugin`.

## Release

Bump version from `0.2.1` to `0.2.2` in all versioned files:

- `package.json`
- `apps/obsidian-plugin/package.json`
- `apps/obsidian-plugin/manifest.json`
- `services/gateway/pyproject.toml`
- `services/gateway/Dockerfile` (`IMAGE_VERSION` and `org.opencontainers.image.version` label)
- `docker-compose.yml` (`image: local-transcription:0.2.2`)

Then:

1. Build: `npm run build`
2. Commit all changes.
3. Tag: `git tag v0.2.2`
4. Push tag.
5. Create GitHub release `v0.2.2` with attached `main.js`, `manifest.json`, and `styles.css`.

Release notes style should match previous releases: short bullet list in Chinese and English, BRAT/Obsidian assets note.

## Open Questions

None at design time; resolved with user confirmation:
- Reuse post-processing endpoint/model/key: yes.
- Use generated title for filename as well as `{{title}}`: yes.
