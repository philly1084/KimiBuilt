(function () {
  const form = document.getElementById('render-form');
  const audioInput = document.getElementById('audio-input');
  const fileMeta = document.getElementById('file-meta');
  const runtimeStatus = document.getElementById('runtime-status');
  const renderButton = document.getElementById('render-button');
  const statusCard = document.getElementById('status-card');
  const statusTitle = document.getElementById('status-title');
  const statusMessage = document.getElementById('status-message');
  const result = document.getElementById('result');
  const resultVideo = document.getElementById('result-video');
  const downloadLink = document.getElementById('download-link');
  const artifactLink = document.getElementById('artifact-link');
  const renderDetails = document.getElementById('render-details');
  const detailMode = document.getElementById('detail-mode');
  const detailDuration = document.getElementById('detail-duration');
  const detailOutput = document.getElementById('detail-output');

  function setStatus(kind, title, message) {
    statusCard.classList.toggle('is-working', kind === 'working');
    statusCard.classList.toggle('is-error', kind === 'error');
    statusTitle.textContent = title;
    statusMessage.textContent = message;
  }

  function formatSeconds(value) {
    const total = Math.max(0, Math.round(Number(value) || 0));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function updateDetails(payload) {
    const storyboard = payload?.storyboard || {};
    const metadata = payload?.artifact?.metadata || {};
    const duration = payload?.durationSeconds || storyboard.durationSeconds || metadata.durationSeconds || 0;

    detailMode.textContent = metadata.renderMode || storyboard.renderMode || 'waveform-card';
    detailDuration.textContent = formatSeconds(duration);
    detailOutput.textContent = 'MP4 H.264 / AAC';
    renderDetails.hidden = false;
  }

  async function loadRuntime() {
    if (window.location.protocol === 'file:') {
      runtimeStatus.textContent = 'Static preview';
      return;
    }

    try {
      const response = await fetch('/api/podcast/runtime', {
        headers: { Accept: 'application/json' },
      });
      const data = await response.json();
      const video = data.video || {};
      const defaults = video.defaults || {};
      runtimeStatus.textContent = video.configured
        ? `Ready: ${defaults.renderMode || 'waveform-card'}`
        : 'Video renderer unavailable';
    } catch (_error) {
      runtimeStatus.textContent = 'Runtime check failed';
    }
  }

  audioInput.addEventListener('change', () => {
    const file = audioInput.files?.[0] || null;
    fileMeta.textContent = file
      ? `${file.name} (${Math.round((file.size / 1024 / 1024) * 10) / 10} MB)`
      : 'WAV, MP3, M4A, MP4, or WebM';
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = audioInput.files?.[0] || null;
    if (!file) {
      setStatus('error', 'Audio required', 'Choose an audio file before rendering.');
      return;
    }

    const data = new FormData(form);
    data.set('audio', file);
    data.set('renderMode', 'waveform-card');
    data.set('generateImages', 'false');
    data.set('visualEffects', 'false');
    data.set('enhanceAudio', form.elements.enhanceAudio.checked ? 'true' : 'false');

    renderButton.disabled = true;
    result.hidden = true;
    renderDetails.hidden = true;
    setStatus('working', 'Rendering', 'Building the waveform card and muxing the audio into an MP4.');

    try {
      const response = await fetch('/api/podcast/video/render', {
        method: 'POST',
        body: data,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message || `Render failed with HTTP ${response.status}`);
      }

      const videoUrl = payload.video?.inlinePath || payload.video?.downloadUrl;
      const downloadUrl = payload.video?.downloadUrl || videoUrl;
      resultVideo.src = videoUrl;
      downloadLink.href = downloadUrl;
      artifactLink.href = payload.artifact?.downloadUrl || downloadUrl;
      result.hidden = false;
      updateDetails(payload);
      setStatus('ready', 'Render complete', 'The waveform MP4 artifact is ready.');
    } catch (error) {
      setStatus('error', 'Render failed', error.message || 'The waveform MP4 could not be completed.');
    } finally {
      renderButton.disabled = false;
    }
  });

  loadRuntime();
}());
