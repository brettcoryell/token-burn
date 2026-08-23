import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent
SCRIPTS_DIR = REPO_ROOT / "scripts"

if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from suggest_annotations import score_row


def _row(session_date="2026-08-17", total_tokens=10_000_000):
    return {
        "id": "row-1",
        "session_id": "session-1",
        "session_date": session_date,
        "agent": "claude-code",
        "machine": "mini",
        "total_tokens": total_tokens,
        "existing_notes": None,
    }


def test_score_row_high_confidence_dday_title_and_git():
    suggestion = score_row(
        _row(),
        {
            "title": "Resume D-Day game development project",
            "cwd": "/Users/brettcoryell/Code/AI/open_brain",
        },
        Counter({"dday": 9}),
        Path("/Users/brettcoryell/Code/AI"),
    )

    assert suggestion.inferred_driver == "creative"
    assert suggestion.confidence == 0.9
    assert suggestion.confidence_label == "high"


def test_score_row_does_not_treat_resume_verb_as_career_project():
    suggestion = score_row(
        _row(),
        {
            "title": "Resume D-Day game development project",
            "cwd": "/Users/brettcoryell/Code/AI/open_brain",
        },
        Counter(),
        Path("/Users/brettcoryell/Code/AI"),
    )

    assert suggestion.inferred_driver == "creative"
    assert "career" not in suggestion.conflicts


def test_score_row_generic_title_remains_low_confidence():
    suggestion = score_row(
        _row(session_date="2026-07-25"),
        {
            "title": "Startup protocol and phase 4 preparation",
            "cwd": "/Users/brettcoryell/Code/AI/open_brain",
        },
        Counter({"dday": 59}),
        Path("/Users/brettcoryell/Code/AI"),
    )

    assert suggestion.confidence_label == "low"
    assert suggestion.confidence <= 0.5
