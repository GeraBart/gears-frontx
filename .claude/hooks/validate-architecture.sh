#!/bin/bash
# PostToolUse hook: validate architecture artifacts after edits
# Runs cfs validate + cfs validate-toc when architecture/**/*.md files are modified.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only run for architecture markdown files
case "$FILE_PATH" in
  */architecture/*.md|*/architecture/**/*.md) ;;
  *) exit 0 ;;
esac

cd "$CLAUDE_PROJECT_DIR" || exit 0

# Run structure validation (full project, fast)
# Use --json and extract compact one-liners to save tokens
VALIDATE_OUT=$(cfs validate --json 2>&1)
VALIDATE_EXIT=$?

ERROR_COUNT=$(echo "$VALIDATE_OUT" | jq -r '.error_count // 0')
WARNING_COUNT=$(echo "$VALIDATE_OUT" | jq -r '.warning_count // 0')

if [ "$ERROR_COUNT" -gt 0 ] 2>/dev/null; then
  ERRORS=$(echo "$VALIDATE_OUT" | jq -r '.errors[]? | "\(.location) [\(.code)] \(.message)"')
  echo "cfs validate: $ERROR_COUNT error(s)" >&2
  echo "$ERRORS" >&2
  # Skip TOC check when structural errors exist
  exit 0
fi

if [ "$WARNING_COUNT" -gt 0 ] 2>/dev/null; then
  WARNINGS=$(echo "$VALIDATE_OUT" | jq -r '.warnings[]? | "\(.location) [\(.code)] \(.message)"')
  echo "cfs validate: $WARNING_COUNT warning(s)" >&2
  echo "$WARNINGS" >&2
fi

# Auto-fix TOC (mechanical, idempotent) then validate
cfs toc "$FILE_PATH" >/dev/null 2>&1

TOC_OUT=$(cfs validate-toc "$FILE_PATH" 2>&1)
TOC_EXIT=$?

if [ $TOC_EXIT -ne 0 ]; then
  echo "cfs validate-toc: errors in $(basename "$FILE_PATH")" >&2
  echo "$TOC_OUT" >&2
fi

# Don't block edits — just inform
exit 0
