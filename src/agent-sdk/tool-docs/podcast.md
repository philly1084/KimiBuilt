# Podcast

`podcast` runs a multi-step workflow for a two-host podcast episode:

1. Research the topic with `web-search`
2. Verify and extract source material with `web-fetch`
3. Generate a scripted two-host conversation with the configured model
4. Synthesize each host with Piper using separate voices
5. Optionally mix in intro/outro/music-bed audio with ffmpeg
6. Optionally export MP3 with ffmpeg
7. Save the final audio artifacts into the active session

Required input:

- `topic`

Useful optional inputs:

- `durationMinutes`
- `audience`
- `tone`
- `hostAName`, `hostBName`
- `hostAVoiceId`, `hostBVoiceId`
- `hostAVoiceIds`, `hostBVoiceIds` (ordered lists to cycle voices)
- `cycleHostVoices` (default: false)
- `allowVoiceFallback` (default: true, lets a host fall through to the next curated voice on Piper failures)
- `enhanceSpeech` (`false` by default, set `true` when you explicitly want ffmpeg mastering)
- `hostAPersona`, `hostBPersona`
- `sourceUrls`
- `searchDomains`
- `includeIntro`, `includeOutro`, `includeMusicBed`
- `enhanceSpeech`
- `introPath`, `outroPath`, `musicBedPath`
- `exportMp3`, `outputFormat`, `mp3BitrateKbps`
- `ttsTimeoutMs`, `ttsChunkMaxChars`
- `ttsConcurrency`, `researchConcurrency`

Notes:

- The tool requires an active session because it persists the final audio artifact.
- Research quality depends on `web-search` availability and source accessibility.
- Speech stitching is native PCM WAV concatenation, so the selected Piper voices must emit compatible WAV output.
- Podcast renders prefer the stable two-host voice pair first and only apply ffmpeg mastering when `enhanceSpeech` is explicitly enabled.
- Long-form episodes use podcast-specific Piper chunking and timeout controls; override them with `ttsChunkMaxChars` or `ttsTimeoutMs` if a machine is unusually slow.
- Podcast TTS now defaults to a curated six-voice studio pool across both hosts, conservative chunking, and a slightly longer long-form timeout budget.
- Each host keeps a stable primary voice unless you set `cycleHostVoices: true`; when a Piper render fails, the tool now falls through to the next voice in that host's pool by default.
- Source verification still uses bounded parallelism by default. Podcast TTS concurrency is conservative by default; only raise `ttsConcurrency` if you need speed more than render stability.
- MP3 export and intro/outro/music-bed mixing require ffmpeg audio processing to be configured.
- Check `/api/tts/voices` for the exact `hostA` / `hostB` voice IDs supported in your current deployment before passing custom `hostAVoiceIds` and `hostBVoiceIds`.
- Example: `hostAVoiceIds: ["hfc-female-rich", "hfc-female-medium", "kathleen-low"]` and `hostBVoiceIds: ["amy-expressive", "amy-broadcast", "amy-medium"]` lets the same host cycle through multiple Piper voices per turn.
