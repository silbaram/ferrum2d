export const DEFAULT_GITHUB_REPOSITORY = "silbaram/ferrum2d";

export function githubRelease(versionOrTag, repository = DEFAULT_GITHUB_REPOSITORY) {
  const version = typeof versionOrTag === "string" ? versionOrTag.replace(/^ferrum-web-v/, "") : undefined;
  if (typeof version !== "string" || version.trim() !== version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-beta\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error("GitHub release must be x.y.z-beta.N or ferrum-web-vx.y.z-beta.N (an exact beta version).");
  }
  if (typeof repository !== "string" || repository.trim() !== repository || !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(repository) || repository.endsWith(".git")) {
    throw new Error("GitHub repository must be owner/repo, without a URL or .git suffix.");
  }
  const tag = `ferrum-web-v${version}`;
  const baseUrl = `https://github.com/${repository}/releases/download/${tag}`;
  const assetUrl = (name) => `${baseUrl}/ferrum2d-${name}-${version}.tgz`;
  return {
    repository, version, tag, baseUrl,
    runtime: assetUrl("ferrum-web"),
    viewer: assetUrl("authoring-viewer"),
    generator: assetUrl("create-game"),
    agents: assetUrl("agents"),
  };
}

export function resolveGithubRelease(options, packageJson) {
  const embedded = packageJson.ferrumGithubRelease;
  if (embedded !== undefined) {
    if (embedded === null || typeof embedded !== "object" || Array.isArray(embedded) || typeof embedded.repository !== "string") {
      throw new Error("Embedded GitHub release metadata must include a repository, version, and tag.");
    }
    const release = githubRelease(embedded?.version, embedded?.repository);
    if (release.version !== packageJson.version || release.tag !== embedded.tag) {
      throw new Error("Embedded GitHub release metadata must match the create-game package version and tag.");
    }
  }
  const version = options.githubRelease ?? embedded?.version;
  if (options.githubRepository !== undefined && version === undefined) {
    throw new Error("--github-repository requires --github-release or a GitHub Release generator package.");
  }
  if (version === undefined) return undefined;
  if (options.ferrumVersion !== undefined || options.authoringViewerVersion !== undefined) {
    throw new Error("GitHub release mode cannot be combined with --ferrum-version or --authoring-viewer-version.");
  }
  return githubRelease(version, options.githubRepository ?? embedded?.repository);
}
