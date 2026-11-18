"""Read GitHub issues and classify each in a fresh, tool-free model request."""

import json
import os
from datetime import datetime, timezone
from time import monotonic
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4

from .policy import decide, sanitize, validate
from .reporting import ROOT, load_run, save_run

REPO = "jingx034/realtimesubtitle"
GITHUB = f"https://api.github.com/repos/{REPO}/issues"
DEFAULT_MODEL = "gpt-5.4-mini"


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def elapsed(start):
    return round((monotonic() - start) * 1000)


def request_json(url, *, headers=None, payload=None):
    request = Request(url, data=json.dumps(payload).encode() if payload is not None else None,
                      headers=headers or {})
    try:
        with urlopen(request, timeout=90 if payload is not None else 20) as response:
            return json.load(response), response.headers
    except HTTPError as error:
        raise RuntimeError(f"HTTP {error.code} from {request.host}") from None
    except (URLError, TimeoutError):
        raise RuntimeError(f"Network request failed for {request.host}") from None


def api_key():
    if key := os.getenv("OPENAI_API_KEY"):
        return key
    env = ROOT / ".env.local"
    if env.exists():
        for line in env.read_text(encoding="utf-8-sig").splitlines():
            name, _, value = line.strip().removeprefix("export ").partition("=")
            if name.strip() == "OPENAI_API_KEY":
                key = value.strip().strip("\"'")
                if key:
                    return key
    raise RuntimeError("OPENAI_API_KEY is missing")


def structured_response(key, model, instructions, inputs, schema, name, attempt, limit):
    response, headers = request_json("https://api.openai.com/v1/responses",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        payload={
            "model": model, "store": False, "max_output_tokens": limit,
            "instructions": instructions, "input": json.dumps(inputs, ensure_ascii=False),
            "text": {"format": {"type": "json_schema", "name": name, "strict": True, "schema": schema}},
        })
    attempt.update(request_id=headers.get("x-request-id"), usage=response.get("usage"),
                   model=response.get("model", model))
    if response.get("status") != "completed":
        raise ValueError("Incomplete model response")
    parts = [part for item in response.get("output", []) for part in item.get("content", [])]
    if any(part.get("type") == "refusal" for part in parts):
        raise ValueError("Model declined the request")
    return json.loads("".join(part["text"] for part in parts if part.get("type") == "output_text"))


def github_issues():
    page = 1
    while True:
        batch, _ = request_json(
            f"{GITHUB}?state=open&per_page=100&sort=created&direction=asc&page={page}",
            headers={"Accept": "application/vnd.github+json"},
        )
        yield from (issue for issue in batch if "pull_request" not in issue)
        if len(batch) < 100:
            return
        page += 1


def previously_triaged(directory):
    runs = sorted((load_run(path) for path in directory.glob("*/run.json")),
                  key=lambda run: run.get("started_at", ""))
    completed = set()
    for run in runs:
        if run.get("source") != "github" or run.get("repo") != REPO:
            continue
        for issue in run["issues"]:
            if issue.get("triage") or (
                issue.get("status") == "escalate" and not issue.get("attempts")
            ):
                completed.add(issue["number"])
            else:
                completed.discard(issue["number"])
    return completed


def triage(fixture=None, refresh_issue=None):
    run = {"id": str(uuid4()), "repo": REPO, "started_at": timestamp(),
           "source": "fixture" if fixture else "github", "issues": []}
    path = ROOT / "artifacts" / run["id"] / "run.json"
    start = monotonic()
    try:
        schema = json.loads((ROOT / "config" / "triage.schema.json").read_text(encoding="utf-8-sig"))
        instructions = (ROOT / "config" / "TRIAGE_STANDARD.md").read_text(encoding="utf-8").split("## 8.")[0]
        issues = json.loads(fixture.read_text(encoding="utf-8")) if fixture else list(github_issues())
        if refresh_issue is not None:
            issues = [issue for issue in issues if issue["number"] == refresh_issue]
            if not issues:
                raise ValueError(f"Issue #{refresh_issue} is not open")
        elif not fixture:
            completed = previously_triaged(path.parent.parent)
            pending = [issue for issue in issues if issue["number"] not in completed]
            run["skipped_previously_triaged"] = len(issues) - len(pending)
            print(f'Skipped {run["skipped_previously_triaged"]} previously triaged issue(s).')
            issues = pending
        run["intake_ms"] = elapsed(start)
        key = None
        for issue in issues:
            title, title_hidden, title_exposed = sanitize(issue["title"])
            body, body_hidden, body_exposed = sanitize(issue.get("body"))
            hidden, exposed = title_hidden or body_hidden, title_exposed or body_exposed
            entry = {"number": issue["number"], "title": title,
                     "updated_at": issue.get("updated_at"), "attempts": []}
            run["issues"].append(entry)
            if exposed:
                entry.update(status="escalate", note="Suspected credential exposure. Alert a maintainer privately.")
                save_run(path, run)
                continue
            if not fixture and key is None:
                key = api_key()
            inputs = {"title": title, "body": body[:32000], "hidden_content_found": hidden,
                      "credential_exposure_found": False,
                      "author": sanitize((issue.get("user") or {}).get("login"))[0],
                      "existing_labels": [sanitize(label["name"])[0] for label in issue.get("labels", [])]}
            for index in range(1 if fixture else 2):
                since = monotonic()
                attempt = {"number": index + 1, "started_at": timestamp(), "usage": None}
                entry["attempts"].append(attempt)
                try:
                    result = issue["triage"] if fixture else structured_response(
                        key, os.getenv("TRIAGE_MODEL", DEFAULT_MODEL), instructions, inputs,
                        schema, "triage", attempt, 2500)
                    validate(result, schema)
                    redacted = {name: [sanitize(item)[0] for item in value] if isinstance(value, list)
                                else sanitize(value)[0] for name, value in result.items()}
                    decision = decide(redacted, hidden)
                    entry.update(triage=decision, status=decision["lane"])
                    entry.pop("note", None)
                    attempt["status"] = "completed"
                    break
                except (ValueError, RuntimeError) as error:
                    message = "Invalid JSON response" if isinstance(error, json.JSONDecodeError) else str(error)
                    attempt.update(status="failed", error=sanitize(message)[0])
                    entry.update(status="escalate", note="Triage failed. A maintainer must review this issue.")
                    if message.startswith(("HTTP 400 ", "HTTP 401 ", "HTTP 403 ", "HTTP 404 ", "HTTP 429 ")):
                        break
                finally:
                    attempt["elapsed_ms"] = elapsed(since)
            save_run(path, run)
            print(f'#{entry["number"]} {entry["status"]}')
    except (OSError, ValueError, RuntimeError) as error:
        run["error"] = sanitize(str(error))[0]
        raise
    finally:
        run.update(finished_at=timestamp(), elapsed_ms=elapsed(start))
        save_run(path, run)
        print(path)
    return path
