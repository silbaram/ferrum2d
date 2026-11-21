import { readFile } from "node:fs/promises";
import path from "node:path";
import { githubRelease } from "../../packages/create-game/bin/github-release.mjs";
import { fileRecord, readJson, verifyDistribution } from "./release-distribution.mjs";

function requireDraft(release, tag, commit) {
  if (release?.draft !== true || release.prerelease !== true || release.tag_name !== tag ||
      release.target_commitish !== commit) {
    throw new Error(`Expected a draft prerelease for ${tag} targeting commit ${commit}`);
  }
}

function missingAssets(records, assets) {
  const missing = new Map(records.map(record => [record.file, record]));
  for (const asset of assets) {
    const record = missing.get(asset.name);
    if (!record || asset.state !== "uploaded" || asset.size !== record.bytes ||
        asset.digest !== `sha256:${record.sha256}`) {
      throw new Error(`Conflicting draft asset: ${asset.name}. Review the existing draft before retrying.`);
    }
    missing.delete(asset.name);
  }
  return [...missing.values()];
}

export async function attachDraftRelease({ bundle, version, repository, commit, github }) {
  const { tag } = githubRelease(version, repository);
  const manifest = await verifyDistribution(bundle);
  if (manifest.release.version !== version || manifest.release.repository !== repository ||
      manifest.source.commit !== commit || manifest.source.dirty) {
    throw new Error("The verified distribution must match the requested version, repository, and clean workflow commit");
  }
  const engine = await readJson(path.join(bundle, manifest.engineManifest));
  if (!engine.checks.build || !engine.checks.packageCheck) throw new Error("Engine build and package checks are required");
  const studios = await Promise.all(manifest.studioManifests.map(file => readJson(path.join(bundle, file))));
  const systems = new Set(studios.map(studio => studio.platform.os));
  if (!["linux", "macos", "windows"].every(os => systems.has(os))) {
    throw new Error("Studio installers for Linux, macOS and Windows are required");
  }
  const runtime = engine.assets.find(asset => asset.package === "@ferrum2d/ferrum-web");
  if (studios.some(studio => studio.runtime.tarballSha256 !== runtime.sha256 ||
      studio.runtime.wasmSha256 !== studios[0].runtime.wasmSha256)) {
    throw new Error("All Studio installers must embed the same runtime from the release SDK tarball");
  }
  const records = [...manifest.files, await fileRecord(path.join(bundle, "distribution-manifest.json")),
    await fileRecord(path.join(bundle, "DISTRIBUTION_SHA256SUMS"))];

  await github.checkTag(tag, commit);
  const draft = await github.findRelease(tag) ?? await github.createDraft({ tag, version, commit });
  requireDraft(draft, tag, commit);
  const pending = missingAssets(records, await github.listAssets(draft.id));
  for (const record of pending) {
    await github.uploadAsset(draft.id, record, path.join(bundle, record.file));
  }
  await github.checkTag(tag, commit);
  const current = await github.findRelease(tag);
  requireDraft(current, tag, commit);
  if (current.id !== draft.id || missingAssets(records, await github.listAssets(draft.id)).length) {
    throw new Error("GitHub draft asset verification is incomplete");
  }
  return { url: current.html_url, total: records.length, uploaded: pending.length };
}

// Use the authenticated Octokit client supplied by actions/github-script.
export function draftReleaseApi(client, repo, tag, commit) {
  const { git, repos } = client.rest;
  return {
    async checkTag() {
      let ref;
      try {
        ref = (await git.getRef({ ...repo, ref: `tags/${tag}` })).data.object;
      } catch (error) {
        if (error.status === 404) return;
        throw error;
      }
      // Annotated tags may point to another tag before resolving to the commit.
      while (ref.type === "tag") {
        ref = (await git.getTag({ ...repo, tag_sha: ref.sha })).data.object;
      }
      if (ref.type !== "commit" || ref.sha !== commit) throw new Error(`Existing tag ${tag} points to a different object`);
    },
    async findRelease() {
      // The listing includes unpublished drafts for a caller with write access.
      const releases = await client.paginate(repos.listReleases, { ...repo, per_page: 100 });
      const matches = releases.filter(release => release.tag_name === tag);
      if (matches.length > 1) throw new Error(`Multiple releases found for ${tag}`);
      return matches[0];
    },
    async createDraft({ version }) {
      const { data } = await repos.createRelease({ ...repo, tag_name: tag, target_commitish: commit,
        draft: true, prerelease: true, name: `Ferrum2D ${version}`,
        body: "## Install\n\n게임 프로젝트의 SDK 설치 방법은 첨부된 `INSTALL.md`를 참고하세요. " +
          "Ferrum2D Studio는 Assets에서 운영체제에 맞는 Windows `.exe`, macOS `.dmg`, Linux `.deb`를 다운로드하세요." });
      return data;
    },
    listAssets(release_id) {
      return client.paginate(repos.listReleaseAssets, { ...repo, release_id, per_page: 100 });
    },
    async uploadAsset(release_id, record, filePath) {
      const { data: current } = await repos.getRelease({ ...repo, release_id });
      requireDraft(current, tag, commit);
      await repos.uploadReleaseAsset({ ...repo, release_id, name: record.file, data: await readFile(filePath),
        headers: { "content-type": "application/octet-stream", "content-length": record.bytes } });
    },
  };
}
