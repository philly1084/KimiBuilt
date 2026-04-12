# Podcast

`podcast` runs a multi-step workflow for a two-host podcast episode:

1. Research the topic with `web-search`
2. Verify and extract source material with `web-fetch`
3. Generate a scripted two-host conversation with the configured model
4. Synthesize each host with Piper using separate voices
5. Stitch the WAV segments together and save the final audio as a session artifact

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

Notes:

- The tool requires an active session because it persists the final audio artifact.
- Research quality depends on `web-search` availability and source accessibility.
- Audio stitching is native PCM WAV concatenation, so the selected Piper voices must emit compatible WAV output.
