"""Command-line entry point for the issue agent."""

import argparse
import subprocess
from pathlib import Path

from .coding import code
from .policy import sanitize
from .publishing import publish
from .reporting import render, render_all
from .triage import triage
from .verification import verify


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    intake = commands.add_parser("triage", help="Classify open GitHub issues")
    triage_input = intake.add_mutually_exclusive_group()
    triage_input.add_argument("--fixture", type=Path)
    triage_input.add_argument("--refresh-issue", type=int, metavar="NUMBER",
                              help="Re-triage one open issue even if it was already classified")
    coding = commands.add_parser("code", help="Prepare one eligible phrasebook change")
    coding.add_argument("record", type=Path)
    coding.add_argument("issue", type=int)
    coding.add_argument("--repo", type=Path, required=True)
    coding.add_argument("--npm", type=Path)
    browser = commands.add_parser("verify", help="Verify the local candidate in Chromium")
    browser.add_argument("record", type=Path)
    browser.add_argument("issue", type=int)
    browser.add_argument("--browser", type=Path)
    publisher = commands.add_parser("publish", help="Publish a verified candidate in GitHub Actions")
    publisher.add_argument("record", type=Path)
    publisher.add_argument("issue", type=int)
    publisher.add_argument("--repo", type=Path, required=True)
    publisher.add_argument("--bundle", type=Path, required=True)
    dashboard = commands.add_parser("report", help="Render the standalone HTML dashboard")
    dashboard.add_argument("record", type=Path, nargs="?", help="Render one run. Omit for all saved runs.")
    args = parser.parse_args()
    try:
        if args.command == "triage":
            try:
                print(render(triage(args.fixture, args.refresh_issue)))
            finally:
                render_all()
        elif args.command == "code":
            try:
                code(args.record, args.issue, args.repo, args.npm)
            finally:
                render_all()
        elif args.command == "verify":
            try:
                verify(args.record, args.issue, args.browser)
            finally:
                render_all()
        elif args.command == "publish":
            try:
                print(publish(args.record, args.issue, args.repo, args.bundle))
            finally:
                render(args.record)
        else:
            print(render(args.record) if args.record else render_all())
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        parser.exit(1, sanitize(str(error))[0] + "\n")


if __name__ == "__main__":
    main()
