#!/bin/bash

# ──────────────────────────────────────────────────────────────────────
# Ollama Auto-Init Script
# Automatically pulls the LLM model when container starts
# ──────────────────────────────────────────────────────────────────────

set -e

MODEL_NAME="hf.co/HauhauCS/Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced:Q4_K_M"

echo "═══════════════════════════════════════════════════════════"
echo "  🤖 Ollama Auto-Init"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Model: $MODEL_NAME"
echo ""

# Wait for Ollama to be ready
echo "Waiting for Ollama to start..."
for i in {1..30}; do
    if ollama list >/dev/null 2>&1; then
        echo "✓ Ollama is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "✗ Ollama failed to start"
        exit 1
    fi
    sleep 2
done

# Check if model already exists
if ollama list 2>/dev/null | grep -q "HauhauCS"; then
    echo "✓ Model already exists"
    echo ""
    echo "Available models:"
    ollama list
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "  ✅ Ollama is ready!"
    echo "═══════════════════════════════════════════════════════════"
    exit 0
fi

# Pull model
echo "Pulling model (this may take 10-30 minutes)..."
echo "Model size: ~7.5GB"
echo ""

ollama pull "$MODEL_NAME"

if [ $? -eq 0 ]; then
    echo ""
    echo "✓ Model pulled successfully!"
    echo ""
    
    # Test model
    echo "Running quick test..."
    TEST_OUTPUT=$(ollama run "$MODEL_NAME" "Hello! Just say 'Hi' and nothing else." 2>&1)
    
    if [ $? -eq 0 ]; then
        echo "✓ Model is working!"
        echo "  Response: $TEST_OUTPUT"
    else
        echo "! Model test failed, but pull was successful"
    fi
    
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "  ✅ Ollama is ready with model!"
    echo "═══════════════════════════════════════════════════════════"
else
    echo ""
    echo "✗ Failed to pull model"
    echo "You can pull manually later with: ./pull-model.sh"
    exit 1
fi
