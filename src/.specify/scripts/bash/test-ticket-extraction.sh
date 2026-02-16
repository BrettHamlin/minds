#!/usr/bin/env bash
# Test ticket ID extraction with various formats

echo "Testing ticket ID extraction patterns..."
echo ""

test_extraction() {
    local description="$1"
    local expected="$2"

    # New generic pattern: any uppercase letters followed by dash and numbers
    if [[ "$description" =~ ([A-Z]+)-([0-9]+) ]]; then
        result="${BASH_REMATCH[0]}"
    else
        result=""
    fi

    if [ "$result" = "$expected" ]; then
        echo "✅ PASS: '$description' → '$result'"
        return 0
    else
        echo "❌ FAIL: '$description' → Expected '$expected', got '$result'"
        return 1
    fi
}

# Test cases
passed=0
failed=0

# Standard formats
test_extraction "BRE-123: Add feature" "BRE-123" && passed=$((passed + 1)) || failed=$((failed + 1))
test_extraction "PROJ-456 Fix bug" "PROJ-456" && passed=$((passed + 1)) || failed=$((failed + 1))
test_extraction "FEAT-789 Update docs" "FEAT-789" && passed=$((passed + 1)) || failed=$((failed + 1))

# Custom ticket systems
test_extraction "CUSTOM-999: New ticket system" "CUSTOM-999" && passed=$((passed + 1)) || failed=$((failed + 1))
test_extraction "ABC-1 Short prefix" "ABC-1" && passed=$((passed + 1)) || failed=$((failed + 1))
test_extraction "JIRA-12345 Long number" "JIRA-12345" && passed=$((passed + 1)) || failed=$((failed + 1))

# No ticket ID (should return empty)
test_extraction "No ticket here" "" && passed=$((passed + 1)) || failed=$((failed + 1))
test_extraction "Add authentication" "" && passed=$((passed + 1)) || failed=$((failed + 1))
test_extraction "Fix the bug in the system" "" && passed=$((passed + 1)) || failed=$((failed + 1))

# Edge cases
test_extraction "BRE-123 and PROJ-456 both present" "BRE-123" && passed=$((passed + 1)) || failed=$((failed + 1))
test_extraction "lowercase-123 should not match" "" && passed=$((passed + 1)) || failed=$((failed + 1))

echo ""
echo "======================================"
echo "Results: $passed passed, $failed failed"
echo "======================================"

if [ $failed -eq 0 ]; then
    echo "✅ All tests passed!"
    exit 0
else
    echo "❌ Some tests failed"
    exit 1
fi
