# Changelog

## 0.2.1 - 2026-06-12

- Fixed ASR gateway startup hangs caused by the optional Qwen forced aligner model download.
- Added fast failure handling when the ASR child process exits before becoming ready.
- Added regression tests for gateway lifecycle and Qwen child bootstrap behavior.

## 0.2.0 - 2026-06-06

- Added the local-first Obsidian transcription workflow with recording, upload, note generation, external post-processing, and right-click audio file transcription.
- Added Dockerized ASR gateway lifecycle management, structured transcription responses, voiceprint proxy endpoints, and idle backend unload.
- Added speaker profile storage, confidence-based speaker mapping, speaker map note artifacts, raw ASR sidecars, and AMI meeting test samples.

