---
status: frozen
version: 1.0
date: 2026-10-15
---

# Revenue Lab ElevenLabs TTS Adapter v1

## Goal

Generate Japanese narration audio for each `planned` Creative Archetype v2 narration segment, measure the resulting MP3 with FFprobe, store it in private immutable storage, and atomically transition the existing `creative_audio_artifacts` row to `ready`. This adapter does not alter Three Picks v1, Product Asset lineage, Publication, Analytics, Pollo, Wan, or I2V.

## Provider contract

The provider is `elevenlabs`, adapter version `elevenlabs-tts-adapter-v1`, and output format `mp3_44100_128`. The configured model and voice are read from the private launcher through `REVENUE_LAB_ELEVENLABS_MODEL_ID` and `REVENUE_LAB_ELEVENLABS_VOICE_ID`; `eleven_multilingual_v2` is the recommended initial model but is not hard-coded. One voice is fixed per running worker.

Each request contains one narration segment, explicit voice settings, `apply_text_normalization="auto"`, and a stable integer seed derived from the generation fingerprint. Normalization is selected through a deny-by-default model capability map. `eleven_multilingual_v2` does not send `apply_language_text_normalization` or `language_code`; a future model may enable language text normalization only after its capability is explicitly registered. The seed improves repeatability for identical inputs but ElevenLabs does not guarantee byte-identical or fully deterministic output. The adapter therefore never treats seed equality as provider idempotency.

The adapter captures `character-cost`, `request-id`, and `x-trace-id` response headers. It returns audio bytes and sealed metadata only; API keys, authorization headers, and request text are never logged. The API key exists only in the private launcher/runtime environment and is never persisted in a job payload, Dashboard response, database row, or log.

## At-most-once generation

The generation fingerprint is SHA-256 over the artifact ID, input SHA-256, provider, adapter version, configured model, configured voice, output format, exact voice settings, the model capability's actual request normalization settings, stable-seed algorithm version, and fingerprint schema version. New scheduling uses `creative-audio-generation-v2`; existing failed artifacts remain terminal and are never reused or resubmitted. The seed value is then derived from that fingerprint, avoiding a circular fingerprint input. The object key is known before submission:

`creative-audio/<plan-id>/<segment-id>/<generation-fingerprint>.mp3`

The database enforces `planned → generating → ready | failed | submission_uncertain` through service-role-only RPCs. Direct table updates are not granted. Only a worker that atomically claims `planned → generating` may call ElevenLabs. Jobs use `creative.audio.generate.v1:<artifact-id>:<generation-fingerprint>` and contain only the artifact ID and generation fingerprint. `max_attempts=2` permits one expired-lease recovery pass; the second pass cannot acquire the provider-send claim and may only recover an existing blob or seal the artifact as `submission_uncertain`.

No automatic provider resubmission is allowed from `generating`, `ready`, `failed`, or `submission_uncertain`. A timeout, transport interruption, malformed successful response, or worker loss after dispatch is classified as `submission_uncertain`. ElevenLabs History recovery is explicitly out of scope for v1. If the deterministic object already exists after a worker restart, blob recovery verifies it, measures it, and finalizes the artifact without another provider call.

## Storage and duration

Audio is stored in the private Supabase bucket `revenue-lab-creative-audio`, which must differ from Product Asset and Composition buckets. Writes are immutable (`x-upsert=false`), reads are server-side, and both recovery and composition verify SHA-256. Duration is always measured from the received/stored MP3 with FFprobe; text-length estimates and provider timing estimates are prohibited.

Provider failure never creates silence or a synthetic fallback. Final Composition remains blocked until every narration artifact is `ready`.

## Runtime configuration

The private launcher supplies `ELEVENLABS_API_KEY`, `REVENUE_LAB_ELEVENLABS_MODEL_ID`, `REVENUE_LAB_ELEVENLABS_VOICE_ID`, `REVENUE_LAB_ELEVENLABS_TIMEOUT_MS`, `REVENUE_LAB_CREATIVE_AUDIO_BUCKET=revenue-lab-creative-audio`, and the existing `REVENUE_LAB_FFPROBE_PATH`. `.env` files are not used.

## Non-goals

No provider History reconciliation, automatic retry, multi-voice selection, speech-to-speech, alignment API, audio fallback, Live API call, bucket creation, Live migration, paid generation, v1 modification, commit, push, or merge.
