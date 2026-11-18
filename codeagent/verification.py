"""Run the target repository's checks and verify quick phrases in a browser."""

import os
import re
import shutil
import subprocess
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from time import monotonic

from .policy import sanitize
from .reporting import ROOT, load_run, save_run


def child_env():
    keep = {"path", "pathext", "systemroot", "windir", "comspec", "temp", "tmp",
            "home", "userprofile", "appdata", "localappdata", "systemdrive"}
    return {name: value for name, value in os.environ.items() if name.lower() in keep}


def git(folder, *args):
    result = subprocess.run(
        ["git", "-c", f"safe.directory={folder.resolve().as_posix()}", "-c", "core.hooksPath=/dev/null",
         "-C", str(folder), *args], env=child_env(), capture_output=True,
        encoding="utf-8", errors="replace", timeout=30)
    if result.returncode:
        raise RuntimeError("Git operation failed: " + sanitize(result.stderr.strip())[0])
    return result.stdout


def node_checks(workspace, npm, checks):
    executable = npm or shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not executable:
        raise RuntimeError("npm is missing. Install Node 22 or pass --npm.")
    executable = Path(executable).resolve()
    env = child_env()
    path_key = next((name for name in env if name.lower() == "path"), "PATH")
    env[path_key] = str(executable.parent) + os.pathsep + env.get(path_key, "")
    for args in [("ci", "--ignore-scripts"), ("run", "ci")]:
        started = monotonic()
        command = ["npm", *args]
        check = {"command": " ".join(command), "status": "failed"}
        checks.append(check)
        try:
            result = subprocess.run([str(executable), *args], cwd=workspace, env=env,
                                    capture_output=True, encoding="utf-8", errors="replace", timeout=120)
            check["output"] = sanitize(result.stdout + result.stderr)[0]
            if result.returncode:
                raise RuntimeError(f'{check["command"]} failed')
            check["status"] = "passed"
        finally:
            check["elapsed_ms"] = round((monotonic() - started) * 1000)


class SmokeHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        if self.path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        if not re.fullmatch(r"/(?:index\.html|display\.html|src/[a-z-]+\.(?:js|css))", self.path):
            self.send_error(404)
            return
        super().do_GET()


def smoke(workspace, phrases, browser):
    from playwright.sync_api import expect, sync_playwright

    handler = partial(SmokeHandler, directory=workspace)
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            origin = f"http://127.0.0.1:{server.server_port}"
            with sync_playwright() as playwright:
                executable = {"executable_path": str(browser)} if browser else {}
                chromium = playwright.chromium.launch(headless=True, env=child_env(), **executable)
                try:
                    context = chromium.new_context()
                    context.route("https://fonts.googleapis.com/**",
                                  lambda route: route.fulfill(status=200, content_type="text/css", body=""))
                    errors = []
                    for page in (display := context.new_page(), operator := context.new_page()):
                        page.on("pageerror", lambda error: errors.append(str(error)))
                        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
                        page.on("response", lambda response: errors.append(f"HTTP {response.status}: {response.url}")
                                if response.status >= 400 else None)
                    display.goto(origin + "/display.html")
                    operator.goto(origin + "/index.html")
                    expect(display.locator("#stage .idle")).to_be_visible()
                    for pair in phrases:
                        button = operator.locator("#phrases button").filter(has_text=pair["en"])
                        expect(button.locator("small")).to_have_text(pair["zh"])
                        button.click()
                        entry = display.locator("#stage .entry").filter(has_text=pair["en"])
                        expect(entry.locator(".en")).to_have_text(pair["en"])
                        expect(entry.locator(".zh")).to_have_text(pair["zh"])
                    if errors:
                        raise RuntimeError("Browser errors: " + " | ".join(errors))
                finally:
                    chromium.close()
        finally:
            server.shutdown()
            thread.join()


def verify(path, number, browser):
    run = load_run(path)
    coding = next((issue.get("coding") for issue in run["issues"] if issue["number"] == number), None)
    if not coding or not coding.get("commit") or not any(
        check["command"] == "npm run ci" and check["status"] == "passed" for check in coding["checks"]
    ):
        raise ValueError("A candidate commit with passing Node CI is required")
    workspace = (ROOT / coding["checkout"]).resolve()
    if not workspace.is_relative_to((ROOT / "workspaces").resolve()):
        raise ValueError("Candidate is outside the workspace directory")
    if git(workspace, "rev-parse", "HEAD").strip() != coding["commit"] or git(workspace, "status", "--porcelain"):
        raise ValueError("Candidate checkout changed")
    phrases = coding.get("phrases")
    if not phrases:
        raise ValueError("No proposed phrases in this run")
    started = monotonic()
    check = {"command": "Browser smoke test", "status": "failed"}
    coding["checks"].append(check)
    try:
        smoke(workspace, phrases, browser)
        check.update(status="passed", output="Both pages loaded and all added phrases reached the display.")
        coding.update(status="verified_locally", note="Ready for human review of the local candidate.")
    except Exception as error:
        check["output"] = sanitize(str(error))[0]
        coding.update(status="browser_check_failed", note="Resolve the browser check before publishing.")
        raise RuntimeError(check["output"]) from None
    finally:
        check["elapsed_ms"] = round((monotonic() - started) * 1000)
        save_run(path, run)
