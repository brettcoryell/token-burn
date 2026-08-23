import sys
from pathlib import Path
from unittest.mock import patch

REPO_ROOT = Path(__file__).parent.parent.parent
SCRIPTS_DIR = REPO_ROOT / "scripts"

if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import token_accounting_closeout


class _Result:
    returncode = 0


def test_token_accounting_closeout_runs_blessed_sequence(capsys):
    commands = []

    def fake_run(command, cwd=None, env=None):
        commands.append(command)
        return _Result()

    with patch.object(sys, "argv", ["token_accounting_closeout.py"]):
        with patch("token_accounting_closeout.subprocess.run", side_effect=fake_run):
            token_accounting_closeout.main()

    assert commands == [
        ["make", "collect"],
        ["make", "collect-codex"],
        ["make", "normalize-machine-labels"],
        ["make", "apply-high-confidence-annotations"],
        ["make", "suggest-annotations"],
        ["make", "audit-token-accounting-strict"],
    ]
    output = capsys.readouterr().out
    assert "Scope: token accounting only" in output


def test_token_accounting_closeout_can_skip_sources_for_troubleshooting():
    commands = []

    def fake_run(command, cwd=None, env=None):
        commands.append(command)
        return _Result()

    argv = ["token_accounting_closeout.py", "--skip-claude", "--skip-codex"]
    with patch.object(sys, "argv", argv):
        with patch("token_accounting_closeout.subprocess.run", side_effect=fake_run):
            token_accounting_closeout.main()

    assert commands == [
        ["make", "normalize-machine-labels"],
        ["make", "apply-high-confidence-annotations"],
        ["make", "suggest-annotations"],
        ["make", "audit-token-accounting-strict"],
    ]
