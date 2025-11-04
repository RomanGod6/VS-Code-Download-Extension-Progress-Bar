# Quick Start Guide

Get up and running with the Download Progress Tracker extension in 3 minutes!

## 🚀 Quick Setup

### Option 1: Test in Development Mode (Recommended for first time)

```bash
# 1. Install dependencies
npm install

# 2. Compile TypeScript
npm run compile

# 3. Press F5 in VS Code to launch Extension Development Host
```

### Option 2: One-Command Setup

```bash
./scripts/dev.sh
# Then press F5 in VS Code
```

## 🎯 First Test

Once the Extension Development Host opens:

1. **Open Command Palette** (Cmd/Ctrl+Shift+P)
2. Type: `Download Progress: Test Download`
3. Select a test file (try "Small JSON File" first)
4. **Watch the magic happen!** ✨

You'll see:
- Download icon appear in Activity Bar
- Progress in the sidebar
- Real-time speed updates

## 📦 Installing for Regular Use

Want to use it like a normal extension?

```bash
# Package and install
./scripts/install.sh

# Or manually:
npm run compile
vsce package
code --install-extension *.vsix
```

Then reload VS Code.

## 💡 Try These Features

### 🆕 Right-Click Downloads (NEW!)

1. **Right-click on any file** in Explorer
2. Select `Download with Progress Tracker`
3. Watch the progress with beautiful UI!

Works with:
- Local files (copies to downloads folder)
- SSH/Remote files (downloads with progress)
- Any file system VS Code supports

### Command Palette Options

Open Command Palette and try:

1. `Download Progress: Test Download (Demo)`
   - Choose from small, medium, or large test files
   - Perfect for seeing the extension in action

2. `Download Progress: Start Download`
   - Enter any URL to download
   - Try: `https://jsonplaceholder.typicode.com/posts`

3. `Download Progress: Show Downloads`
   - Opens beautiful progress panel
   - See detailed statistics and controls

## 🎨 Where to Look

**Activity Bar** (Left side):
- Look for the 📥 download icon
- Click it to see all downloads

**Progress Panel**:
- Command: `Download Progress: Show Downloads`
- Beautiful UI with live updates
- Speed, progress, time estimates

**Output Channel**:
- View → Output → Select "Download Progress"
- See detailed logs

## 🐛 Troubleshooting

**Extension not showing up?**
- Make sure you compiled: `npm run compile`
- Reload the Extension Development Host window

**Can't find the commands?**
- Open Command Palette (Cmd/Ctrl+Shift+P)
- Type "Download Progress"
- All commands start with "Download Progress:"

**Downloads not working?**
- Check the Output channel for errors
- Make sure you have internet connection
- Try a test download first

## 📝 What Works

✅ Real-time progress tracking
✅ Multiple simultaneous downloads
✅ Speed and time calculations
✅ Beautiful modern UI
✅ Sidebar integration
✅ File management (open, reveal)
✅ Cancel downloads
✅ Clear completed downloads
✅ **NEW:** Right-click context menu downloads
✅ **NEW:** SSH/Remote file support
✅ **NEW:** Automatic remote download detection

## 🔄 Development Workflow

```bash
# Start development
npm run watch          # Auto-compile on changes
# Press F5 to launch Extension Development Host

# Make changes to TypeScript files
# Extension Development Host will auto-reload

# Test your changes immediately!
```

## 📚 Next Steps

1. ✅ Test the extension with demo downloads
2. ✅ Try downloading real files
3. ✅ Explore the progress panel UI
4. ✅ Check out the sidebar view
5. 📖 Read the full README.md for more details

## 🎉 That's It!

You're ready to track downloads in style. Enjoy!

---

**Need help?** Check the Output channel or README.md for more details.
