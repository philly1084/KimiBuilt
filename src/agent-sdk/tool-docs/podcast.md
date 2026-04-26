# Podcast

`podcast` runs a multi-step workflow for a two-host podcast episode:

1. Research the topic with `web-search`
2. Verify and extract source material with `web-fetch`
3. Generate a scripted two-host conversation with the configured model
4. Synthesize each host with Piper using separate voices
5. Optionally mix in intro/outro/music-bed audio with ffmpeg
6. Optionally export MP3 with ffmpeg
7. Save the final audio artifacts into the active session
8. Optionally render an MP4 podcast video from the saved audio and transcript

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
- `includeVideo` (set `true` to render an MP4 after audio generation)
- `videoAspectRatio` (`16:9`, `9:16`, or `1:1`)
- `videoImageMode` (`mixed`, `web`, `unsplash`, `generated`, or `fallback`)
- `videoGenerateImages` (set `true` to allow generated images for scenes)
- `videoSceneCount`
- `videoVisualStyle`

Notes:

- The tool requires an active session because it persists the final audio artifact.
- Research quality depends on `web-search` availability and source accessibility.
- Speech stitching is native PCM WAV concatenation, so the selected Piper voices must emit compatible WAV output.
- Podcast renders prefer the stable two-host voice pair first and only apply ffmpeg mastering when `enhanceSpeech` is explicitly enabled.
- Long-form episodes use podcast-specific Piper chunking and timeout controls; override them with `ttsChunkMaxChars` or `ttsTimeoutMs` if a machine is unusually slow.
- Podcast TTS still defaults to the existing curated six-voice studio pool, but the bundled Piper catalog now includes additional high-quality `lessac`, `ljspeech`, `ryan`, and `cori` options for explicit host selection.
- Each host keeps a stable primary voice unless you set `cycleHostVoices: true`; when a Piper render fails, the tool now falls through to the next voice in that host's pool by default.
- Source verification still uses bounded parallelism by default. Podcast TTS concurrency is conservative by default; only raise `ttsConcurrency` if you need speed more than render stability.
- MP3 export and intro/outro/music-bed mixing require ffmpeg audio processing to be configured.
- MP4 podcast video rendering also requires ffmpeg. The video pipeline plans timestamped scenes from the transcript, then tries direct/provided images, web-search page image extraction, Unsplash, generated images when allowed, and deterministic fallback frames.
- Still images are rendered with slow pan/zoom treatment and fade transitions, then muxed to the actual podcast audio timeframe.
- Only use music beds you are licensed to use. Provide a legal audio file path or upload; do not source copyrighted music without permission.
- Check `/api/tts/voices` for the exact `hostA` / `hostB` voice IDs supported in your current deployment before passing custom `hostAVoiceIds` and `hostBVoiceIds`.
- Example: `hostAVoiceIds: ["lessac-high", "ljspeech-high", "cori-high"]` and `hostBVoiceIds: ["ryan-high", "ryan-direct", "amy-broadcast"]` lets the same host cycle through multiple Piper voices per turn with a more premium-sounding mix.
