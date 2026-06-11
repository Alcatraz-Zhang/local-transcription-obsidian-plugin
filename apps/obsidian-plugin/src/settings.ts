import type { OutputMode } from "./transcript";

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
}

export const POST_PROCESSING_SECRET_ID = "local-transcription-post-processing-api-key";

export const DEFAULT_POST_PROCESSING_PROMPT = [
  "请作为转录稿编辑器整理转录稿，目标是把口语转录整理成适合直接阅读的记录稿，同时保留原意、语言、语气强弱和说话人的表达重点。",
  "编辑范围：",
  "1. 只修改每行时间戳和说话人标签之后的正文；时间戳、说话人名称、行顺序和一行一个发言片段的结构必须保留。",
  "2. 如果原文没有时间戳或说话人标签，也不要新增标签。",
  "需要修改：",
  "3. 修正明显的错别字、同音误识别、标点、断句、大小写和无意义重复，让句子自然通顺。",
  "4. 删除不影响含义的语气词、拖延词、填充词、口头禅和口吃，例如 emmm、嗯、呃、啊、嘛、ma、a、这个、就是、然后然后、我我我 等。",
  "5. 清理明显的自我纠正和废话片段，例如“不是不是”“等一下我重说”；但如果这些内容表达真实态度、犹豫、否定、强调或情绪，请保留。",
  "6. 保留专有名词、人名、项目名、术语、数字、日期、金额、代码、命令、URL 和引用内容；中英混杂内容不要擅自翻译或替换。",
  "7. 可以合并过短碎句或补充必要标点，但不要改变原段落顺序，不要把转录稿改成摘要、会议纪要、待办事项或列表。",
  "禁止：",
  "8. 不要编造原文没有的信息，不要补充背景知识，不要加入评价、解释、标题、结论或行动项。",
  "9. 不要改变说话人归属，不要删除有实质信息的重复、停顿、反问、强调或不确定表达。",
  "10. 不要输出处理说明、Markdown 包裹、前言或后记。",
  "输出：",
  "直接输出整理后的转录稿。"
].join("\n");

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
  keepOriginalTranscription: true
};

