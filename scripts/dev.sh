#!/bin/bash

# Development script - Install dependencies and run in watch mode

echo "🔧 Installing dependencies..."
npm install

echo "🔨 Compiling TypeScript..."
npm run compile

echo "🚀 Starting watch mode..."
echo "Press F5 in VS Code to launch the extension in debug mode"
npm run watch
