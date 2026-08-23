from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent.parent
MCP_TS = REPO_ROOT / "api" / "mcp.ts"


def test_exact_session_mcp_tools_require_structural_machine_labels():
    source = MCP_TS.read_text()

    assert 'z.enum(["mini", "imac", "macbook"])' in source
    assert 'z.enum(["cadence", "coda", "ariel"])' not in source
    assert '.default("lumen")' not in source
    assert 'Do not use agent nicknames such as cadence, coda, or lumen' in source
