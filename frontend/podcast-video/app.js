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
  const sceneList = document.getElementById('scene-list');
  const sceneCount = document.getElementById('scene-count');

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

  function renderStoryboard(storyboard) {
    const scenes = Array.isArray(storyboard?.scenes) ? storyboard.scenes : [];
    sceneCount.textContent = scenes.length === 1 ? '1 scene' : `${scenes.length} scenes`;
    sceneList.innerHTML = '';

    scenes.forEach((scene) => {
      const item = document.createElement('li');
      const source = scene.image?.source || scene.imageSource || 'planned';
      item.innerHTML = `
        <span class="scene-time">${formatSeconds(scene.start)}-${formatSeconds(scene.end)}</span>
        <div>
          <p class="scene-title"></p>
          <p class="scene-caption"></p>
        </div>
        <span class="scene-source"></span>
      `;
      item.querySelector('.scene-title').textContent = scene.summary || scene.visualQuery || 'Scene';
      item.querySelector('.scene-caption').textContent = scene.caption || scene.narration || '';
      item.querySelector('.scene-source').textContent = source;
      sceneList.appendChild(item);
    });
  }

  async function loadRuntime() {
    try {
      const response = await fetch('/api/podcast/runtime', {
        headers: { Accept: 'application/json' },
      });
      const data = await response.json();
      const video = data.video || {};
      runtimeStatus.textContent = video.configured
        ? `Video ready: ${video.provider || 'ffmpeg'}`
        : 'Video renderer unavailable';
    } catch (_error) {
      runtimeStatus.textContent = 'Runtime check failed';
    }
  }

  audioInput.addEventListener('change', () => {
    const file = audioInput.files?.[0] || null;
    fileMeta.textContent = file
      ? `${file.name} (${Math.round(file.size / 1024 / 1024 * 10) / 10} MB)`
      : 'WAV, MP3, M4A, MP4, or WebM';
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = audioInput.files?.[0] || null;
    if (!file) {
      setStatus('error', 'Audio required', 'Choose a podcast audio file before rendering.');
      return;
    }

    const data = new FormData(form);
    data.set('audio', file);
    data.set('generateImages', form.elements.generateImages.checked ? 'true' : 'false');
    data.set('enhanceAudio', form.elements.enhanceAudio.checked ? 'true' : 'false');

    renderButton.disabled = true;
    result.hidden = true;
    setStatus('working', 'Rendering', 'Repairing audio, planning scenes, sourcing images, applying motion, and muxing the MP4. Long podcasts can take several minutes.');

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
      renderStoryboard(payload.storyboard);
      setStatus('ready', 'Render complete', 'The MP4 artifact is ready with timed scenes, motion, transitions, and audio.');
    } catch (error) {
      setStatus('error', 'Render failed', error.message || 'The video render could not be completed.');
    } finally {
      renderButton.disabled = false;
    }
  });

  loadRuntime();
}());
