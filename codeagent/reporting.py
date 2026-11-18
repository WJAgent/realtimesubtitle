"""Persist run records and render a standalone review dashboard."""

import json
from html import escape
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]


def save_run(path, run):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{uuid4().hex}.tmp")
    try:
        temp.write_text(json.dumps(run, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temp.replace(path)
    finally:
        temp.unlink(missing_ok=True)


def load_run(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def text(value):
    return escape(str(value if value is not None else ""))


def seconds(ms):
    return f"{ms / 1000:.1f} s" if isinstance(ms, (int, float)) else "Unavailable"


def usage(attempt):
    counts = attempt.get("usage")
    if not counts:
        return "Usage unavailable"
    cached = counts.get("input_tokens_details", {}).get("cached_tokens")
    return (f'{text(counts.get("input_tokens"))} input / {text(counts.get("output_tokens"))} output tokens'
            + (f" ({text(cached)} cached input)" if cached is not None else ""))


def list_section(title, values):
    if not values:
        return ""
    return f"<h3>{title}</h3><ul>" + "".join(f"<li>{text(item)}</li>" for item in values) + "</ul>"


def issue_panel(issue, *, expanded=False):
    number = int(issue["number"])
    heading = f'#{number} {text(issue["title"])}'
    open_attr = " open" if expanded else ""
    parts = [f'<details{open_attr}><summary>{heading} <strong>{text(issue["status"])}</strong></summary><section>']
    decision = issue.get("triage")
    if decision:
        parts += [f'<p>{text(decision["reasoning"])}</p>',
                  f'<p>Model lane {text(decision["model_lane"])} · Size {text(decision["size"])}'
                  f' · Automated verification {text(decision["verifiable"])}</p>']
        for title, key in [
            ("Risk flags", "risk_flags"), ("Acceptance criteria", "acceptance_criteria"),
            ("Verification plan", "verification_plan"), ("Human input", "needs_human_input"),
            ("Clarifying questions", "clarifying_questions"),
        ]:
            parts.append(list_section(title, decision[key]))
    if issue.get("note"):
        parts.append(f'<p>{text(issue["note"])}</p>')
    if attempts := issue.get("attempts"):
        parts.append("<h3>Triage attempts</h3><ul>")
        for attempt in attempts:
            parts.append(f'<li>Attempt {text(attempt["number"])} · {text(attempt.get("status"))}'
                         f' · {seconds(attempt.get("elapsed_ms"))} · {usage(attempt)}'
                         f' {text(attempt.get("error"))}</li>')
        parts.append("</ul>")
    if coding := issue.get("coding"):
        parts += ["<h3>Coding and verification</h3>",
                  f'<p>{text(coding["status"])} · {seconds(coding.get("elapsed_ms"))} coding'
                  f' · {seconds(coding.get("model_elapsed_ms"))} model · {usage(coding)}</p>',
                  f'<p>{text(coding.get("branch"))} · <code>{text(coding.get("commit"))}</code></p>',
                  f'<p>{text(coding.get("note"))}</p>']
        if coding.get("diff"):
            parts.append(f'<details><summary>Patch</summary><pre>{text(coding["diff"])}</pre></details>')
        if publication := coding.get("publication"):
            url = publication.get("url", "")
            if url.startswith("https://github.com/jingx034/realtimesubtitle/pull/"):
                parts.append(f'<p><a href="{text(url)}">GitHub pull request</a> · '
                             f'{"Draft" if publication.get("draft") else "Open"} · {text(publication.get("ci"))}</p>')
        for check in coding.get("checks", []):
            parts.append(f'<details><summary>{text(check["command"])} · {text(check["status"])}'
                         f' · {seconds(check.get("elapsed_ms"))}</summary>'
                         f'<pre>{text(check.get("output"))}</pre></details>')
    parts.append("</section></details>")
    return "".join(parts)


def token_summary(runs):
    attempts = []
    for run in runs:
        for issue in run["issues"]:
            attempts.extend(issue.get("attempts", []))
            if issue.get("coding"):
                attempts.append(issue["coding"])
    counts = [item["usage"]["total_tokens"] for item in attempts
              if isinstance((item.get("usage") or {}).get("total_tokens"), int)]
    totals = f"{sum(counts):,} reported tokens" if counts else "Token usage unavailable"
    if len(counts) < len(attempts):
        totals += f" · usage missing for {len(attempts) - len(counts)} attempt(s)"
    return totals


def run_contents(run, *, expand_candidate=False):
    skipped = run.get("skipped_previously_triaged")
    totals = "0 model tokens" if skipped is not None and not run["issues"] and not run.get("error") else token_summary([run])
    return (
        f'<p>{len(run["issues"])} issue decisions · {seconds(run.get("intake_ms"))} intake'
        f' · {seconds(run.get("elapsed_ms"))} intake and triage · {totals}</p>'
        + (f'<p>{skipped} previously triaged issue(s) skipped.</p>' if skipped is not None else "")
        + (f'<p role="status">{text(run["error"])}</p>' if run.get("error") else "")
        + "".join(issue_panel(issue, expanded=expand_candidate and bool(issue.get("coding")))
                  for issue in run["issues"])
    )


def write_dashboard(output, title, header, contents):
    page = f"""<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>{text(title)}</title>
<style>
body {{margin:0;background:#f4f5f0;color:#20291f;font:16px/1.55 system-ui}}
main {{max-width:880px;margin:auto;padding:clamp(20px,6vw,65px)}}
h1 {{font-size:2.4rem;line-height:1.1;margin:.15em 0}}
details {{background:white;border:1px solid #d5dbd0;margin:.7em 0;border-radius:8px}}
summary {{cursor:pointer;padding:1em;overflow-wrap:anywhere}}
strong {{margin-left:.65em;color:#265438}} section {{padding:0 1.25em 1em}}
h3 {{font-size:.95rem;margin-bottom:0}} pre {{overflow:auto;padding:1em;background:#f4f5f0}}
.run {{margin:1.1em 0;border-color:#a7b5a3}}
.run > summary {{font-size:1.1rem;font-weight:650}}
.run > section > details {{background:#fafbf8}}
</style><main>
<header><h1>{text(title)}</h1>{header}</header>
{contents}
</main></html>
"""
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(page, encoding="utf-8")
    return output


def render(path):
    run = load_run(path)
    header = f'<p>{text(run["repo"])} · {text(run.get("source"))} · {text(run.get("started_at"))}</p>'
    return write_dashboard(path.with_name("dashboard.html"), "Issue agent run", header, run_contents(run))


def render_all(directory=ROOT / "artifacts"):
    runs = sorted((load_run(path) for path in directory.glob("*/run.json")),
                  key=lambda run: run.get("started_at") or "", reverse=True)
    latest_candidate = next((run for run in runs if any(issue.get("coding") for issue in run["issues"])), None)
    featured = latest_candidate or next(iter(runs), None)
    sections = []
    for run in runs:
        opened = run is featured
        label = "Intake failed" if run.get("error") and not run["issues"] else "Saved run"
        sections.append(
            f'<details class="run"{" open" if opened else ""}><summary>{label}'
            f' · {text(run.get("started_at"))} · {len(run["issues"])} issue decisions</summary>'
            f'<section><p>{text(run["repo"])} · {text(run.get("source") or "intake")}'
            f' · Run <code>{text(run.get("id"))}</code></p>'
            f'{run_contents(run, expand_candidate=opened)}</section></details>'
        )
    header = f'<p>{len(runs)} saved runs · {sum(len(run["issues"]) for run in runs)} issue decisions · {token_summary(runs)}</p>'
    return write_dashboard(directory / "dashboard.html", "Issue agent dashboard", header,
                           "".join(sections) or "<p>No saved runs yet.</p>")
