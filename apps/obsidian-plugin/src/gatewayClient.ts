import type { GatewayTranscript, OutputMode } from "./transcript";

export interface GatewayJob {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  result?: GatewayTranscript | null;
  error?: string | null;
}

export interface VoiceprintSpeaker {
  speaker_id: string;
  display_name: string;
  description?: string | null;
  voiceprint_count?: number;
}

export interface VoiceprintSampleUploadResult {
  speaker_id: string;
  voiceprint_count?: number;
}

export interface VoiceprintSpeakerList {
  speakers: VoiceprintSpeaker[];
}

export class GatewayClient {
  constructor(private readonly gatewayUrl: string) {}

  private baseUrl(): string {
    return this.gatewayUrl.replace(/\/+$/, "");
  }

  async health(): Promise<unknown> {
    const response = await fetch(`${this.baseUrl()}/health`);
    if (!response.ok) {
      throw new Error(`Gateway health check failed with HTTP ${response.status}`);
    }
    return response.json();
  }

  async submitJob(options: {
    blob: Blob;
    filename: string;
    language: string;
    model: string;
    outputMode: OutputMode;
  }): Promise<GatewayJob> {
    const form = new FormData();
    form.append("file", options.blob, options.filename);
    form.append("language", options.language || "auto");
    form.append("model", options.model || "auto");
    form.append("output_mode", options.outputMode);

    const response = await fetch(`${this.baseUrl()}/jobs`, {
      method: "POST",
      body: form
    });
    if (!response.ok) {
      throw new Error(`Gateway job submission failed with HTTP ${response.status}`);
    }
    return response.json();
  }

  async getJob(jobId: string): Promise<GatewayJob> {
    const response = await fetch(`${this.baseUrl()}/jobs/${jobId}`);
    if (!response.ok) {
      throw new Error(`Gateway job polling failed with HTTP ${response.status}`);
    }
    return response.json();
  }

  async listVoiceprintSpeakers(): Promise<VoiceprintSpeakerList> {
    const response = await fetch(`${this.baseUrl()}/voiceprints/speakers`);
    if (!response.ok) {
      throw new Error(`Voiceprint speaker list failed with HTTP ${response.status}`);
    }
    return response.json();
  }

  async createVoiceprintSpeaker(options: {
    displayName: string;
    description?: string;
    files: Blob[];
  }): Promise<VoiceprintSpeaker> {
    const form = new FormData();
    form.append("display_name", options.displayName);
    form.append("description", options.description ?? "");
    options.files.forEach((file, index) => {
      form.append("file", file, `voiceprint-${index + 1}.wav`);
    });

    const response = await fetch(`${this.baseUrl()}/voiceprints/speakers`, {
      method: "POST",
      body: form
    });
    if (!response.ok) {
      throw new Error(`Voiceprint speaker creation failed with HTTP ${response.status}`);
    }
    return response.json();
  }

  async addVoiceprintSamples(speakerId: string, files: Blob[]): Promise<VoiceprintSampleUploadResult> {
    const form = new FormData();
    files.forEach((file, index) => {
      form.append("file", file, `voiceprint-sample-${index + 1}.wav`);
    });

    const response = await fetch(
      `${this.baseUrl()}/voiceprints/speakers/${encodeURIComponent(speakerId)}/samples`,
      {
        method: "POST",
        body: form
      }
    );
    if (!response.ok) {
      throw new Error(`Voiceprint sample upload failed with HTTP ${response.status}`);
    }
    return response.json();
  }

  async waitForJob(jobId: string, onUpdate: (job: GatewayJob) => void): Promise<GatewayJob> {
    while (true) {
      const job = await this.getJob(jobId);
      onUpdate(job);
      if (job.status === "completed" || job.status === "failed") {
        return job;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

