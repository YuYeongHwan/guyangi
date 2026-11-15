"""매처 패키지 뼈대 확인 (TASKS 1.4). 매칭 규칙 테스트(M1~)는 Sprint 4 에서 쓴다."""

import sys


def test_matcher_imports_on_python_312():
    import matcher

    assert matcher.__name__ == "matcher"
    assert sys.version_info[:2] == (3, 12)
