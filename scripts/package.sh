#!/bin/bash

# Package script - Create .vsix file for distribution

echo "📦 Packaging extension..."

# Install vsce if not already installed
if ! command -v vsce &> /dev/null; then
    echo "Installing vsce..."
    npm install -g @vscode/vsce
fi

# Compile
echo "🔨 Compiling TypeScript..."
npm run compile

# Package
echo "📦 Creating .vsix package..."
vsce package

echo "✅ Package created successfully!"
echo ""
echo "To install the extension:"
echo "  code --install-extension *.vsix"
echo ""
echo "Or drag and drop the .vsix file into VS Code"
