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
  postProcessingPrompt: "You are a transcription editor. Clean up grammar and readability while preserving the original meaning and language.",
  keepOriginalTranscription: true
};

