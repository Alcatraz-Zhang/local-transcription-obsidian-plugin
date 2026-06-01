export interface TemplateVariables {
  audioFile: string;
  transcription: string;
  title: string;
  date: string;
  datetime: string;
}

export function expandTemplate(template: string, variables: TemplateVariables): string {
  return template.replace(/\{\{(audioFile|transcription|title|date|datetime)\}\}/g, (_match, key: keyof TemplateVariables) => {
    return variables[key];
  });
}

export function safeNoteFileName(value: string): string {
  return value.replace(/[\/\\?%*:|"<>]/g, "-").replace(/\s+/g, " ").trim() || "Untitled transcription";
}

export function defaultTitleFromFile(filename: string): string {
  const lastSlash = Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\"));
  const basename = lastSlash >= 0 ? filename.slice(lastSlash + 1) : filename;
  return basename.replace(/\.[^.]+$/, "") || "Meeting transcription";
}

