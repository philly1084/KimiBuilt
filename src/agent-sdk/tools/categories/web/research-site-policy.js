const DEFAULT_POLICY_USER_AGENT = 'KimiBuilt-Agent/1.0 (Research Policy)';
const DEFAULT_USER_AGENT_TOKENS = ['kimibuilt-agent', 'lillybuilt-agent', '*'];

function normalizeDomainEntry(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
}

function normalizeDomainList(values = []) {
  const input = Array.isArray(values) ? values : [values];
  return Array.from(new Set(
    input
      .map((value) => normalizeDomainEntry(value))
      .filter(Boolean),
  ));
}

function getHostnameFromUrl(url = '') {
  try {
    return normalizeDomainEntry(new URL(String(url || '')).hostname || '');
  } catch (_error) {
    return '';
  }
}

function hostnameMatchesDomainList(hostname = '', approvedDomains = []) {
  const normalizedHostname = normalizeDomainEntry(hostname);
  const normalizedDomains = normalizeDomainList(approvedDomains);

  if (!normalizedHostname || normalizedDomains.length === 0) {
    return false;
  }

  return normalizedDomains.some((domain) => (
    normalizedHostname === domain || normalizedHostname.endsWith(`.${domain}`)
  ));
}

function escapeRegex(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildRobotsRuleRegex(rulePath = '') {
  const normalized = String(rulePath || '').trim();
  if (!normalized) {
    return null;
  }

  const hasAnchor = normalized.endsWith('$');
  const raw = hasAnchor ? normalized.slice(0, -1) : normalized;
  const pattern = raw
    .split('*')
    .map((segment) => escapeRegex(segment))
    .join('.*');

  return new RegExp(`^${pattern}${hasAnchor ? '$' : ''}`);
}

function pathMatchesRule(pathname = '/', rulePath = '') {
  const normalizedPath = pathname || '/';
  const normalizedRule = String(rulePath || '').trim();

  if (!normalizedRule) {
    return false;
  }

  if (!normalizedRule.includes('*') && !normalizedRule.endsWith('$')) {
    return normalizedPath.startsWith(normalizedRule);
  }

  const matcher = buildRobotsRuleRegex(normalizedRule);
  return matcher ? matcher.test(normalizedPath) : false;
}

function parseRobotsGroups(text = '') {
  const lines = String(text || '').split(/\r?\n/);
  const groups = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line) {
      continue;
    }

    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    if (!value) {
      continue;
    }

    if (key === 'user-agent') {
      if (!current || current.rules.length > 0) {
        if (current) {
          groups.push(current);
        }
        current = { agents: [], rules: [] };
      }
      current.agents.push(value.toLowerCase());
      continue;
    }

    if (key === 'allow' || key === 'disallow') {
      if (!current) {
        current = { agents: ['*'], rules: [] };
      }
      current.rules.push({ type: key, path: value });
    }
  }

  if (current) {
    groups.push(current);
  }

  return groups;
}

function selectRobotsGroup(groups = [], userAgentTokens = DEFAULT_USER_AGENT_TOKENS) {
  let best = null;

  for (const group of groups) {
    const agents = Array.isArray(group?.agents) ? group.agents : [];
    for (const agent of agents) {
      const normalizedAgent = String(agent || '').trim().toLowerCase();
      if (!normalizedAgent) {
        continue;
      }

      let score = 0;
      if (normalizedAgent === '*') {
        score = 1;
      } else if (userAgentTokens.some((token) => token === normalizedAgent || token.startsWith(normalizedAgent))) {
        score = 2;
      }

      if (!score) {
        continue;
      }

      if (!best || score > best.score || (score === best.score && (group.rules?.length || 0) > (best.group.rules?.length || 0))) {
        best = {
          score,
          agent: normalizedAgent,
          group,
        };
      }
    }
  }

  return best;
}

function evaluateRobotsRules(text = '', pathname = '/', userAgentTokens = DEFAULT_USER_AGENT_TOKENS) {
  const groups = parseRobotsGroups(text);
  const selected = selectRobotsGroup(groups, userAgentTokens);

  if (!selected || !Array.isArray(selected.group?.rules) || selected.group.rules.length === 0) {
    return {
      matchedUserAgent: selected?.agent || null,
      matchedRule: null,
      allowed: true,
      reason: 'no-matching-robots-rules',
    };
  }

  let matchedRule = null;
  for (const rule of selected.group.rules) {
    const rulePath = String(rule?.path || '').trim();
    if (!pathMatchesRule(pathname, rulePath)) {
      continue;
    }

    const candidate = {
      type: String(rule.type || '').toLowerCase(),
      path: rulePath,
    };
    const currentLength = matchedRule?.path?.length || -1;
    if (!matchedRule
      || candidate.path.length > currentLength
      || (candidate.path.length === currentLength && candidate.type === 'allow' && matchedRule.type !== 'allow')) {
      matchedRule = candidate;
    }
  }

  if (!matchedRule) {
    return {
      matchedUserAgent: selected.agent,
      matchedRule: null,
      allowed: true,
      reason: 'no-path-specific-robots-match',
    };
  }

  return {
    matchedUserAgent: selected.agent,
    matchedRule,
    allowed: matchedRule.type === 'allow',
    reason: matchedRule.type === 'allow' ? 'robots-allow-match' : 'robots-disallow-match',
  };
}

async function fetchRobotsPolicy(url, { timeout = 8000, userAgent = DEFAULT_POLICY_USER_AGENT, userAgentTokens = DEFAULT_USER_AGENT_TOKENS } = {}) {
  const target = new URL(String(url || ''));
  const robotsUrl = new URL('/robots.txt', target.origin).toString();
  const response = await fetch(robotsUrl, {
    method: 'GET',
    headers: {
      'User-Agent': userAgent,
      'Accept': 'text/plain,*/*;q=0.1',
    },
    signal: AbortSignal.timeout(timeout),
  });

  if (response.status === 404) {
    return {
      url: robotsUrl,
      status: 404,
      found: false,
      allowed: true,
      reason: 'robots-missing',
      matchedUserAgent: null,
      matchedRule: null,
    };
  }

  if (!response.ok) {
    return {
      url: robotsUrl,
      status: response.status,
      found: false,
      allowed: true,
      reason: `robots-unavailable-${response.status}`,
      matchedUserAgent: null,
      matchedRule: null,
    };
  }

  const text = await response.text();
  const evaluation = evaluateRobotsRules(text, target.pathname || '/', userAgentTokens);
  return {
    url: robotsUrl,
    status: response.status,
    found: true,
    ...evaluation,
  };
}

async function evaluateResearchSitePolicy(url, {
  approvedDomains = [],
  respectRobotsTxt = true,
  timeout = 8000,
  userAgent = DEFAULT_POLICY_USER_AGENT,
  userAgentTokens = DEFAULT_USER_AGENT_TOKENS,
} = {}) {
  const hostname = getHostnameFromUrl(url);
  const normalizedApprovedDomains = normalizeDomainList(approvedDomains);
  const approved = normalizedApprovedDomains.length === 0
    ? true
    : hostnameMatchesDomainList(hostname, normalizedApprovedDomains);

  const result = {
    url: String(url || ''),
    hostname,
    approved,
    approvedDomains: normalizedApprovedDomains,
    allowed: approved,
    reason: approved ? 'approved-by-default' : 'host-not-approved',
    robots: null,
  };

  if (!approved || !respectRobotsTxt) {
    if (!respectRobotsTxt && approved) {
      result.reason = 'robots-check-disabled';
    }
    return result;
  }

  try {
    const robots = await fetchRobotsPolicy(url, {
      timeout,
      userAgent,
      userAgentTokens,
    });
    result.robots = robots;
    result.allowed = approved && robots.allowed !== false;
    if (robots.allowed === false) {
      result.reason = 'robots-disallow';
    } else if (robots.reason) {
      result.reason = robots.reason;
    }
    return result;
  } catch (error) {
    result.robots = {
      url: null,
      status: null,
      found: false,
      allowed: true,
      reason: 'robots-check-failed',
      error: error.message,
      matchedUserAgent: null,
      matchedRule: null,
    };
    result.allowed = approved;
    result.reason = 'robots-check-failed';
    return result;
  }
}

module.exports = {
  DEFAULT_POLICY_USER_AGENT,
  evaluateResearchSitePolicy,
  getHostnameFromUrl,
  hostnameMatchesDomainList,
  normalizeDomainList,
};
