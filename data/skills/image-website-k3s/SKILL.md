Use this skill when the user wants a visual asset pipeline that moves from generated images into a website or app and then into the k3s deployment lane.

Keep context exposure compact:
- Load only this skill summary unless another skill is explicitly selected or strongly matched.
- Prefer artifact IDs and saved file paths over embedding image data or long source files in prompts.
- Treat generated images as first-class assets: preserve model, prompt, size, format, artifact ID, and chosen filename.

Workflow:
1. Clarify only missing destructive or externally visible choices, such as public host, brand-sensitive content, or replacing an existing deployment.
2. Use `image-generate` for image assets, allow it enough time to complete, and verify `usableCount`, `artifacts`/`artifactIds`, or `markdownImages` before continuing. If no reusable image is returned, surface the diagnostic and do not wire placeholders into the site.
3. Use the saved images in the website design, with explicit dimensions, alt text, and responsive layout constraints.
4. Verify the website visually before deployment when a preview URL or browser runtime is available.
5. Use `remote-cli-agent` for git-backed remote implementation/deploy loops; use `k3s-deploy` for standard manifest apply or rollout verification.
6. Report the generated assets, source location, deployed host, and verification result.
