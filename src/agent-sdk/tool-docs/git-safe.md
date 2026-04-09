# git-safe

Purpose: run restricted local git operations in a repository the backend can access.

Allowed actions:
- `status`
- `diff`
- `branch`
- `remote-info`
- `add`
- `commit`
- `push`
- `save-and-push`

Notes:
- This tool only supports safe git save/push flows. It does not support reset, checkout, merge, rebase, force-push, or pull.
- `repositoryPath` defaults to `DEFAULT_GIT_REPOSITORY_PATH` or the backend working directory.
- If `repositoryPath` does not exist yet and `KIMIBUILT_DEPLOY_REPO_URL` is configured, the backend bootstraps a managed local clone automatically.
- `remote-info` reports the current branch, HEAD revision, upstream tracking ref when present, and configured remotes.
- `save-and-push` stages paths, commits with the provided message or a default message, then pushes to the selected remote and branch.
- GitHub HTTPS auth is picked up automatically from `GH_TOKEN` or `GITHUB_TOKEN` when present.
- Agent commits use `KIMIBUILT_GIT_COMMIT_NAME` and `KIMIBUILT_GIT_COMMIT_EMAIL` when set, otherwise a neutral default identity.
- Preferred deployment lane is `git-safe` for local authoring/push, then CI/GitHub Actions, then `k3s-deploy` or cluster rollout verification. Avoid treating the live server as the source of truth unless the user explicitly asks for a server-local Git workflow.
