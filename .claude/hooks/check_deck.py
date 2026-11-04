"""Stop hook: don't let Claude finish while the architecture deck is out of date.

Blocks (and tells Claude why) when application code has changed on this branch
or in the working tree, but documentation/Claude-Chat-Bot-Architecture.pptx
hasn't been regenerated since. See CLAUDE.md for the rule this enforces.
"""

import json
import os
import subprocess
import sys

DECK = "documentation/Claude-Chat-Bot-Architecture.pptx"
CODE_PREFIXES = ("backend/", "frontend/src/", "frontend/index.html", "frontend/vite.config.js")
IGNORED_PARTS = ("/.venv/", "/__pycache__/", "/node_modules/")


def git(*args: str) -> str:
    result = subprocess.run(["git", *args], capture_output=True, text=True, cwd=ROOT)
    return result.stdout if result.returncode == 0 else ""


def changed_files() -> set[str]:
    files = set()
    # Uncommitted changes, including new untracked files.
    for line in git("status", "--porcelain", "--untracked-files=all").splitlines():
        path = line[3:].split(" -> ")[-1].strip().strip('"')
        files.add(path)
    # Commits on this branch that aren't on main yet.
    base = git("merge-base", "HEAD", "origin/main").strip()
    if base:
        files.update(git("diff", "--name-only", f"{base}...HEAD").splitlines())
    return {f.replace("\\", "/") for f in files if f}


def is_code(path: str) -> bool:
    return path.startswith(CODE_PREFIXES) and not any(p in "/" + path for p in IGNORED_PARTS)


def mtime(path: str) -> float:
    try:
        return os.path.getmtime(os.path.join(ROOT, path))
    except OSError:
        return 0.0  # deleted file


def main() -> None:
    hook_input = json.load(sys.stdin) if not sys.stdin.isatty() else {}
    if hook_input.get("stop_hook_active"):
        return  # Claude already responded to this hook once; don't loop.

    changed = changed_files()
    code = sorted(f for f in changed if is_code(f))
    if not code:
        return

    deck_time = mtime(DECK)
    stale = [f for f in code if mtime(f) > deck_time]
    if DECK in changed and not stale:
        return  # deck was regenerated after the latest code change

    print(json.dumps({
        "decision": "block",
        "reason": (
            "The architecture deck may be out of date. Code changed since it was last built: "
            + ", ".join(stale or code)
            + f". If these changes alter the architecture, design, tools or features, update "
            "documentation/deck/build_deck.js and run `npm run build` in documentation/deck "
            f"to regenerate {DECK} (see CLAUDE.md). If they don't affect anything the deck "
            "describes (for example a pure bug fix), say so briefly and finish."
        ),
    }))


ROOT = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()

if __name__ == "__main__":
    main()
