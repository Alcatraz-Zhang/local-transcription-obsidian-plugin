const state = {
  currentJob: null,
  currentResult: null,
  pollTimer: null,
};

const $ = (id) => document.getElementById(id);

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 3200);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }
  if (!response.ok) {
    throw new Error(payload.message || `${response.status} ${response.statusText}`);
  }
  return payload;
}

function setBadge(element, label, mode = "") {
  element.className = `badge ${mode}`.trim();
  element.textContent = label;
}

function jobBadgeMode(status) {
  if (status === "failed") return "danger";
  if (status === "completed") return "";
  return "warn";
}

async function refreshHealth() {
  const health = await requestJson("/health");
  $("activeTasks").textContent = health.active_tasks;
  $("queuedJobs").textContent = health.queued_jobs;
  $("idleTimeout").textContent = `${health.idle_timeout_seconds}s`;
  $("statusLine").textContent = `Gateway ok, backend ${health.backend_running ? "running" : "idle"}`;
  setBadge($("backendState"), health.backend_running ? "running" : "idle", health.backend_running ? "" : "muted");
}

async function refreshVoiceprintHealth() {
  const health = await requestJson("/voiceprints/health");
  const dbLabel = health.db_exists ? `${health.speaker_count ?? 0} speakers` : "db not created";
  $("voiceprintState").textContent = health.enabled ? dbLabel : "disabled";
  setBadge($("speakerCount"), dbLabel, health.enabled ? "" : "danger");
}

function renderTranscript(job) {
  state.currentResult = job.result;
  const text = job.result?.text || "";
  const segments = Array.isArray(job.result?.segments) ? job.result.segments : [];
  const segmentText = segments
    .map((segment) => {
      const speaker = segment.speaker || "Speaker";
      const start = Number(segment.start ?? 0).toFixed(2);
      const end = Number(segment.end ?? 0).toFixed(2);
      return `[${start}-${end}] ${speaker}: ${segment.text || ""}`;
    })
    .join("\n");
  $("transcriptOutput").textContent = segmentText || text || JSON.stringify(job.result, null, 2);
  $("copyText").disabled = !text;
  $("downloadJson").disabled = !job.result;
}

async function pollJob(jobId) {
  const job = await requestJson(`/jobs/${jobId}`);
  state.currentJob = job;
  setBadge($("jobState"), job.status, jobBadgeMode(job.status));
  if (job.status === "completed") {
    window.clearInterval(state.pollTimer);
    renderTranscript(job);
    showToast("Transcription completed");
  } else if (job.status === "failed") {
    window.clearInterval(state.pollTimer);
    $("transcriptOutput").textContent = job.error || "Transcription failed";
    showToast("Transcription failed");
  }
  await refreshHealth();
}

async function submitTranscription(event) {
  event.preventDefault();
  const file = $("audioFile").files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("language", $("language").value);
  formData.append("model", $("model").value);

  setBadge($("jobState"), "uploading", "warn");
  $("transcriptOutput").textContent = "Uploading audio...";
  $("copyText").disabled = true;
  $("downloadJson").disabled = true;
  state.currentResult = null;

  try {
    const job = await requestJson("/jobs", { method: "POST", body: formData });
    state.currentJob = job;
    setBadge($("jobState"), job.status, "warn");
    $("transcriptOutput").textContent = `Job ${job.id} queued.`;
    window.clearInterval(state.pollTimer);
    state.pollTimer = window.setInterval(() => pollJob(job.id).catch((error) => showToast(error.message)), 2500);
    await pollJob(job.id);
  } catch (error) {
    setBadge($("jobState"), "failed", "danger");
    $("transcriptOutput").textContent = error.message;
  }
}

function speakerArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.speakers)) return payload.speakers;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

function speakerId(speaker) {
  return speaker.speaker_id || speaker.id || speaker.uuid || "";
}

async function refreshSpeakers() {
  const container = $("speakerList");
  try {
    const payload = await requestJson("/voiceprints/speakers");
    const speakers = speakerArray(payload);
    container.textContent = "";
    if (!speakers.length) {
      container.textContent = "No speakers enrolled.";
      return;
    }
    for (const speaker of speakers) {
      const id = speakerId(speaker);
      const row = document.createElement("div");
      row.className = "speaker-row";
      const details = document.createElement("div");
      const name = document.createElement("strong");
      const code = document.createElement("code");
      const meta = document.createElement("small");
      const button = document.createElement("button");
      name.textContent = speaker.display_name || speaker.name || "Unnamed speaker";
      code.textContent = id;
      meta.textContent = `samples: ${speaker.voiceprint_count ?? speaker.sample_count ?? "-"}`;
      button.type = "button";
      button.textContent = "Delete";
      button.disabled = !id;
      button.addEventListener("click", () => deleteSpeaker(id));
      details.append(name, code, meta);
      row.append(details, button);
      container.append(row);
    }
  } catch (error) {
    container.textContent = error.message;
  }
}

async function createSpeaker(event) {
  event.preventDefault();
  const formData = new FormData();
  formData.append("display_name", $("speakerName").value);
  formData.append("description", $("speakerDescription").value);
  formData.append("file", $("speakerFile").files[0]);
  await requestJson("/voiceprints/speakers", { method: "POST", body: formData });
  event.target.reset();
  showToast("Speaker created");
  await refreshVoiceprints();
}

async function addSample(event) {
  event.preventDefault();
  const id = $("sampleSpeakerId").value.trim();
  const formData = new FormData();
  formData.append("file", $("sampleFile").files[0]);
  await requestJson(`/voiceprints/speakers/${encodeURIComponent(id)}/samples`, { method: "POST", body: formData });
  event.target.reset();
  showToast("Sample added");
  await refreshVoiceprints();
}

async function deleteSpeaker(id) {
  if (!id) return;
  await requestJson(`/voiceprints/speakers/${encodeURIComponent(id)}`, { method: "DELETE" });
  showToast("Speaker deleted");
  await refreshVoiceprints();
}

async function refreshVoiceprints() {
  await refreshVoiceprintHealth();
  await refreshSpeakers();
}

async function refreshStatusOnly() {
  await refreshHealth();
  await refreshVoiceprintHealth();
}

function copyTranscriptText() {
  const text = state.currentResult?.text || "";
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => showToast("Text copied"));
}

function downloadResultJson() {
  if (!state.currentResult) return;
  const blob = new Blob([JSON.stringify(state.currentResult, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `transcript-${state.currentJob?.id || "result"}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function refreshAll() {
  try {
    await refreshStatusOnly();
  } catch (error) {
    showToast(error.message);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  $("transcriptionForm").addEventListener("submit", submitTranscription);
  $("createSpeakerForm").addEventListener("submit", (event) => createSpeaker(event).catch((error) => showToast(error.message)));
  $("addSampleForm").addEventListener("submit", (event) => addSample(event).catch((error) => showToast(error.message)));
  $("copyText").addEventListener("click", copyTranscriptText);
  $("downloadJson").addEventListener("click", downloadResultJson);
  $("refreshAll").addEventListener("click", refreshAll);
  $("loadSpeakers").addEventListener("click", () => refreshVoiceprints().catch((error) => showToast(error.message)));
  refreshAll();
  window.setInterval(() => refreshHealth().catch(() => {}), 5000);
});
