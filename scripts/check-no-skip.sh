#!/usr/bin/env bash
# 건너뛴 테스트(skip, only, fixme, xfail)가 있으면 실패한다 (docs/testing.md 5장).
# 예외는 .github/skip-allowlist.txt 로만 허용한다. 형식:  파일경로:줄에 들어 있는 문자열  # 사유
# 사유 주석이 없는 허용 줄도 실패다.
set -euo pipefail
cd "$(dirname "$0")/.."

ALLOW=".github/skip-allowlist.txt"
JS='\.(skip|only|fixme|todo)\b|\b(xit|xtest|xdescribe|fit|fdescribe)\('
PY='pytest\.mark\.(skip|skipif|xfail)|pytest\.(skip|xfail|importorskip)\('

fail=0
entries=()
while IFS= read -r line || [ -n "$line" ]; do
  trimmed="${line#"${line%%[![:space:]]*}"}"
  [ -z "$trimmed" ] && continue
  [ "${trimmed#\#}" != "$trimmed" ] && continue
  if ! printf '%s' "$line" | grep -qE '^[^:[:space:]]+:.+[[:space:]]#[[:space:]]*[^[:space:]]'; then
    echo "::error file=$ALLOW::사유 주석이 없는 허용 줄이에요: $line"
    echo "$ALLOW: 사유 주석이 없는 허용 줄: $line" >&2
    fail=1
    continue
  fi
  entry="${line%%[[:space:]]#*}"
  entry="${entry%"${entry##*[![:space:]]}"}" # 끝 공백 제거
  entries+=("$entry")
done < "$ALLOW"

hits="$(
  git ls-files -co --exclude-standard -z -- '*.test.ts' '*.test.tsx' '*.spec.ts' '*.spec.tsx' |
    xargs -0 -r grep -nHE "$JS" || true
  git ls-files -co --exclude-standard -z -- 'services/*.py' |
    xargs -0 -r grep -nHE "$PY" || true
)"

while IFS= read -r hit; do
  [ -z "$hit" ] && continue
  file="${hit%%:*}"
  rest="${hit#*:}"
  lineno="${rest%%:*}"
  text="${rest#*:}"
  allowed=0
  for entry in ${entries[@]+"${entries[@]}"}; do
    if [ "${entry%%:*}" = "$file" ] && [[ "$text" == *"${entry#*:}"* ]]; then
      allowed=1
      break
    fi
  done
  if [ "$allowed" -eq 0 ]; then
    echo "::error file=$file,line=$lineno::건너뛴 테스트: $text"
    echo "$file:$lineno: $text" >&2
    fail=1
  fi
done <<< "$hits"

if [ "$fail" -ne 0 ]; then
  echo "" >&2
  echo "건너뛴 테스트가 있어서 실패했어요. 테스트를 되살리거나, 꼭 필요하면 $ALLOW 에 사유와 함께 적으세요." >&2
  exit 1
fi
echo "건너뛴 테스트 없음"
