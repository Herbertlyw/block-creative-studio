#!/usr/bin/env python3
"""Small local state machine for BB demo recreation and variant tasks."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

EDGES = {
    "intake": {"prepare"},
    "prepare": {"intake", "execute"},
    "execute": {"prepare", "check"},
    "check": {"execute", "deliver"},
    "deliver": {"execute", "check", "done"},
    "done": set(),
}
FORMAT = "bb-demo-task"
VERSION = 1


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def fingerprint(filename, role):
    path = Path(filename).expanduser().resolve(strict=True)
    if not path.is_file():
        raise ValueError("Expected a regular file: " + str(path))
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
            size += len(chunk)
    if size == 0:
        raise ValueError("File is empty: " + str(path))
    return {
        "path": str(path),
        "role": role,
        "bytes": size,
        "sha256": digest.hexdigest(),
    }


def load_state(path):
    state = json.loads(path.read_text(encoding="utf-8"))
    if state.get("format") != FORMAT or state.get("version") != VERSION:
        raise ValueError("Unsupported task state format")
    return state


def save_atomic(path, state):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=str(path.parent),
            prefix=".task-", suffix=".tmp", delete=False
        ) as handle:
            temporary = Path(handle.name)
            json.dump(state, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(str(temporary), str(path))
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def invalidate(state):
    state["check"] = {
        "result": "not-run",
        "note": "Inputs, scope, artifacts or execution changed.",
    }


def require_evidence(state):
    roles = {item["role"] for item in state["artifacts"]}
    required = {"project"}
    if state["endpoint"] != "project":
        required.add(state["endpoint"])
    missing = required - roles
    if missing:
        raise ValueError("Missing artifact roles: " + ", ".join(sorted(missing)))
    for item in state["inputs"] + state["artifacts"]:
        actual = fingerprint(item["path"], item["role"])
        if actual != item:
            raise ValueError(
                "Recorded file changed; inspect and register it again: "
                + item["path"]
            )


def add_file(state, collection, item):
    state[collection] = [
        old for old in state[collection]
        if (old["path"], old["role"]) != (item["path"], item["role"])
    ] + [item]
    invalidate(state)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=[
        "init", "status", "input", "artifact", "scope",
        "advance", "check", "hold", "resume", "note",
    ])
    parser.add_argument("directory", type=Path)
    parser.add_argument("--kind", choices=["recreation", "variant"])
    parser.add_argument("--request")
    parser.add_argument("--endpoint", choices=["project", "preview", "video"])
    parser.add_argument("--file")
    parser.add_argument("--role")
    parser.add_argument("--change", action="append")
    parser.add_argument("--preserve", action="append")
    parser.add_argument("--to", choices=list(EDGES) + ["blocked", "paused"])
    parser.add_argument("--result", choices=["passed", "needs-fix"])
    parser.add_argument("--note", default="")
    parser.add_argument("--next")
    args = parser.parse_args()

    directory = args.directory.resolve()
    state_file = directory / "task.json"
    if args.command == "status":
        print(json.dumps(load_state(state_file), ensure_ascii=False, indent=2))
        return

    if args.command == "init":
        directory.mkdir(parents=True, exist_ok=True)
    elif not state_file.is_file():
        raise ValueError("Task does not exist; initialize it first.")

    lock = directory / ".state-lock"
    try:
        lock.mkdir()
    except FileExistsError:
        raise ValueError("Task is locked. Check for another writer: " + str(lock))

    try:
        detail = {}
        if args.command == "init":
            if state_file.exists():
                raise ValueError("Task already exists; original state preserved.")
            if not args.kind or not args.request or not args.endpoint:
                raise ValueError("init requires --kind, --request and --endpoint")
            state = {
                "format": FORMAT,
                "version": VERSION,
                "kind": args.kind,
                "request": args.request,
                "endpoint": args.endpoint,
                "stage": "intake",
                "resumeFrom": None,
                "createdAt": now(),
                "updatedAt": now(),
                "scope": {"changes": [], "preserve": []},
                "inputs": [],
                "artifacts": [],
                "check": {"result": "not-run", "note": ""},
                "nextAction": args.next or "Identify inputs and task scope.",
                "history": [],
            }
            previous = None
        else:
            state = load_state(state_file)
            previous = state["stage"]
            if previous == "done":
                raise ValueError("Completed task is immutable; start a new task.")

            if args.command in {"advance", "check", "hold", "resume", "note"}:
                if not args.note.strip():
                    raise ValueError("This command requires a meaningful --note.")

            if args.command in {"input", "artifact"}:
                if not args.file or not args.role:
                    raise ValueError("File registration requires --file and --role")
                item = fingerprint(args.file, args.role)
                collection = "inputs" if args.command == "input" else "artifacts"
                add_file(state, collection, item)
                detail = item

            elif args.command == "scope":
                if args.change is None and args.preserve is None:
                    raise ValueError("scope requires --change or --preserve")
                if args.change is not None:
                    state["scope"]["changes"] = args.change
                if args.preserve is not None:
                    state["scope"]["preserve"] = args.preserve
                invalidate(state)
                detail = dict(state["scope"])

            elif args.command == "advance":
                if args.to not in EDGES.get(previous, set()):
                    raise ValueError(
                        "Invalid transition: " + previous + " -> " + str(args.to)
                    )
                if args.to == "execute":
                    if not state["inputs"]:
                        raise ValueError("Register the source or base project first.")
                    if state["kind"] == "variant" and not state["scope"]["changes"]:
                        raise ValueError("Record the variant change scope first.")
                    invalidate(state)
                if args.to in {"deliver", "done"}:
                    if state["check"]["result"] != "passed":
                        raise ValueError("Record the actual lightweight check first.")
                    require_evidence(state)
                state["stage"] = args.to

            elif args.command == "check":
                if previous != "check":
                    raise ValueError("Check results can only be recorded in check.")
                if args.result is None:
                    raise ValueError("check requires --result")
                if args.result == "passed":
                    require_evidence(state)
                state["check"] = {
                    "result": args.result,
                    "note": args.note,
                    "time": now(),
                }

            elif args.command == "hold":
                if args.to not in {"blocked", "paused"} or previous not in EDGES:
                    raise ValueError("hold requires an active stage and blocked/paused.")
                state["resumeFrom"] = previous
                state["stage"] = args.to

            elif args.command == "resume":
                if previous not in {"blocked", "paused"}:
                    raise ValueError("Only blocked or paused tasks can resume.")
                target = state.get("resumeFrom")
                if target not in EDGES or target == "done":
                    raise ValueError("Invalid resume stage.")
                state["stage"] = target
                state["resumeFrom"] = None

            elif args.command == "note":
                pass

        if args.next is not None:
            state["nextAction"] = args.next
        if state["stage"] == "done":
            state["nextAction"] = ""
        state["updatedAt"] = now()
        state["history"].append({
            "time": state["updatedAt"],
            "command": args.command,
            "from": previous,
            "to": state["stage"],
            "note": args.note,
            "detail": detail,
        })
        save_atomic(state_file, state)
        print(json.dumps({
            "task": str(state_file),
            "stage": state["stage"],
            "nextAction": state["nextAction"],
            "check": state["check"]["result"],
        }, ensure_ascii=False, indent=2))
    finally:
        lock.rmdir()


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError) as error:
        print("BB task state: " + str(error), file=sys.stderr)
        sys.exit(1)
