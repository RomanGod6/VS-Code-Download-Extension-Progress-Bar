# 🧰 Developer Toolbox - Ultimate VS Code Utilities Suite

**The Swiss Army knife for developers!** All-in-one utility extension with 30+ tools for downloads, text processing, file operations, API testing, and more - all natively integrated into VS Code.

## ✨ What's Included

### 📥 Download Manager
- **Download from URL** with real-time progress tracking
- **Batch downloads** - paste multiple URLs at once
- **Right-click downloads** from Explorer (files, SSH, remote)
- **Clipboard URL detection** - auto-prompt when you copy a URL
- **Resume & retry** failed downloads
- Beautiful progress UI with speed & time estimates

### 🌐 API Tester (Like Postman!)
- **Send HTTP requests** (GET, POST, PUT, DELETE, PATCH)
- **Auto-detect APIs** in your code (fetch, axios calls)
- **Request history** - replay previous requests
- **Beautiful response viewer** with JSON formatting
- Custom headers & request bodies
- No need to leave VS Code!

### 📋 Clipboard Manager
- **Automatic history** of everything you copy (last 50 items)
- **Smart detection** - identifies URLs, code, and text
- **Pin important items** to keep them forever
- **Search history** and quickly re-copy
- **URL notifications** - get notified when you copy a URL

### 🔤 Text Utilities
- **Hash generation** - MD5, SHA-1, SHA-256, SHA-512
- **Base64 encode/decode**
- **URL encode/decode**
- **JSON format/minify**
- **JSON ↔ CSV conversion**
- **Case converter** - camelCase, snake_case, kebab-case, etc.
- **Lorem Ipsum generator**

### 📁 File Utilities
- **File hashing** - generate checksums for any file
- **Extract archives** - unzip .zip files with one click
- **Create archives** - compress files/folders to .zip
- **File size calculator**

### ⚡ Quick Actions
- **Generate UUID** - instant unique IDs
- **Timestamp converter** - Unix timestamp ↔ Date
- **Current timestamp** - get now, yesterday, tomorrow
- And more utilities at your fingertips!

## 🚀 Getting Started

### Installation

```bash
# Clone and install
git clone <repository-url>
cd VS-Code-Download-Extension-Progress-Bar
npm install
npm run compile

# Test in development
# Press F5 in VS Code

# Or install as extension
./scripts/install.sh
```

### Quick Start

1. **Open the Toolbox** - Click the toolbox icon (🧰) in the Activity Bar
2. **Try Quick Actions** - See all available utilities in the sidebar
3. **Test a download** - Command Palette → "Toolbox: Test Download"
4. **Send an API request** - Command Palette → "Toolbox: Test API"

## 💡 Usage Examples

### Download Files

**From URL:**
```
Cmd/Ctrl+Shift+P → "Toolbox: Download from URL"
Enter: https://example.com/file.zip
```

**Batch Download:**
```
Cmd/Ctrl+Shift+P → "Toolbox: Batch Download URLs"
Paste multiple URLs (one per line or comma-separated)
```

**Right-click in Explorer:**
```
Right-click any file → "Download with Toolbox"
Works with SSH, remote files, and local files!
```

### Test APIs

**Quick API Test:**
```
Cmd/Ctrl+Shift+P → "Toolbox: Test API"
Select method (GET, POST, etc.)
Enter URL
Add headers/body if needed
Send!
```

**Auto-detect APIs in Code:**
```
Open a file with fetch() or axios calls
Cmd/Ctrl+Shift+P → "Toolbox: Detect APIs in File"
Select an API to test
```

### Text Utilities

**Hash Text:**
```
Select text in editor
Cmd/Ctrl+Shift+P → "Toolbox: Generate Text Hash"
Choose algorithm (MD5, SHA-256, etc.)
Hash copied to clipboard!
```

**Convert JSON to CSV:**
```
Select JSON array in editor
Cmd/Ctrl+Shift+P → "Toolbox: Convert JSON to CSV"
CSV opens in new file
```

**Change Text Case:**
```
Select text
Cmd/Ctrl+Shift+P → "Toolbox: Convert Text Case"
Choose: camelCase, snake_case, kebab-case, etc.
```

### File Operations

**Hash a File:**
```
Cmd/Ctrl+Shift+P → "Toolbox: Generate File Hash"
Select file
Choose algorithm
Hash copied to clipboard!
```

**Extract Archive:**
```
Cmd/Ctrl+Shift+P → "Toolbox: Extract Archive"
Select .zip file
Files extracted to folder!
```

## 📚 All Commands

| Command | Description |
|---------|-------------|
| **Downloads** |
| `Toolbox: Download from URL` | Download file from URL |
| `Toolbox: Batch Download URLs` | Download multiple URLs at once |
| `Toolbox: Show Downloads` | View active downloads panel |
| `Toolbox: Test Download` | Try demo downloads |
| **API Testing** |
| `Toolbox: Test API` | Send HTTP request |
| `Toolbox: Detect APIs in File` | Find API calls in current file |
| **Text Utilities** |
| `Toolbox: Generate Text Hash` | Hash text (MD5, SHA-256, etc.) |
| `Toolbox: Encode Base64` | Encode text to Base64 |
| `Toolbox: Decode Base64` | Decode Base64 to text |
| `Toolbox: Encode URL` | URL-encode text |
| `Toolbox: Decode URL` | URL-decode text |
| `Toolbox: Format JSON` | Pretty-print JSON |
| `Toolbox: Minify JSON` | Compress JSON |
| `Toolbox: Convert JSON to CSV` | Convert JSON array to CSV |
| `Toolbox: Convert CSV to JSON` | Convert CSV to JSON |
| `Toolbox: Convert Text Case` | Change casing style |
| `Toolbox: Generate Lorem Ipsum` | Create placeholder text |
| **File Utilities** |
| `Toolbox: Generate File Hash` | Get file checksum |
| `Toolbox: Extract Archive` | Unzip files |
| `Toolbox: Create Archive` | Create ZIP file |
| **Quick Actions** |
| `Toolbox: Generate UUID` | Create unique ID |
| `Toolbox: Convert Timestamp to Date` | Unix timestamp → Date |
| `Toolbox: Convert Date to Timestamp` | Date → Unix timestamp |
| **Clipboard** |
| `Toolbox: Show Clipboard History` | View clipboard history |

## ⚙️ Configuration

```json
{
  "toolbox.downloads.autoExtractArchives": false,
  "toolbox.downloads.maxConcurrent": 3,
  "toolbox.clipboard.historySize": 50,
  "toolbox.clipboard.detectURLs": true,
  "toolbox.urlDetection.enableCodeLens": true
}
```

## 🎯 Features in Detail

### Smart Clipboard Manager
- Monitors clipboard automatically
- Detects URLs and shows download prompt
- Keeps history of last 50 items
- Pin important items to keep forever
- Search and filter history
- Re-copy previous items instantly

### API Tester
- Send any HTTP request without leaving VS Code
- Auto-detect API calls in your code
- Beautiful response viewer with JSON formatting
- Save request history
- Custom headers and authentication
- Perfect for testing backends during development

### Download Manager
- Real-time progress with speed tracking
- Multiple simultaneous downloads
- Works with SSH and remote files
- Right-click download from Explorer
- Auto-extract archives (optional)
- Clipboard URL detection

### Text & Data Converters
- Hash any text or file
- Encode/decode Base64, URL
- Format and minify JSON
- Convert between JSON, CSV, and more
- Case conversion for variable names
- Lorem Ipsum generator

## 🏗️ Architecture

```
├── src/
│   ├── extension.ts              # Main entry point
│   ├── downloadManager.ts        # Download handling
│   ├── fileTransferMonitor.ts    # SSH/remote file transfers
│   ├── clipboardManager.ts       # Clipboard monitoring & history
│   ├── clipboardTreeProvider.ts  # Clipboard history UI
│   ├── apiTester.ts              # API testing (Postman-like)
│   ├── textUtilities.ts          # Text processing utilities
│   ├── fileUtilities.ts          # File operations
│   ├── quickActions.ts           # Quick action providers
│   ├── downloadTreeProvider.ts   # Download sidebar UI
│   └── progressPanel.ts          # Download progress webview
├── resources/
│   └── toolbox.svg               # Extension icon
└── package.json                  # Extension manifest
```

## 🤝 Contributing

Contributions are welcome! Feel free to:
- Add new utilities
- Improve existing features
- Fix bugs
- Enhance documentation

## 📝 Changelog

### 2.0.0 - The Ultimate Toolbox Update
- 🎉 **Complete transformation** from download manager to full utility suite
- 🌐 **NEW: API Tester** - Postman-like HTTP request testing
- 📋 **NEW: Clipboard Manager** - automatic history with smart detection
- 🔤 **NEW: Text Utilities** - hashing, encoding, case conversion, and more
- 📁 **NEW: File Utilities** - archive extraction/creation, file hashing
- ⚡ **NEW: Quick Actions** - UUID generator, timestamp converter
- 📊 **NEW: Data Converters** - JSON/CSV conversion
- 🎨 **NEW: Beautiful sidebar** with categorized utilities
- 🔧 **Enhanced downloads** - batch downloads, clipboard URL detection
- 🚀 **30+ utilities** in one extension!

### 1.0.0
- Initial release with download progress tracking
- Right-click download support
- SSH/remote file integration

## 🎓 Use Cases

**For Web Developers:**
- Test your APIs without leaving VS Code
- Download dependencies and assets
- Convert data formats (JSON/CSV)
- Hash passwords and generate UUIDs

**For Backend Developers:**
- Test REST APIs during development
- Hash files and generate checksums
- Extract and create archives
- Convert timestamps

**For Data Scientists:**
- Download datasets with progress tracking
- Convert between JSON and CSV
- Generate sample data (Lorem Ipsum)
- Batch download multiple files

**For DevOps:**
- Download files from remote servers
- Hash files for verification
- Test API endpoints
- Archive and extract files

## 📄 License

MIT License - use it however you'd like!

## 🌟 Why Developer Toolbox?

- **All-in-one** - 30+ utilities in one extension
- **Native** - Built specifically for VS Code
- **Fast** - No need to switch to browser or external tools
- **Beautiful** - Modern UI with smooth animations
- **Free** - Completely open source

---

**Made with ❤️ for developers who love productivity!**

*Save time. Code more. Use Developer Toolbox.* 🚀
