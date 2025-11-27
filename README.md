# 🍌 Gentle Page PDF

A Chrome browser extension that transforms PDF pages into a comfortable, paper-like reading experience with customizable themes. Perfect for reducing eye strain while reading PDFs online.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=google-chrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-4285F4?logo=google-chrome&logoColor=white)

## ✨ Features

- 🎨 **Paper-like Texture**: Converts PDF backgrounds to a warm, paper-like appearance
- 🌓 **Light & Dark Themes**: Choose between light and dark modes for comfortable reading
- 👁️ **Eye-Friendly**: Reduces eye strain with carefully tuned color filters
- 🖼️ **Image Preservation**: Attempts to preserve images while transforming text backgrounds
- ⚡ **Easy Toggle**: Simple on/off switch to enable or disable the effect
- 💾 **Persistent Settings**: Your preferences are saved and synced across devices

## 🚀 Installation

### Method 1: Load Unpacked Extension (Development)

1. **Clone or download this repository**
   ```bash
   git clone <repository-url>
   cd gentle-page-pdf
   ```

2. **Open Chrome Extensions Page**
   - Open Google Chrome
   - Navigate to `chrome://extensions/`
   - Or go to Menu (⋮) → Extensions → Manage Extensions

3. **Enable Developer Mode**
   - Toggle the "Developer mode" switch in the top-right corner

4. **Load the Extension**
   - Click "Load unpacked"
   - Select the `gentle-page-pdf` folder
   - The extension should now appear in your extensions list

5. **Pin the Extension (Optional)**
   - Click the puzzle piece icon (🧩) in Chrome's toolbar
   - Find "Banana Gentle PDF Color Changer"
   - Click the pin icon to keep it visible

## 📖 How to Use

1. **Open a PDF** in Chrome (any PDF URL or local file)

2. **Click the Extension Icon** in your toolbar

3. **Toggle the Extension**
   - Use the "Enable" switch to turn the effect on/off
   - The changes apply immediately to the current PDF

4. **Choose a Theme**
   - Click "Light" for a warm, paper-like appearance
   - Click "Dark" for an inverted dark mode experience

5. **Enjoy Reading!** 📚
   - The PDF background will transform to a comfortable reading experience
   - Your settings are automatically saved

## 🎯 What It Does

### Light Mode
- Applies a warm, cream-colored paper texture overlay
- Uses multiply blend mode to create a natural paper effect
- Adjusts contrast and brightness for optimal readability
- Preserves text sharpness while softening the harsh white background

### Dark Mode
- Inverts colors using SVG color matrix filters
- Maps white backgrounds to dark charcoal
- Maps black text to light cream
- Adds subtle texture for a natural feel

### Technical Implementation
- Uses CSS filters and SVG color matrices for color transformation
- Applies overlay textures using CSS blend modes
- Works with Chrome's built-in PDF viewer
- Content script runs on all pages to detect PDFs automatically

## 📁 Project Structure

```
gentle-page-pdf/
├── manifest.json       # Extension manifest (Manifest V3)
├── popup.html          # Extension popup UI
├── popup.js            # Popup logic and settings management
├── popup.css           # Popup styling
├── content.js          # Content script (runs on web pages)
├── background.js       # Service worker (background script)
├── styles.css          # PDF transformation styles
└── images/             # Extension icons and logo
    ├── icon16.png
    ├── icon48.png
    ├── icon128.png
    └── logo.png
```

## 🔧 Requirements

- **Google Chrome** (or Chromium-based browser)
- **Manifest V3** support (Chrome 88+)

## 🛠️ Development

### Permissions Used
- `activeTab`: Access to the currently active tab
- `scripting`: Inject content scripts
- `storage`: Save user preferences
- `<all_urls>`: Detect PDFs on any website

### How It Works

1. **Content Script** (`content.js`): Detects PDF pages and applies CSS classes
2. **Popup** (`popup.js`): Manages user settings via Chrome Storage API
3. **Background** (`background.js`): Initializes default settings on install
4. **Styles** (`styles.css`): Contains the visual transformations for PDFs

## 🐛 Troubleshooting

**Extension not working?**
- Make sure the extension is enabled in `chrome://extensions/`
- Refresh the PDF page after enabling the extension
- Check that you're viewing a PDF (not a downloaded file opened in another app)

**Settings not saving?**
- Ensure you're signed into Chrome (for sync to work)
- Check Chrome's storage permissions

**PDF looks strange?**
- Try toggling the extension off and on
- Switch between light and dark themes
- Some PDFs with complex layouts may render differently

## 📝 License

This project is open source. Feel free to use, modify, and distribute.

## 👨‍💻 Author

Created by [kabir0st](https://kabir0st.info/) 🚀

---

**Enjoy comfortable PDF reading!** 📖✨

