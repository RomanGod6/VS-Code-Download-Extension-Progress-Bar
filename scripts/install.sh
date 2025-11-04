#!/bin/bash

# Install script - Package and install the extension locally

echo "📦 Building and installing extension..."

# Run package script
./scripts/package.sh

# Install the extension
echo "📥 Installing extension..."
code --install-extension *.vsix --force

echo "✅ Extension installed successfully!"
echo ""
echo "Reload VS Code to activate the extension"
echo "Then try: 'Download Progress: Test Download (Demo)'"
