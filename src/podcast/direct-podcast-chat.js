const {
  extractExplicitPodcastTopic,
  hasExplicitPodcastIntent,
  hasExplicitPodcastVideoIntent,
  inferPodcastVideoOptions,
} = require('./podcast-intent');

function extractRequestedPodcastDurationMinutes(text = '') {
  const source = String(text || '').trim();
  if (!source) {
    return null;
  }

  const match = source.match(/\b(\d{1,2})\s*(?:minute|min)\b/i);
  if (!match) {
    return null;
  }

  const minutes = Number(match[1]);
  if (!Number.isFinite(minutes)) {
    return null;
  }

  return Math.max(3, Math.min(30, Math.round(minutes)));
}

function shouldUseDirectPodcastChat(text = '') {
  return hasExplicitPodcastIntent(text);
}

function buildDirectPodcastParams({
  text = '',
  artifactIds = [],
  model = null,
  reasoningEffort = null,
} = {}) {
  const topic = extractExplicitPodcastTopic(text);
  if (!topic) {
    return null;
  }

  const selectedArtifactIds = (Array.isArray(artifactIds) ? artifactIds : [])
    .map((artifactId) => String(artifactId || '').trim())
    .filter(Boolean);
  const durationMinutes = extractRequestedPodcastDurationMinutes(text);
  const videoOptions = hasExplicitPodcastVideoIntent(text)
    ? inferPodcastVideoOptions(text)
    : {};

  return {
    topic,
    ...(selectedArtifactIds.length > 0 ? { artifactIds: selectedArtifactIds } : {}),
    ...(durationMinutes ? { durationMinutes } : {}),
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...videoOptions,
  };
}

function buildDirectPodcastAssistantMessage(podcast = {}) {
  const title = String(podcast?.title || podcast?.metadata?.title || 'Podcast').trim() || 'Podcast';
  const summary = String(podcast?.summary || podcast?.metadata?.summary || '').trim();
  const artifacts = Array.isArray(podcast?.artifacts) ? podcast.artifacts : [];
  const artifactNames = artifacts
    .map((artifact) => String(artifact?.filename || artifact?.name || '').trim())
    .filter(Boolean);

  return [
    `The podcast has been created: "${title}".`,
    summary,
    artifactNames.length > 0
      ? `Artifacts: ${artifactNames.join(', ')}.`
      : '',
    'The podcast workflow completed successfully.',
  ].filter(Boolean).join('\n\n');
}

module.exports = {
  buildDirectPodcastAssistantMessage,
  buildDirectPodcastParams,
  shouldUseDirectPodcastChat,
};
