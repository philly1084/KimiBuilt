const { normalizeIssue } = require('./symphony');

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_TIMEOUT_MS = 30000;

function sanitizeText(value = '') {
  return String(value || '').trim();
}

function normalizePriority(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) ? numeric : null;
}

function normalizeIsoTimestamp(value) {
  const text = sanitizeText(value);
  if (!text) {
    return null;
  }
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function collectNodes(connection = {}) {
  return Array.isArray(connection?.nodes) ? connection.nodes : [];
}

function normalizeBlockedBy(issue = {}) {
  const relations = [
    ...collectNodes(issue.relations),
    ...collectNodes(issue.inverseRelations),
  ];
  return relations
    .filter((relation) => sanitizeText(relation?.type).toLowerCase() === 'blocks')
    .map((relation) => relation.issue || relation.relatedIssue || relation.source || relation.target || null)
    .filter(Boolean)
    .map((blocker) => ({
      id: blocker.id || null,
      identifier: blocker.identifier || null,
      state: blocker.state?.name || blocker.state || null,
    }));
}

function normalizeLinearIssue(issue = {}) {
  return normalizeIssue({
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description || null,
    priority: normalizePriority(issue.priority),
    state: issue.state?.name || issue.state || '',
    branch_name: issue.branchName || issue.branch_name || null,
    url: issue.url || null,
    labels: collectNodes(issue.labels).map((label) => label.name || label),
    blocked_by: normalizeBlockedBy(issue),
    created_at: normalizeIsoTimestamp(issue.createdAt || issue.created_at),
    updated_at: normalizeIsoTimestamp(issue.updatedAt || issue.updated_at),
  });
}

async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

class LinearIssueTrackerClient {
  constructor({
    endpoint = 'https://api.linear.app/graphql',
    apiKey = '',
    projectSlug = '',
    pageSize = DEFAULT_PAGE_SIZE,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = global.fetch,
  } = {}) {
    if (typeof fetchImpl !== 'function') {
      throw new Error('LinearIssueTrackerClient requires fetch');
    }
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.projectSlug = projectSlug;
    this.pageSize = pageSize;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }

  async executeGraphql(query = '', variables = {}) {
    if (!sanitizeText(this.apiKey)) {
      const error = new Error('missing_tracker_api_key');
      error.code = 'missing_tracker_api_key';
      throw error;
    }
    const response = await fetchWithTimeout(this.fetch, this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    }, this.timeoutMs);

    if (!response || !response.ok) {
      const error = new Error(`linear_api_status: ${response?.status || 'unknown'}`);
      error.code = 'linear_api_status';
      error.status = response?.status;
      throw error;
    }

    const body = await response.json();
    if (Array.isArray(body?.errors) && body.errors.length > 0) {
      const error = new Error('linear_graphql_errors');
      error.code = 'linear_graphql_errors';
      error.errors = body.errors;
      error.body = body;
      throw error;
    }
    return body.data;
  }

  async fetchCandidateIssues(activeStates = []) {
    return this.fetchIssuesByStates(activeStates);
  }

  async fetchIssuesByStates(stateNames = []) {
    const states = Array.isArray(stateNames) ? stateNames.map(sanitizeText).filter(Boolean) : [];
    const issues = [];
    let after = null;

    do {
      const data = await this.executeGraphql(LINEAR_ISSUES_QUERY, {
        projectSlug: this.projectSlug,
        stateNames: states,
        first: this.pageSize,
        after,
      });
      const connection = data?.issues;
      if (!connection || !Array.isArray(connection.nodes)) {
        const error = new Error('linear_unknown_payload');
        error.code = 'linear_unknown_payload';
        throw error;
      }
      issues.push(...connection.nodes.map(normalizeLinearIssue));
      const pageInfo = connection.pageInfo || {};
      if (pageInfo.hasNextPage && !pageInfo.endCursor) {
        const error = new Error('linear_missing_end_cursor');
        error.code = 'linear_missing_end_cursor';
        throw error;
      }
      after = pageInfo.hasNextPage ? pageInfo.endCursor : null;
    } while (after);

    return issues;
  }

  async fetchIssueStatesByIds(issueIds = []) {
    const ids = Array.isArray(issueIds) ? issueIds.map(sanitizeText).filter(Boolean) : [];
    if (ids.length === 0) {
      return new Map();
    }
    const data = await this.executeGraphql(LINEAR_ISSUE_STATES_QUERY, { ids });
    const nodes = data?.issues?.nodes;
    if (!Array.isArray(nodes)) {
      const error = new Error('linear_unknown_payload');
      error.code = 'linear_unknown_payload';
      throw error;
    }
    return new Map(nodes.map((issue) => [issue.id, normalizeLinearIssue(issue)]));
  }
}

const LINEAR_ISSUES_QUERY = `
query SymphonyIssues($projectSlug: String!, $stateNames: [String!], $first: Int!, $after: String) {
  issues(
    first: $first
    after: $after
    filter: {
      project: { slugId: { eq: $projectSlug } }
      state: { name: { in: $stateNames } }
    }
  ) {
    nodes {
      id
      identifier
      title
      description
      priority
      branchName
      url
      createdAt
      updatedAt
      state { name }
      labels { nodes { name } }
      inverseRelations {
        nodes {
          type
          issue { id identifier state { name } }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const LINEAR_ISSUE_STATES_QUERY = `
query SymphonyIssueStates($ids: [ID!]) {
  issues(filter: { id: { in: $ids } }) {
    nodes {
      id
      identifier
      title
      description
      priority
      branchName
      url
      createdAt
      updatedAt
      state { name }
      labels { nodes { name } }
      inverseRelations {
        nodes {
          type
          issue { id identifier state { name } }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

module.exports = {
  LinearIssueTrackerClient,
  normalizeLinearIssue,
};
