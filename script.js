// Chainlink Functions source for GitBounty
//
// Solidity passes:
// args[0] = repo_owner  (e.g. "chainlink")
// args[1] = repo        (e.g. "functions-hardhat-starter-kit")
// args[2] = issueNumber (e.g. "12")
//
// The script:
// - Searches for a PR in the repo whose title or body contains this issue number
// - Falls back to searching commit messages if no PR found by title/body
// - Checks "merged_at" for whether the PR is merged into "main"
// - If found, returns the PR author's GitHub username as a UTF-8 string
// - Otherwise returns "not_found"

const owner = args[0];
const repo = args[1];
const issueNumber = args[2];

// Load GitHub token from remote secrets (Amazon S3-secured JSON, e.g. { "apiToken": "ghp_..." })
if (!secrets.apiKey) {
  throw Error("Missing secret: apiToken");
}
const githubToken = secrets.apiKey;

// ================================================================
// HELPER: Check if a PR is merged into main/master and return author
// ================================================================
async function checkMergedPr(prUrl) {
  const prResponse = await Functions.makeHttpRequest({
    url: prUrl,
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "chainlink-functions-github-script"
    }
  });

  if (prResponse.error) return null;

  const pr = prResponse.data;
  if (
    pr &&
    pr.merged_at &&                                           // must be merged
    pr.base &&
    (pr.base.ref === "main" || pr.base.ref === "master") &&  // merged into main/master
    pr.user &&
    pr.user.login                                            // author username
  ) {
    return pr.user.login;
  }
  return null;
}

// ================================================================
// PRIMARY SEARCH: PR title or body contains #issueNumber
// ================================================================
const prQuery = `repo:${owner}/${repo} type:pr #${issueNumber} in:title,body`;
const prUrl = `https://api.github.com/search/issues?q=${encodeURIComponent(prQuery)}`;

const prResponse = await Functions.makeHttpRequest({
  url: prUrl,
  headers: {
    Authorization: `Bearer ${githubToken}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "chainlink-functions-github-script"
  }
});

if (!prResponse.error && prResponse.data && prResponse.data.items) {
  for (const item of prResponse.data.items) {
    if (!item.pull_request || !item.pull_request.url) continue;
    const author = await checkMergedPr(item.pull_request.url);
    if (author) {
      return Functions.encodeString(author);
    }
  }
}

// ================================================================
// FALLBACK SEARCH: Commit messages containing #issueNumber
// ================================================================
// If the issue number was mentioned only in a commit message
// (e.g. "closes #10" in the commit body), the primary search
// above won't catch it. This fallback finds those commits and
// resolves the PR they belong to.
const commitQuery = `repo:${owner}/${repo} #${issueNumber} in:commit-message`;
const commitUrl = `https://api.github.com/search/commits?q=${encodeURIComponent(commitQuery)}`;

const commitResponse = await Functions.makeHttpRequest({
  url: commitUrl,
  headers: {
    Authorization: `Bearer ${githubToken}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "chainlink-functions-github-script"
  }
});

if (!commitResponse.error && commitResponse.data && commitResponse.data.items) {
  for (const commit of commitResponse.data.items) {
    // For each matching commit, find the associated pull request
    const prLookupUrl =
      `https://api.github.com/repos/${owner}/${repo}/commits/${commit.sha}/pulls`;
    const prLookupResponse = await Functions.makeHttpRequest({
      url: prLookupUrl,
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github.groot-preview+json",
        "User-Agent": "chainlink-functions-github-script"
      }
    });

    if (
      !prLookupResponse.error &&
      prLookupResponse.data &&
      prLookupResponse.data.length > 0
    ) {
      for (const linkedPr of prLookupResponse.data) {
        const author = await checkMergedPr(linkedPr.url || linkedPr.pull_request?.url || linkedPr.html_url?.replace("github.com", "api.github.com/repos") + "?ref=master-patch");
        if (author) {
          return Functions.encodeString(author);
        }
      }
    }
  }
}

// Nothing matched — return "not_found"
return Functions.encodeString("not_found");
