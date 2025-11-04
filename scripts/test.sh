#!/bin/bash

# Test script - Compile and test the extension

echo "🔨 Compiling TypeScript..."
npm run compile

echo "✅ Compilation successful!"
echo ""
echo "📦 Extension is ready to test"
echo ""
echo "To test the extension:"
echo "1. Press F5 in VS Code to launch Extension Development Host"
echo "2. In the new window, open Command Palette (Cmd/Ctrl+Shift+P)"
echo "3. Try these commands:"
echo "   - 'Download Progress: Test Download (Demo)'"
echo "   - 'Download Progress: Show Downloads'"
echo "   - 'Download Progress: Start Download'"
echo ""
echo "The extension will appear in the Activity Bar with a download icon 📥"
