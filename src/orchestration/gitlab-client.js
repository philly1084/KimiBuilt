function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizeBaseUrl(value = '') {
  return normalizeText(value).replace(/\/+$/, '');
}

function normalizeGitLabState(value = '') {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'opened' || normalized === 'open') {
    return 'Todo';
  }
  if (normalized === 'closed' || normalized === 'merged') {
    return 'Done';
  }
  return normalizeText(value) || 'Todo';
}

function encodeProjectPath(project = '') {
  const normalized = normalizeText(project);
  if (!normalized) {
    throw new Error('gitlab_project_required');
  }
  return encodeURIComponent(normalized);
}

function buildIssueUrl(baseUrl = '', issue = {}) {
  if (issue.web_url) {
    return issue.web_url;
  }
  const projectPath = issue.references?.full || issue.project_id || '';
  if (!projectPath || !issue.iid) {
    return null;
  }
  return `${normalizeBaseUrl(baseUrl)}/${projectPath}/-/issues/${issue.iid}`;
}

function normalizeGitLabIssue(issue = {}, { baseUrl = '' } = {}) {
  const labels = Array.isArray(issue.labels)
    ? issue.labels.map((label) => normalizeText(label).toLowerCase()).filter(Boolean)
    : [];

  return {
    id: normalizeText(issue.id),
    identifier: issue.references?.full || (issue.iid ? `GL-${issue.iid}` : normalizeText(issue.id)),
    title: normalizeText(issue.title),
    description: issue.description == null ? null : String(issue.description),
    priority: null,
    state: normalizeGitLabState(issue.state),
    branch_name: null,
    url: buildIssueUrl(baseUrl, issue),
    labels,
    blocked_by: [],
    created_at: issue.created_at || null,
    updated_at: issue.updated_at || null,
    raw: issue,
  };
}

function mapSymphonyStatesToGitLab(states = []) {
  const normalized = new Set(
    (Array.isArray(states) ? states : [])
      .map((state) => normalizeText(state).toLowerCase())
      .filter(Boolean),
  );
  if (normalized.size === 0 || normalized.has('todo') || normalized.has('in progress') || normalized.has('opened') || normalized.has('open')) {
    return 'opened';
  }
  if (normalized.has('done') || normalized.has('closed')) {
    return 'closed';
  }
  return 'opened';
}

class GitLabIssueTrackerClient {
  constructor({
    endpoint = '',
    apiKey = '',
    group = '',
    project = '',
    labels = [],
    fetchImpl = global.fetch,
  } = {}) {
    if (typeof fetchImpl !== 'function') {
      throw new Error('GitLabIssueTrackerClient requires fetch');
    }
    this.endpoint = normalizeBaseUrl(endpoint);
    this.apiKey = normalizeText(apiKey);
    this.group = normalizeText(group);
    this.project = normalizeText(project);
    this.labels = Array.isArray(labels) ? labels.map(normalizeText).filter(Boolean) : [];
    this.fetch = fetchImpl;
  }

  buildApiUrl(pathname = '', query = {}) {
    if (!this.endpoint) {
      throw new Error('gitlab_endpoint_required');
    }
    const url = new URL(`/api/v4${pathname.startsWith('/') ? pathname : `/${pathname}`}`, `${this.endpoint}/`);
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') {
        return;
      }
      url.searchParams.set(key, String(value));
    });
    return url;
  }

  async request(pathname, query = {}) {
    if (!this.apiKey) {
      throw new Error('gitlab_api_key_required');
    }
    const response = await this.fetch(this.buildApiUrl(pathname, query), {
      method: 'GET',
      headers: {
        'PRIVATE-TOKEN': this.apiKey,
        Accept: 'application/json',
      },
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const error = new Error(`GitLab API GET ${pathname} failed: HTTP ${response.status}`);
      error.status = response.status;
      error.body = payload;
      throw error;
    }
    return payload;
  }

  buildIssueQuery(states = []) {
    return {
      state: mapSymphonyStatesToGitLab(states),
      scope: 'all',
      order_by: 'created_at',
      sort: 'asc',
      per_page: 100,
      ...(this.labels.length > 0 ? { labels: this.labels.join(',') } : {}),
    };
  }

  async fetchCandidateIssues(states = []) {
    const query = this.buildIssueQuery(states);
    const pathname = this.project
      ? `/projects/${encodeProjectPath(this.project)}/issues`
      : `/groups/${encodeURIComponent(this.group)}/issues`;
    const payload = await this.request(pathname, query);
    return (Array.isArray(payload) ? payload : [])
      .map((issue) => normalizeGitLabIssue(issue, { baseUrl: this.endpoint }));
  }

  async fetchIssuesByStates(states = []) {
    return this.fetchCandidateIssues(states);
  }

  async fetchIssueStatesByIds(ids = []) {
    const wanted = new Set((Array.isArray(ids) ? ids : []).map(normalizeText).filter(Boolean));
    if (wanted.size === 0) {
      return new Map();
    }
    const openIssues = await this.fetchCandidateIssues(['Todo']);
    const closedIssues = await this.fetchCandidateIssues(['Done']);
    return new Map([...openIssues, ...closedIssues]
      .filter((issue) => wanted.has(issue.id))
      .map((issue) => [issue.id, issue]));
  }
}

module.exports = {
  GitLabIssueTrackerClient,
  mapSymphonyStatesToGitLab,
  normalizeGitLabIssue,
};
