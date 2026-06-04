import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayClient, type VoiceprintSampleUploadResult, type VoiceprintSpeakerList } from "./gatewayClient";

function mockFetch(response: Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function getFetchBody(fetchMock: ReturnType<typeof vi.fn>): FormData {
  const body = fetchMock.mock.calls[0]?.[1]?.body;
  expect(body).toBeInstanceOf(FormData);
  return body as FormData;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GatewayClient voiceprint speakers", () => {
  it("lists speakers using a normalized URL and returns the speaker payload", async () => {
    const payload: VoiceprintSpeakerList = {
      speakers: [
        {
          speaker_id: "speaker-1",
          display_name: "Alice",
          description: null,
          voiceprint_count: 2
        }
      ]
    };
    const fetchMock = mockFetch(jsonResponse(payload));
    const client = new GatewayClient("http://gateway.local///");

    await expect(client.listVoiceprintSpeakers()).resolves.toEqual(payload);

    expect(fetchMock).toHaveBeenCalledWith("http://gateway.local/voiceprints/speakers");
  });

  it("posts speaker creation as FormData with expected fields and generated file names", async () => {
    const fetchMock = mockFetch(jsonResponse({ speaker_id: "speaker-1", display_name: "Alice" }));
    const client = new GatewayClient("http://gateway.local/");
    const files = [new Blob(["voice-one"]), new Blob(["voice-two"])];

    await client.createVoiceprintSpeaker({
      displayName: "Alice",
      description: "PM voice",
      files
    });

    expect(fetchMock).toHaveBeenCalledWith("http://gateway.local/voiceprints/speakers", {
      method: "POST",
      body: expect.any(FormData)
    });
    const form = getFetchBody(fetchMock);
    expect(form.get("display_name")).toBe("Alice");
    expect(form.get("description")).toBe("PM voice");
    expect(form.getAll("file").map((file) => (file as File).name)).toEqual([
      "voiceprint-1.wav",
      "voiceprint-2.wav"
    ]);
  });

  it("defaults speaker creation description to an empty string", async () => {
    const fetchMock = mockFetch(jsonResponse({ speaker_id: "speaker-1", display_name: "Alice" }));
    const client = new GatewayClient("http://gateway.local/");

    await client.createVoiceprintSpeaker({
      displayName: "Alice",
      files: [new Blob(["voice-one"])]
    });

    expect(getFetchBody(fetchMock).get("description")).toBe("");
  });

  it("posts voiceprint samples to an encoded speaker URL with generated sample names", async () => {
    const payload: VoiceprintSampleUploadResult = { speaker_id: "speaker one+two", voiceprint_count: 3 };
    const fetchMock = mockFetch(jsonResponse(payload));
    const client = new GatewayClient("http://gateway.local/");
    const files = [new Blob(["voice-one"]), new Blob(["voice-two"])];

    await expect(client.addVoiceprintSamples("speaker one+two", files)).resolves.toEqual(payload);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://gateway.local/voiceprints/speakers/speaker%20one%2Btwo/samples",
      {
        method: "POST",
        body: expect.any(FormData)
      }
    );
    expect(getFetchBody(fetchMock).getAll("file").map((file) => (file as File).name)).toEqual([
      "voiceprint-sample-1.wav",
      "voiceprint-sample-2.wav"
    ]);
  });

  it("throws a clear HTTP error when listing speakers fails", async () => {
    mockFetch(jsonResponse({ detail: "bad" }, 503));
    const client = new GatewayClient("http://gateway.local/");

    await expect(client.listVoiceprintSpeakers()).rejects.toThrow(
      "Voiceprint speaker list failed with HTTP 503"
    );
  });

  it("throws a clear HTTP error when creating a speaker fails", async () => {
    mockFetch(jsonResponse({ detail: "bad" }, 422));
    const client = new GatewayClient("http://gateway.local/");

    await expect(
      client.createVoiceprintSpeaker({
        displayName: "Alice",
        files: [new Blob(["voice-one"])]
      })
    ).rejects.toThrow("Voiceprint speaker creation failed with HTTP 422");
  });

  it("throws a clear HTTP error when uploading samples fails", async () => {
    mockFetch(jsonResponse({ detail: "bad" }, 409));
    const client = new GatewayClient("http://gateway.local/");

    await expect(client.addVoiceprintSamples("speaker-1", [new Blob(["voice-one"])])).rejects.toThrow(
      "Voiceprint sample upload failed with HTTP 409"
    );
  });
});
