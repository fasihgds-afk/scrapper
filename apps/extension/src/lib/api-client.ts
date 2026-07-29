import type {
  BatchAccepted,
  BatchPayload,
  CreateJobInput,
  JobProgress,
  ScrapingJob,
  UpdateJobStatusInput,
} from "@scrapper/shared";

export class ApiClient {
  constructor(private baseUrl: string) {}

  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/$/, "");
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API ${res.status}: ${text}`);
    }
    return (await res.json()) as T;
  }

  createJob(input: CreateJobInput): Promise<ScrapingJob> {
    return this.request("/jobs", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  getJob(jobId: string): Promise<ScrapingJob> {
    return this.request(`/jobs/${jobId}`);
  }

  getProgress(jobId: string): Promise<JobProgress & { queueDepth?: number }> {
    return this.request(`/jobs/${jobId}/progress`);
  }

  updateJob(jobId: string, input: UpdateJobStatusInput): Promise<ScrapingJob> {
    return this.request(`/jobs/${jobId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  sendBatch(jobId: string, payload: BatchPayload): Promise<BatchAccepted> {
    return this.request(`/jobs/${jobId}/batches`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  health(): Promise<{ status: string }> {
    return this.request("/health");
  }
}
