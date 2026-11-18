"""Publish one verified candidate from the trusted GitHub Actions job."""

import json
import os
import re
import subprocess

from .reporting import load_run, save_run
from .triage import GITHUB, REPO, request_json
from .verification import git


def publish(path, number, repo, bundle):
    if (os.getenv("GITHUB_ACTIONS") != "true" or os.getenv("GITHUB_REPOSITORY") != REPO
            or os.getenv("GITHUB_REF") != "refs/heads/main" or not os.getenv("GH_TOKEN")):
        raise ValueError("Publishing requires the pilot workflow on the original repository's main branch")
    run = load_run(path)
    issue = next((item for item in run["issues"] if item["number"] == number), {})
    candidate = issue.get("coding", {})
    branch = f"agent/issue-{number}"
    ref = f"refs/heads/{branch}"
    sha = candidate.get("commit", "")
    checks = {item["command"]: item["status"] for item in candidate.get("checks", [])}
    if (number < 1 or run.get("repo") != REPO or run.get("source") != "github"
            or issue.get("status") != "auto" or issue.get("triage", {}).get("type") != "data"
            or issue["triage"].get("risk_flags") != [] or candidate.get("branch") != branch
            or candidate.get("status") != "verified_locally" or not re.fullmatch(r"[0-9a-f]{40}", sha)
            or any(checks.get(name) != "passed" for name in ("npm run ci", "Browser smoke test"))):
        raise ValueError("A verified automatic phrasebook candidate is required")
    current, _ = request_json(f"{GITHUB}/{number}")
    if current.get("state") != "open" or current.get("updated_at") != issue.get("updated_at"):
        raise ValueError("Issue changed after triage")
    origin = f"https://github.com/{REPO}.git"
    main = git(repo, "ls-remote", origin, "refs/heads/main").split()
    if not main or main[0] != candidate.get("base_commit"):
        raise ValueError("Upstream main moved. Prepare and verify a fresh candidate.")
    git(repo, "fetch", "--no-tags", str(bundle.resolve()), ref)
    if (git(repo, "rev-parse", "FETCH_HEAD").strip() != sha
            or git(repo, "rev-list", "--parents", "-n", "1", sha).split() != [sha, main[0]]
            or git(repo, "diff", "--name-only", main[0], sha).strip() != "src/phrasebook.js"
            or git(repo, "diff", main[0], sha, "--", "src/phrasebook.js").strip() != candidate["diff"].strip()):
        raise ValueError("Candidate commit differs from the verified patch")
    run_link = f'https://github.com/{REPO}/actions/runs/{int(os.environ["GITHUB_RUN_ID"])}'
    env = {name: value for name, value in os.environ.items() if name not in {"OPENAI_API_KEY", "GH_DEBUG"}}

    def gh(*args):
        return subprocess.run(["gh", *args], cwd=repo, env=env, capture_output=True,
                              text=True, encoding="utf-8", check=True, timeout=45).stdout

    # Reuse the exact branch on retries and refuse to overwrite an existing candidate.
    remote = git(repo, "ls-remote", origin, ref).split()
    if remote and remote[0] != sha:
        raise ValueError(f"{branch} already has a different commit; review it before retrying")
    if not remote:
        git(repo, "push", f"--force-with-lease={ref}:", origin, f"{sha}:{ref}")
    pulls = json.loads(gh("pr", "list", "--repo", REPO, "--head", branch,
                           "--base", "main", "--state", "open", "--json", "url,headRefOid,isDraft"))
    if pulls:
        if len(pulls) != 1 or pulls[0]["headRefOid"] != sha:
            raise ValueError("Existing PR does not match the verified candidate")
        url = pulls[0]["url"]
        draft = pulls[0]["isDraft"]
    else:
        usage = [item.get("usage") or {} for item in issue.get("attempts", [])] + [candidate.get("usage") or {}]
        counts = [item["total_tokens"] for item in usage if isinstance(item.get("total_tokens"), int)]
        tokens = f"{sum(counts):,} reported model tokens" if counts else "Model usage unavailable"
        body = (
            f"Closes #{number}.\n\nAdds the requested bilingual quick phrases to the phrasebook.\n\n"
            f"Verified commit: `{sha}`. Node CI and browser smoke test passed.\n\n"
            f"{tokens}. [Timing, check logs, and run record]({run_link}).\n\n"
            "A maintainer can approve the PR workflows to run, review the diff, and merge after CI passes."
        )
        url = gh("pr", "create", "--repo", REPO, "--base", "main", "--head", branch,
                 "--draft", "--title", f"Add quick translation phrases for issue #{number}", "--body", body).strip()
        draft = True
    candidate["publication"] = {"url": url, "draft": draft, "workflow": run_link,
                                "ci": "See GitHub PR checks"}
    save_run(path, run)
    return url
