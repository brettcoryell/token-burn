import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parent.parent.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from scale_uncorrected_rows import OLD_MARKER, scaled_update  # noqa: E402


def _row(notes):
    return {
        "input_tokens": 1000, "output_tokens": 2000, "cache_read": 187_300, "cache_create": 9_365,
        "api_requests": 374, "total_tokens": 199_665, "fidelity": "exact", "notes": notes,
    }


def test_scaled_update_divides_counts_and_preserves_originals():
    update = scaled_update(_row(f"ACUTE research {OLD_MARKER}"), factor=1.873, today="2026-10-23")

    assert update["fidelity"] == "estimated"
    assert update["cache_read"] == 100_000
    assert update["api_requests"] == 200
    original = update["pre_scale_counts"]
    assert original["total_tokens"] == 199_665
    assert original["cache_read"] == 187_300
    assert original["fidelity"] == "exact"
    assert original["factor"] == 1.873
    assert original["scaled_on"] == "2026-10-23"


def test_scaled_update_replaces_the_uncorrected_marker_and_keeps_the_description():
    update = scaled_update(_row(f"ACUTE research {OLD_MARKER}"))

    assert update["notes"].startswith("ACUTE research [scaled estimate: pre-D15 count / 1.873")
    assert "uncorrected" not in update["notes"]


def test_scaled_update_handles_empty_notes():
    update = scaled_update(_row(None))

    assert update["notes"].startswith("[scaled estimate")
