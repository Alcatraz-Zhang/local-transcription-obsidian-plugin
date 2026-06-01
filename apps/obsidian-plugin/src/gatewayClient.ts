import type { GatewayTranscript, OutputMode } from "./transcript";

export interface GatewayJob {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  result?: GatewayTranscript | null;
  error?: string | null;
}

export class GatewayClient {
  constructor(private readonly gatewayUrl: string) {}

  async health(): Promise<unknown> {
    const response = await fetch(`${this.gatewayUrl.replace(/\/$/, "")}/health`);
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

    const response = await fetch(`${this.gatewayUrl.replace(/\/$/, "")}/jobs`, {
      method: "POST",
      body: form
    });
    if (!response.ok) {
      throw new Error(`Gateway job submission failed with HTTP ${response.status}`);
    }
    return response.json();
  }

  async getJob(jobId: string): Promise<GatewayJob> {
    const response = await fetch(`${this.gatewayUrl.replace(/\/$/, "")}/jobs/${jobId}`);
    if (!response.ok) {
      throw new Error(`Gateway job polling failed with HTTP ${response.status}`);
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

