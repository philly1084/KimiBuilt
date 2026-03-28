# git-safe

Purpose: run restricted local git operations in a repository the backend can access.

Allowed actions:
- `status`
- `diff`
- `branch`
- `add`
- `commit`
- `push`
- `save-and-push`

Notes:
- This tool only supports safe git save/push flows. It does not support reset, checkout, merge, rebase, force-push, or pull.
- `repositoryPath` defaults to `DEFAULT_GIT_REPOSITORY_PATH` or the backend working directory.
- `save-and-push` stages paths, commits with the provided message or a default message, then pushes to the selected remote and branch.
- Push still depends on working git credentials in the runtime environment.
