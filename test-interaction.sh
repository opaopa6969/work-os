#!/bin/bash

SESSION="test-interaction"
SOCKET="/tmp/tmux-1000/default"

echo "=== Testing different Enter key methods ==="

test_key() {
    METHOD=$1
    KEY_CMD=$2
    echo -e "\n--- Method: $METHOD ---"
    tmux -S "$SOCKET" new-session -d -s "$SESSION" "echo 'Wait for input...'; read input; echo 'Got: '\$input; sleep 1000"
    sleep 0.5
    
    # Send text and then the key
    tmux -S "$SOCKET" send-keys -t "$SESSION" "test_from_$METHOD"
    sleep 0.2
    # Execute the key command
    eval "tmux -S \"$SOCKET\" $KEY_CMD"
    
    sleep 0.5
    CAPTURE=$(tmux -S "$SOCKET" capture-pane -pt "$SESSION")
    echo "Capture:"
    echo "$CAPTURE"
    
    if echo "$CAPTURE" | grep -q "Got: test_from_$METHOD"; then
        echo "RESULT: SUCCESS"
        tmux -S "$SOCKET" kill-session -t "$SESSION"
        return 0
    else
        echo "RESULT: FAILURE"
        tmux -S "$SOCKET" kill-session -t "$SESSION"
        return 1
    fi
}

test_key "Literal Enter" "send-keys -t \"$SESSION\" Enter"
test_key "C-m" "send-keys -t \"$SESSION\" C-m"
test_key "Hex 0D" "send-keys -t \"$SESSION\" 0x0D"
test_key "Multiple args" "send-keys -t \"$SESSION\" \"hello\" Enter"
