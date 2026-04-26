# Research Bucket Tools

The research bucket is shared durable storage for project references that should be callable by agents without becoming model memory. It is intended for web-project source material such as images, data, graphs, code samples, audio/WAV files, notes, documents, and reference links.

## Storage

Default root:

```text
${KIMIBUILT_STATE_DIR or KIMIBUILT_DATA_DIR}/research-buckets/shared
```

Override with `KIMIBUILT_RESEARCH_BUCKET_ROOT`. Relative overrides resolve from the backend process working directory.

The bucket creates these folders on first use:

```text
images/
data/
graphs/
code/
audio/
videos/
docs/
notes/
refs/
```

The root also contains `bucket.json`, a lightweight manifest with path, category, mime type, size, timestamps, tags, description, and text preview.

## Tools

- `research-bucket-list`: list metadata by `category`, `query`, `tags`, and `limit`.
- `research-bucket-search`: search manifest fields and supported text files by `query`, optional `category`, optional `glob`, and `limit`.
- `research-bucket-read`: read a selected file by `path`; modes are `preview`, `content`, and `base64`.
- `research-bucket-write`: write UTF-8 or base64 content to a guarded relative path; supports `category`, `mimeType`, `tags`, and `description`.
- `research-bucket-mkdir`: create a guarded subfolder inside the bucket.

## Usage Guidance

Agents should list or search before reading. Read only the selected files needed for the current task, and prefer metadata or snippets over loading large content. Bucket content is not long-term model memory; it enters context only through explicit tool results and normal compaction still applies.

For remote build work, save reusable material here first, then call `remote-command` with `researchBucketPaths` or `researchBucketGlobs`. The remote runner stages those files under `KIMIBUILT_CONTEXT_DIR`, writes a manifest at `KIMIBUILT_CONTEXT_MANIFEST`, and preserves extensions so build tools can consume images, audio, podcasts, videos, JSON, markdown, code, and similar assets directly.

All paths must be relative to the bucket. Absolute paths, traversal (`..`), `.git`, and `node_modules` are rejected.
