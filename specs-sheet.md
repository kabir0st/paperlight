## 📋 **Key Sections:**

### **1. Color Palette**
- **Light Mode**: Paper gray background (`#f5f4f0`) + pencil smooth gray text (`#2c2c2c`)
- **Dark Mode**: Deep charcoal (`#1a1a1a`) + soft cream white text (`#e8e8e8`)
- All colors are WCAG AA compliant for accessibility

### **2. Technical Architecture**
- Manifest V3 configuration (current Chrome standard)
- Content scripts for PDF DOM manipulation
- Service worker for background tasks
- Popup UI for mode switching

### **3. Image Preservation Strategy** (Critical!)
- CSS filter exclusion method (recommended)
- DOM traversal tagging approach
- MutationObserver for dynamic content
- Guarantees images stay unmodified while text gets transformed

### **4. Intelligent Color Transformation Algorithm**
- Automatic color detection and conversion
- Brightness-based text classification
- HSL color space manipulation for smooth transitions
- Handles hex, RGB, RGBA, and named colors

### **5. Performance Optimizations**
- Debouncing & throttling for DOM operations
- Lazy loading strategy
- Memory management techniques
- Target: < 200ms load time

### **6. State Management**
- Per-domain override capability
- Auto-detect system theme support

### **7. Testing & Deployment**
- Complete testing checklist (unit, integration, accessibility)
- Debugging solutions for common issues

***

## 🎯 **Quick Start Path:**

1.  Setup Manifest V3 project + core color transformation
2.  Image preservation logic + DOM handling  
3.  Popup UI + keyboard shortcuts
4.  Testing, optimization, deployment

***

The specs sheet is designed specifically for **your advanced level**—it assumes you're comfortable with JavaScript, DOM manipulation, and browser APIs. The no-framework approach keeps it lightweight and gives you full control.

Want me to help you start building? I can create:
- The initial project scaffold with manifest.json
- The core color transformation algorithm
- The popup UI component
- Any specific module you want to tackle first

What's your next move? 🚀

[1](https://chromewebstore.google.com/detail/pdf-dark-mode/kaijaihmnjofnocmpcgaipllhibjafll)
[2](https://dev.to/anobjectisa/how-to-build-a-chrome-extension-new-manifest-v3-5edk)
[3](https://github.com/ArshSB/DarkPDF)
[4](https://www.reddit.com/r/chrome/comments/1jd0gmt/how_to_change_the_background_color_in_the_builtin/)
[5](https://www.freecodecamp.org/news/how-to-build-a-chrome-extension-using-javascript-and-manifest-v3/)
[6](https://www.shadowreader.io/blog/dark-mode-for-pdfs-on-chrome)
[7](https://stackoverflow.com/questions/40639705/is-there-a-way-to-style-google-chrome-default-pdf-viewer)
[8](https://www.youtube.com/watch?v=RUVgd98DXxM)
[9](https://chromewebstore.google.com/detail/dark-reader/eimadpbcbfnmbkopoojfekhnkhdbieeh?hl=en)
[10](https://chromewebstore.google.com/detail/color-changer/nmdgidofjbajhphomaniiekgckpioifp)
[11](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts)
[12](https://chromewebstore.google.com/detail/pdf-dark-theme/dhhcfpbikhlkoicblakagcmfpnnkhkpl?hl=en)
[13](https://community.adobe.com/t5/acrobat-discussions/black-text-showing-up-as-white/td-p/13879760)
[14](https://stackoverflow.com/questions/74465855/how-to-work-around-the-impossibility-of-accessing-the-dom-in-a-chrome-extension)
[15](https://community.brave.app/t/dark-reader-extension-doesnt-work-in-local-files-and-in-chrome-web-store/269990)
[16](https://www.wps.ai/blog/9-useful-pdf-reader-extensions-for-chrome-firefox-and-more/)
[17](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/veJy9uAwS00/m/9iKaX5giAQAJ)
[18](https://www.reddit.com/r/browsers/comments/1llfzvc/browser_pdf_readers_suck_so_i_built_a_dark_mode/)
[19](https://www.slashgear.com/1606353/chrome-extensions-every-student-should-have/)
[20](https://developer.chrome.com/docs/extensions/reference/api)