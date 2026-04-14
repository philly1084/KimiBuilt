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
- `hostAPersona`, `hostBPersona`
- `sourceUrls`
- `searchDomains`
- `includeIntro`, `includeOutro`, `includeMusicBed`
- `introPath`, `outroPath`, `musicBedPath`
- `exportMp3`, `outputFormat`, `mp3BitrateKbps`
- `ttsTimeoutMs`, `ttsChunkMaxChars`

Notes:

- The tool requires an active session because it persists the final audio artifact.
- Research quality depends on `web-search` availability and source accessibility.
- Speech stitching is native PCM WAV concatenation, so the selected Piper voices must emit compatible WAV output.
- Long-form episodes use podcast-specific Piper chunking and timeout controls; override them with `ttsChunkMaxChars` or `ttsTimeoutMs` if a machine is unusually slow.
- MP3 export and intro/outro/music-bed mixing require ffmpeg audio processing to be configured.
