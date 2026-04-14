const { createResponse } = require('../openai-client');
const { piperTtsService, normalizeTextForSpeech } = require('../tts/piper-tts-service');
const { persistGeneratedAudio, updateGeneratedAudioSessionState } = require('../generated-audio-artifacts');
const { audioProcessingService } = require('../audio/audio-processing-service');
const { concatWavBuffers, createSilenceWavBuffer, parseWavBuffer } = require('../audio/wav-utils');
const { chunkText, normalizeWhitespace, stripHtml, stripNullCharacters } = require('../utils/text');
const { parseLenientJson } = require('../utils/lenient-json');

const DEFAULT_DURATION_MINUTES = 10;
const DEFAULT_TARGET_WPM = 145;
const DEFAULT_MAX_SOURCES = 4;
const DEFAULT_SILENCE_MS = 325;
const DEFAULT_TRANSIENT_RETRY_ATTEMPTS = 2;
const DEFAULT_TRANSIENT_RETRY_DELAY_MS = 1200;
const DEFAULT_HOSTS = Object.freeze([
  {
    key: 'hostA',
    name: 'Maya',
    role: 'Lead host',
    persona: 'Warm, curious, and good at guiding the listener through the big picture.',
    preferredVoiceIds: ['hfc-female-rich', 'amy-medium', 'hfc-female-medium', 'kathleen-low'],
  },
  {
    key: 'hostB',
    name: 'June',
    role: 'Co-host',
    persona: 'Sharper, more analytical, and slightly playful when unpacking details and tradeoffs.',
    preferredVoiceIds: ['amy-medium', 'amy-expressive', 'hfc-female-medium', 'kathleen-low'],
  },
]);

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, numeric));
}

function stripUnpairedSurrogates(value = '') {
  const input = String(value || '');
  let output = '';

  for (let index = 0; index < input.length; index += 1) {
    const codeUnit = input.charCodeAt(index);

    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const nextCodeUnit = input.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xDC00 && nextCodeUnit <= 0xDFFF) {
        output += input[index] + input[index + 1];
        index += 1;
      }
      continue;
    }

    if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      continue;
    }

    output += input[index];
  }

  return output;
}

function sanitizePodcastText(value = '', { preserveNewlines = false } = {}) {
  const base = stripUnpairedSurrogates(stripNullCharacters(value || ''))
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ');

  let normalized = '';
  try {
    normalized = base.normalize('NFKC');
  } catch (_error) {
    normalized = base;
  }

  const whitespaceNormalized = preserveNewlines
    ? normalizeWhitespace(normalized).replace(/\n{3,}/g, '\n\n')
    : normalized.replace(/\s+/g, ' ').trim();

  return whitespaceNormalized.trim();
}

function estimateWordBudget(durationMinutes = DEFAULT_DURATION_MINUTES) {
  return Math.round(durationMinutes * DEFAULT_TARGET_WPM);
}

function estimateTurnCount(durationMinutes = DEFAULT_DURATION_MINUTES) {
  return Math.max(12, Math.min(22, Math.round(durationMinutes * 1.7)));
}

function normalizeVariantFilename(filename = '', extension = 'wav') {
  const normalizedFilename = String(filename || '').trim();
  const normalizedExtension = String(extension || '').trim().replace(/^\./, '').toLowerCase() || 'wav';
  if (!normalizedFilename) {
    return '';
  }

  if (/\.[a-z0-9]+$/i.test(normalizedFilename)) {
    return normalizedFilename.replace(/\.[a-z0-9]+$/i, `.${normalizedExtension}`);
  }

  return `${normalizedFilename}.${normalizedExtension}`;
}

function wait(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function prefersMp3(params = {}) {
  if (params.exportMp3 === true) {
    return true;
  }

  const outputFormat = String(params.outputFormat || params.format || '').trim().toLowerCase();
  return outputFormat === 'mp3';
}

function requestedMixing(params = {}) {
  return params.includeIntro === true
    || params.includeOutro === true
    || params.includeMusicBed === true
    || Boolean(String(params.introPath || '').trim())
    || Boolean(String(params.outroPath || '').trim())
    || Boolean(String(params.musicBedPath || '').trim());
}

function uniqueUrls(items = []) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter((item) => {
    const url = String(item?.url || '').trim();
    if (!url || seen.has(url)) {
      return false;
    }
    seen.add(url);
    return true;
  });
}

function isTransientPodcastError(error = {}) {
  const message = String(error?.message || '').trim().toLowerCase();
  const code = String(error?.code || '').trim().toLowerCase();
  const statusCode = Number(error?.statusCode || error?.status || 0);

  if (statusCode >= 500 || statusCode === 408 || statusCode === 429) {
    return true;
  }

  return [
    'connection terminated unexpectedly',
    'socket hang up',
    'fetch failed',
    'econnreset',
    'etimedout',
    'timed out',
    'eai_again',
    'temporarily unavailable',
    'service unavailable',
    'bad gateway',
    'gateway timeout',
  ].some((pattern) => message.includes(pattern) || code.includes(pattern));
}

function getResponseText(response = {}) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const output = Array.isArray(response?.output) ? response.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const chunk of content) {
      const text = chunk?.text || chunk?.output_text || '';
      if (typeof text === 'string' && text.trim()) {
        return text.trim();
      }
    }
  }

  return '';
}

function extractFetchedText(fetchData = {}, maxChars = 2200) {
  const body = sanitizePodcastText(fetchData?.body || '', { preserveNewlines: true });
  if (!body) {
    return '';
  }

  const contentType = String(fetchData?.headers?.['content-type'] || fetchData?.headers?.['Content-Type'] || '').toLowerCase();
  const plain = contentType.includes('html') ? stripHtml(body) : body;
  const normalized = sanitizePodcastText(plain, { preserveNewlines: true }).replace(/\n{2,}/g, '\n');
  return normalized.slice(0, maxChars).trim();
}

function buildTranscript(turns = []) {
  return (Array.isArray(turns) ? turns : [])
    .map((turn) => `${sanitizePodcastText(turn.speaker)}: ${sanitizePodcastText(turn.text)}`)
    .join('\n\n')
    .trim();
}

function normalizeTurn(turn = {}, allowedSpeakers = new Set()) {
  const speaker = sanitizePodcastText(turn?.speaker || '');
  const text = sanitizePodcastText(turn?.text || '', { preserveNewlines: true });
  if (!speaker || !text || !allowedSpeakers.has(speaker)) {
    return null;
  }

  return { speaker, text };
}

function resolveVoiceId(preferredVoiceIds = [], availableVoices = [], usedVoiceIds = new Set()) {
  const voices = Array.isArray(availableVoices) ? availableVoices : [];
  const firstUnusedPreferred = preferredVoiceIds.find((voiceId) => voices.some((voice) => voice.id === voiceId) && !usedVoiceIds.has(voiceId));
  if (firstUnusedPreferred) {
    usedVoiceIds.add(firstUnusedPreferred);
    return firstUnusedPreferred;
  }

  const firstUnused = voices.find((voice) => !usedVoiceIds.has(voice.id));
  if (firstUnused?.id) {
    usedVoiceIds.add(firstUnused.id);
    return firstUnused.id;
  }

  const fallback = voices[0]?.id || '';
  if (fallback) {
    usedVoiceIds.add(fallback);
  }
  return fallback;
}

function resolveHosts(params = {}, voiceConfig = {}) {
  const availableVoices = Array.isArray(voiceConfig?.voices) ? voiceConfig.voices : [];
  const usedVoiceIds = new Set();

  return DEFAULT_HOSTS.map((defaultHost, index) => {
    const suffix = index === 0 ? 'A' : 'B';
    const providedVoiceId = String(params[`host${suffix}VoiceId`] || '').trim();
    const voiceId = providedVoiceId
      || resolveVoiceId(defaultHost.preferredVoiceIds, availableVoices, usedVoiceIds)
      || voiceConfig?.defaultVoiceId
      || '';

    if (voiceId) {
      usedVoiceIds.add(voiceId);
    }

    return {
      name: sanitizePodcastText(params[`host${suffix}Name`] || defaultHost.name) || defaultHost.name,
      role: sanitizePodcastText(params[`host${suffix}Role`] || defaultHost.role) || defaultHost.role,
      persona: sanitizePodcastText(params[`host${suffix}Persona`] || defaultHost.persona) || defaultHost.persona,
      voiceId,
    };
  });
}

function resolvePodcastTtsTimeoutMs(params = {}, voiceConfig = {}) {
  const configuredTimeoutMs = Math.max(
    1000,
    Number(voiceConfig?.podcastTimeoutMs)
      || Number(voiceConfig?.timeoutMs)
      || 45000,
  );

  return clampNumber(params.ttsTimeoutMs, 1000, 15 * 60 * 1000, configuredTimeoutMs);
}

function resolvePodcastChunkMaxChars(params = {}, voiceConfig = {}) {
  const maxTextChars = Math.max(200, Number(voiceConfig?.maxTextChars) || 2400);
  const safeMaxChunkChars = Math.max(250, maxTextChars - 160);
  const configuredChunkChars = clampNumber(
    voiceConfig?.podcastChunkChars,
    250,
    safeMaxChunkChars,
    Math.min(900, safeMaxChunkChars),
  );

  return clampNumber(params.ttsChunkMaxChars, 250, safeMaxChunkChars, configuredChunkChars);
}

function buildResearchPrompt({
  topic,
  audience,
  tone,
  durationMinutes,
  hosts,
  sources,
}) {
  const wordBudget = estimateWordBudget(durationMinutes);
  const turnCount = estimateTurnCount(durationMinutes);

  const sourceText = sources.map((source, index) => [
    `Source ${index + 1}: ${sanitizePodcastText(source.title || 'Untitled source')}`,
    `URL: ${sanitizePodcastText(source.url)}`,
    source.snippet ? `Snippet: ${sanitizePodcastText(source.snippet, { preserveNewlines: true })}` : '',
    source.content ? `Excerpt: ${sanitizePodcastText(source.content, { preserveNewlines: true })}` : '',
  ].filter(Boolean).join('\n')).join('\n\n');

  return `
Create a scripted two-host podcast episode as strict JSON.

Topic: ${sanitizePodcastText(topic)}
Audience: ${sanitizePodcastText(audience)}
Tone: ${sanitizePodcastText(tone)}
Target duration minutes: ${durationMinutes}
Approximate total word budget: ${wordBudget}
Target turn count: ${turnCount}

Host 1:
- name: ${sanitizePodcastText(hosts[0].name)}
- role: ${sanitizePodcastText(hosts[0].role)}
- persona: ${sanitizePodcastText(hosts[0].persona)}

Host 2:
- name: ${sanitizePodcastText(hosts[1].name)}
- role: ${sanitizePodcastText(hosts[1].role)}
- persona: ${sanitizePodcastText(hosts[1].persona)}

Use only the sourced information below. Do not invent facts. If a point is uncertain, phrase it carefully.
Write like a real podcast: light rapport, clean transitions, informative explanations, occasional reactions, but no filler overload.
Keep each turn to one paragraph. No stage directions. No markdown. No URLs in spoken text.
Open with a strong hook and end with a concise wrap-up.
Write for speech delivery, not for reading: use contractions, shorter sentences, and natural hand-offs.
Avoid stacked statistics, semicolons, parenthetical asides, and phrasing that sounds like a report being read aloud.
Spell out or rephrase awkward abbreviations and symbols so Piper can read them smoothly.

Return exactly this JSON shape:
{
  "title": "string",
  "summary": "string",
  "turns": [
    { "speaker": "${hosts[0].name}", "text": "string" },
    { "speaker": "${hosts[1].name}", "text": "string" }
  ]
}

Research:
${sourceText}
  `.trim();
}

class PodcastService {
  constructor(dependencies = {}) {
    this.createResponse = dependencies.createResponse || createResponse;
    this.ttsService = dependencies.ttsService || piperTtsService;
    this.persistGeneratedAudio = dependencies.persistGeneratedAudio || persistGeneratedAudio;
    this.updateGeneratedAudioSessionState = dependencies.updateGeneratedAudioSessionState || updateGeneratedAudioSessionState;
    this.audioProcessingService = dependencies.audioProcessingService || audioProcessingService;
  }

  async retryTransientOperation(operation, { label = 'podcast operation', retries = DEFAULT_TRANSIENT_RETRY_ATTEMPTS } = {}) {
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (!isTransientPodcastError(error) || attempt >= retries) {
          throw error;
        }

        console.warn(`[PodcastService] Retrying ${label} after transient failure: ${error.message}`);
        await wait(DEFAULT_TRANSIENT_RETRY_DELAY_MS * (attempt + 1));
      }
    }

    throw lastError || new Error(`${label} failed.`);
  }

  async runTool(executeTool, toolId, params, context) {
    return this.retryTransientOperation(async () => {
      const result = await executeTool(toolId, params, context);
      if (!result?.success) {
        const error = new Error(result?.error || `${toolId} failed.`);
        if (result?.errorCode) {
          error.code = result.errorCode;
        }
        if (Number.isFinite(Number(result?.statusCode))) {
          error.statusCode = Number(result.statusCode);
        }
        throw error;
      }
      return result.data;
    }, {
      label: toolId,
    });
  }

  async researchTopic({ topic, searchDomains = [], sourceUrls = [], maxSources = DEFAULT_MAX_SOURCES }, context = {}) {
    if (typeof context?.executeTool !== 'function') {
      throw new Error('Podcast research requires tool execution support.');
    }

    const searchData = await this.runTool(context.executeTool, 'web-search', {
      query: `${topic} explainer key facts overview`,
      engine: 'perplexity',
      researchMode: 'search',
      limit: Math.max(maxSources * 2, 6),
      includeSnippets: true,
      includeUrls: true,
      domains: searchDomains,
      region: 'us-en',
      timeRange: 'all',
    }, context.toolContext);

    const seededSources = (Array.isArray(sourceUrls) ? sourceUrls : [])
      .map((url) => ({
        title: url,
        url: String(url || '').trim(),
        snippet: '',
      }))
      .filter((entry) => entry.url);

    const candidates = uniqueUrls([
      ...seededSources,
      ...(Array.isArray(searchData?.verifiedPages) ? searchData.verifiedPages : []),
      ...(Array.isArray(searchData?.results) ? searchData.results : []),
      ...(Array.isArray(searchData?.citations) ? searchData.citations : []),
    ]).slice(0, maxSources);

    const verifiedSources = [];
    for (const candidate of candidates) {
      const url = String(candidate?.url || '').trim();
      if (!url) {
        continue;
      }

      try {
        const fetched = await this.runTool(context.executeTool, 'web-fetch', {
          url,
          timeout: 20000,
          cache: true,
        }, context.toolContext);

        verifiedSources.push({
          title: String(candidate?.title || url).trim() || url,
          url,
          snippet: String(candidate?.snippet || '').trim(),
          content: extractFetchedText(fetched),
        });
      } catch (_error) {
        verifiedSources.push({
          title: String(candidate?.title || url).trim() || url,
          url,
          snippet: String(candidate?.snippet || '').trim(),
          content: '',
        });
      }
    }

    if (verifiedSources.length === 0) {
      throw new Error('Podcast research did not return any usable sources.');
    }

    return verifiedSources;
  }

  async generateScript({
    topic,
    audience,
    tone,
    durationMinutes,
    hosts,
    sources,
    model,
    reasoningEffort,
  }) {
    const response = await this.retryTransientOperation(() => this.createResponse({
      input: buildResearchPrompt({
        topic,
        audience,
        tone,
        durationMinutes,
        hosts,
        sources,
      }),
      instructions: 'You write polished, factual, natural-sounding podcast scripts and must return valid JSON only.',
      stream: false,
      model,
      reasoningEffort,
      enableAutomaticToolCalls: false,
    }), {
      label: 'podcast script generation',
    });

    const parsed = parseLenientJson(getResponseText(response));
    const allowedSpeakers = new Set(hosts.map((host) => host.name));
    const turns = (Array.isArray(parsed?.turns) ? parsed.turns : [])
      .map((turn) => normalizeTurn(turn, allowedSpeakers))
      .filter(Boolean);

    if (turns.length < 8) {
      throw new Error('Podcast script generation returned too few valid turns.');
    }

    return {
      title: String(parsed?.title || `${topic} Podcast`).trim() || `${topic} Podcast`,
      summary: String(parsed?.summary || '').trim(),
      turns,
    };
  }

  async synthesizeChunkBuffer(text = '', host = {}, options = {}, splitDepth = 0) {
    const timeoutMs = Math.max(1000, Number(options.ttsTimeoutMs) || 45000);
    const minimumChunkChars = Math.max(250, Number(options.minimumChunkChars) || 350);

    try {
      const synthesis = await this.ttsService.synthesize({
        text,
        voiceId: host.voiceId,
        timeoutMs,
      });
      return [synthesis];
    } catch (error) {
      if (error?.code !== 'tts_timeout' || splitDepth >= 2 || text.length <= minimumChunkChars) {
        throw error;
      }

      const nextChunkSize = Math.max(minimumChunkChars, Math.floor(text.length / 2));
      if (nextChunkSize >= text.length) {
        throw error;
      }

      const retryChunks = chunkText(text, nextChunkSize);
      if (retryChunks.length <= 1) {
        throw error;
      }

      const syntheses = [];
      for (const retryChunk of retryChunks) {
        const nestedSyntheses = await this.synthesizeChunkBuffer(
          retryChunk,
          host,
          options,
          splitDepth + 1,
        );
        syntheses.push(...nestedSyntheses);
      }
      return syntheses;
    }
  }

  async synthesizeTurns(turns = [], hosts = [], options = {}) {
    const maxTextChars = Math.max(200, Number(this.ttsService?.getPublicConfig?.().maxTextChars) || 2400);
    const silenceMs = clampNumber(options.silenceMs, 100, 1200, DEFAULT_SILENCE_MS);
    const chunkMaxChars = clampNumber(
      options.chunkMaxChars,
      250,
      Math.max(250, maxTextChars - 160),
      Math.min(900, Math.max(250, maxTextChars - 160)),
    );
    const minimumChunkChars = clampNumber(
      options.minimumChunkChars,
      250,
      chunkMaxChars,
      Math.max(350, Math.floor(chunkMaxChars / 2)),
    );
    const hostByName = new Map(hosts.map((host) => [host.name, host]));
    const wavBuffers = [];

    for (const turn of turns) {
      const host = hostByName.get(turn.speaker);
      if (!host?.voiceId) {
        throw new Error(`No Piper voice is configured for speaker "${turn.speaker}".`);
      }

      const chunks = chunkText(turn.text, chunkMaxChars);
      for (const chunk of chunks) {
        const syntheses = await this.synthesizeChunkBuffer(chunk, host, {
          ttsTimeoutMs: options.ttsTimeoutMs,
          minimumChunkChars,
        });
        for (const synthesis of syntheses) {
          wavBuffers.push(synthesis.audioBuffer);
          wavBuffers.push(createSilenceWavBuffer(parseWavBuffer(synthesis.audioBuffer), silenceMs));
        }
      }
    }

    while (wavBuffers.length > 0) {
      const lastBuffer = wavBuffers[wavBuffers.length - 1];
      try {
        const parsed = parseWavBuffer(lastBuffer);
        if (parsed.data.every((value) => value === 0)) {
          wavBuffers.pop();
          continue;
        }
      } catch (_error) {
        break;
      }
      break;
    }

    return concatWavBuffers(wavBuffers);
  }

  async createPodcast(params = {}, context = {}) {
    const sessionId = String(context?.sessionId || '').trim();
    if (!sessionId) {
      throw new Error('podcast requires an active session so the audio can be saved.');
    }

    const topic = String(params.topic || params.prompt || params.subject || '').trim();
    const normalizedTopic = sanitizePodcastText(topic);
    if (!normalizedTopic) {
      throw new Error('podcast requires a topic, prompt, or subject.');
    }

    const durationMinutes = clampNumber(params.durationMinutes, 3, 30, DEFAULT_DURATION_MINUTES);
    const audience = sanitizePodcastText(params.audience || 'general') || 'general';
    const tone = sanitizePodcastText(params.tone || 'informative, conversational') || 'informative, conversational';
    const maxSources = clampNumber(params.maxSources, 2, 6, DEFAULT_MAX_SOURCES);
    const voiceConfig = this.ttsService.getPublicConfig();
    const hosts = resolveHosts(params, voiceConfig);
    const podcastTtsTimeoutMs = resolvePodcastTtsTimeoutMs(params, voiceConfig);
    const podcastChunkMaxChars = resolvePodcastChunkMaxChars(params, voiceConfig);
    const executeTool = typeof context?.toolManager?.executeTool === 'function'
      ? context.toolManager.executeTool.bind(context.toolManager)
      : null;
    const sources = await this.researchTopic({
      topic: normalizedTopic,
      searchDomains: params.searchDomains || params.domains || [],
      sourceUrls: params.sourceUrls || params.urls || [],
      maxSources,
    }, {
      executeTool,
      toolContext: context,
    });

    const script = await this.generateScript({
      topic: normalizedTopic,
      audience,
      tone,
      durationMinutes,
      hosts,
      sources,
      model: params.model || context.model || undefined,
      reasoningEffort: params.reasoningEffort || context.reasoningEffort || undefined,
    });
    const transcript = buildTranscript(script.turns);
    const wantsMp3 = prefersMp3(params);
    const wantsMixing = requestedMixing(params);
    const audioProcessingConfig = this.audioProcessingService?.getPublicConfig?.() || null;
    const wantsEnhancement = params.enhanceSpeech !== false && audioProcessingConfig?.configured === true;

    // Validate TTS compatibility before starting the full run.
    script.turns.forEach((turn) => {
      normalizeTextForSpeech(turn.text, Math.max(200, Number(voiceConfig.maxTextChars) || 2400));
    });

    const speechWavBuffer = await this.synthesizeTurns(
      script.turns,
      hosts,
      {
        silenceMs: clampNumber(params.pauseMs, 100, 1200, DEFAULT_SILENCE_MS),
        ttsTimeoutMs: podcastTtsTimeoutMs,
        chunkMaxChars: podcastChunkMaxChars,
      },
    );
    const finalAudioBuffer = (wantsMixing || wantsEnhancement)
      ? await this.audioProcessingService.composePodcastAudio({
        speechWavBuffer,
        includeIntro: params.includeIntro === true,
        includeOutro: params.includeOutro === true,
        includeMusicBed: params.includeMusicBed === true,
        enhanceSpeech: wantsEnhancement,
        introPath: params.introPath || '',
        outroPath: params.outroPath || '',
        musicBedPath: params.musicBedPath || '',
        speechVolume: params.speechVolume,
        musicVolume: params.musicVolume,
        introVolume: params.introVolume,
        outroVolume: params.outroVolume,
      })
      : speechWavBuffer;
    const episodeTitle = sanitizePodcastText(params.title || script.title || `${normalizedTopic} Podcast`);
    const persistedArtifacts = [];
    const audioVariants = [];

    const persistedWav = await this.persistGeneratedAudio({
      sessionId,
      sourceMode: String(context?.clientSurface || context?.taskType || 'chat').trim() || 'chat',
      text: transcript,
      title: episodeTitle,
      filename: normalizeVariantFilename(params.filename || '', 'wav'),
      provider: 'piper',
      voice: {
        provider: 'piper',
        episodeVoices: hosts.map((host) => ({
          speaker: host.name,
          voiceId: host.voiceId,
        })),
      },
      audioBuffer: finalAudioBuffer,
      mimeType: 'audio/wav',
      metadata: {
        createdByAgentTool: true,
        generatedBy: 'podcast',
        topic: normalizedTopic,
        durationMinutes,
        audience,
        tone,
        hosts,
        sources,
        summary: script.summary,
        turnCount: script.turns.length,
        processing: {
          mixed: wantsMixing,
          enhanced: wantsEnhancement,
          mp3Exported: wantsMp3,
          ttsTimeoutMs: podcastTtsTimeoutMs,
          ttsChunkMaxChars: podcastChunkMaxChars,
        },
      },
    });
    if (persistedWav.artifact) {
      persistedArtifacts.push(persistedWav.artifact);
    }
    if (persistedWav.audio) {
      audioVariants.push({
        format: 'wav',
        ...persistedWav.audio,
      });
    }

    let persistedMp3 = null;
    if (wantsMp3) {
      const mp3Buffer = await this.audioProcessingService.transcodeWavToMp3({
        wavBuffer: finalAudioBuffer,
        bitrateKbps: params.mp3BitrateKbps,
      });
      persistedMp3 = await this.persistGeneratedAudio({
        sessionId,
        sourceMode: String(context?.clientSurface || context?.taskType || 'chat').trim() || 'chat',
        text: transcript,
        title: episodeTitle,
        filename: normalizeVariantFilename(params.filename || '', 'mp3'),
        provider: 'ffmpeg',
        voice: {
          provider: 'ffmpeg',
          episodeVoices: hosts.map((host) => ({
            speaker: host.name,
            voiceId: host.voiceId,
          })),
        },
        audioBuffer: mp3Buffer,
        mimeType: 'audio/mpeg',
        metadata: {
          createdByAgentTool: true,
          generatedBy: 'podcast',
          topic: normalizedTopic,
          durationMinutes,
          audience,
          tone,
          hosts,
          sources,
          summary: script.summary,
          turnCount: script.turns.length,
          processing: {
            mixed: wantsMixing,
            enhanced: wantsEnhancement,
            mp3Exported: true,
            ttsTimeoutMs: podcastTtsTimeoutMs,
            ttsChunkMaxChars: podcastChunkMaxChars,
          },
        },
      });
      if (persistedMp3.artifact) {
        persistedArtifacts.push(persistedMp3.artifact);
      }
      if (persistedMp3.audio) {
        audioVariants.push({
          format: 'mp3',
          ...persistedMp3.audio,
        });
      }
    }

    if (persistedArtifacts.length > 0) {
      await this.updateGeneratedAudioSessionState(sessionId, persistedArtifacts);
    }
    const primaryAudio = persistedMp3?.audio || persistedWav.audio || null;
    const primaryArtifact = persistedMp3?.artifact || persistedWav.artifact || null;

    return {
      title: sanitizePodcastText(script.title),
      summary: script.summary,
      durationMinutes,
      estimatedWordCount: transcript.split(/\s+/).filter(Boolean).length,
      hosts,
      sources,
      script: {
        title: script.title,
        summary: script.summary,
        turns: script.turns,
        transcript,
      },
      processing: {
        mixed: wantsMixing,
        enhanced: wantsEnhancement,
        mp3Exported: wantsMp3,
        ttsTimeoutMs: podcastTtsTimeoutMs,
        ttsChunkMaxChars: podcastChunkMaxChars,
        audioProcessing: audioProcessingConfig,
      },
      artifact: primaryArtifact,
      artifacts: persistedArtifacts,
      artifactIds: persistedArtifacts.map((artifact) => artifact.id).filter(Boolean),
      audio: primaryAudio,
      audioVariants,
    };
  }
}

const podcastService = new PodcastService();

module.exports = {
  PodcastService,
  podcastService,
};
