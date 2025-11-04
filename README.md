# Download Progress Tracker

A beautiful and functional VS Code extension for tracking download progress with a modern UI.

## Features

- **Real-time Progress Tracking**: Monitor download progress with live updates
- **Beautiful UI**: Modern, responsive interface with smooth animations
- **Sidebar Integration**: Dedicated view in the Activity Bar for quick access
- **Detailed Progress Panel**: Full-featured webview with comprehensive download statistics
- **Speed & Time Estimates**: Real-time download speed and time remaining calculations
- **Multiple Downloads**: Handle multiple simultaneous downloads
- **Easy File Access**: Quick actions to open downloaded files or reveal in explorer
- **Test Mode**: Built-in test downloads to try the extension

## Screenshots

### Sidebar View
The extension adds a download icon to the Activity Bar. Click it to see all active downloads with:
- Real-time progress percentages
- Download speeds
- File sizes
- Status indicators

### Progress Panel
Open the detailed progress panel to see:
- Beautiful progress bars with animations
- Download statistics (size, speed, time remaining)
- Action buttons (cancel, open file, etc.)
- Professional gradient design

## Installation

### For Development

1. **Clone and install dependencies:**
   ```bash
   git clone <repository-url>
   cd VS-Code-Download-Extension-Progress-Bar
   npm install
   ```

2. **Compile the extension:**
   ```bash
   npm run compile
   ```

3. **Test in VS Code:**
   - Press `F5` to open Extension Development Host
   - Or run: `./scripts/dev.sh`

### For Production Use

1. **Package the extension:**
   ```bash
   ./scripts/package.sh
   ```

2. **Install the .vsix file:**
   ```bash
   code --install-extension *.vsix
   ```
   Or use: `./scripts/install.sh` to do both steps automatically

## Usage

### Starting a Download

1. Open Command Palette (`Cmd/Ctrl+Shift+P`)
2. Type: `Download Progress: Start Download`
3. Enter the URL to download
4. (Optional) Specify a custom filename

### Test Download

Try the extension with test files:

1. Open Command Palette
2. Type: `Download Progress: Test Download (Demo)`
3. Choose from test files of various sizes

### Viewing Progress

**Sidebar View:**
- Click the download icon (📥) in the Activity Bar
- See all downloads in the tree view

**Progress Panel:**
- Command: `Download Progress: Show Downloads`
- Or click a download in the sidebar
- View detailed statistics and controls

### Managing Downloads

**Cancel a Download:**
- Right-click on a downloading item in the sidebar
- Or use the Cancel button in the progress panel

**Clear Completed:**
- Command: `Download Progress: Clear Completed`
- Or use the button in the progress panel

**Open Downloaded Files:**
- Click on completed downloads in the sidebar
- Or use the context menu options

## Commands

| Command | Description |
|---------|-------------|
| `Download Progress: Start Download` | Start a new download |
| `Download Progress: Show Downloads` | Open the progress panel |
| `Download Progress: Test Download (Demo)` | Try test downloads |
| `Download Progress: Clear Completed` | Remove completed downloads from list |

## Development Scripts

```bash
# Development mode with watch
npm run watch
./scripts/dev.sh

# Compile TypeScript
npm run compile

# Test the extension
./scripts/test.sh

# Package for distribution
npm run package
./scripts/package.sh

# Package and install locally
./scripts/install.sh
```

## Project Structure

```
.
├── src/
│   ├── extension.ts              # Main entry point
│   ├── downloadManager.ts        # Download logic and state management
│   ├── downloadTreeProvider.ts   # Sidebar tree view provider
│   └── progressPanel.ts          # Webview panel with detailed UI
├── resources/
│   └── download.svg              # Extension icon
├── scripts/
│   ├── dev.sh                    # Development script
│   ├── test.sh                   # Testing script
│   ├── package.sh                # Packaging script
│   └── install.sh                # Install script
├── package.json                  # Extension manifest
└── tsconfig.json                 # TypeScript configuration
```

## Technical Details

### Download Manager
- Uses Node.js `https`/`http` modules for downloads
- Tracks progress, speed, and time estimates
- Handles redirects automatically
- Emits events for UI updates

### UI Components
1. **Tree View Provider**: Sidebar integration with VS Code's tree view API
2. **Webview Panel**: Custom HTML/CSS/JavaScript interface with:
   - Gradient progress bars
   - Animated loading states
   - Responsive grid layout
   - Real-time statistics

### Features
- TypeScript for type safety
- Event-driven architecture
- Automatic file naming
- Workspace-aware save locations (saves to `downloads/` folder in workspace)
- Proper cleanup and disposal

## Requirements

- VS Code 1.75.0 or higher
- Node.js 18.x or higher

## Configuration

Downloads are saved to:
- `<workspace>/downloads/` if a workspace is open
- User's home directory otherwise

## Known Limitations

- No pause/resume functionality (yet)
- No bandwidth limiting
- No authentication support
- Downloads one chunk at a time (single connection)

## Future Enhancements

- [ ] Pause and resume downloads
- [ ] Download queue management
- [ ] Bandwidth limiting
- [ ] Authentication support (username/password, tokens)
- [ ] Multi-connection downloads for speed
- [ ] Download history
- [ ] Retry failed downloads
- [ ] Browser integration
- [ ] Scheduled downloads

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

MIT License - feel free to use this extension however you'd like!

## Support

If you encounter any issues or have questions:
1. Check the Output panel: `Download Progress` channel
2. Open an issue on GitHub
3. Review the console logs in Extension Development Host

## Changelog

### 1.0.0 (Initial Release)
- Real-time download progress tracking
- Beautiful modern UI
- Sidebar integration
- Progress panel with detailed statistics
- Test download functionality
- File management (open, reveal in explorer)
- Download speed and time estimates

---

Made with ❤️ for the VS Code community
