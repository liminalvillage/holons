#!/bin/bash
# run-test.sh <test_name>
# Runs vitest with output redirected to prevent FD inheritance from blocking GHA steps.
# Streams output via tail -f for real-time visibility.
set -u

TEST_NAME=$1
LOGFILE=$(mktemp /tmp/test-output-XXXXXX.log)

# Run vitest with output to file (orphan processes inherit file FDs, not pipe FDs)
npx vitest run "$TEST_NAME" --reporter=verbose > "$LOGFILE" 2>&1 &
VITEST_PID=$!

# Stream output in real-time
tail -f "$LOGFILE" &
TAIL_PID=$!

# Wait for vitest to finish
wait $VITEST_PID 2>/dev/null
EXIT_CODE=$?

# Stop streaming
kill $TAIL_PID 2>/dev/null
wait $TAIL_PID 2>/dev/null

# Nuclear cleanup of all test-related processes
pkill -9 -f ad4m-executor 2>/dev/null || true
pkill -9 -f holochain 2>/dev/null || true
pkill -9 -f lair-keystore 2>/dev/null || true
pkill -9 -f kitsune2 2>/dev/null || true
sleep 2

rm -f "$LOGFILE"
exit $EXIT_CODE
