import { describe, it, expect } from 'vitest';
import { cleanReleaseNotes } from './updater';

const FULL_RELEASE_BODY = `## MSP Studio Desktop Release

### Downloads
| OS | File | Notes |
|----|------|-------|
| **Windows** | \`.msi\` | Recommended |
| **Windows** | \`.exe\` | Alternative installer |
| **macOS (Apple Silicon)** | \`_aarch64.dmg\` | M1/M2/M3/M4 |
| **macOS (Intel)** | \`_x64.dmg\` | |
| **Linux (Debian/Ubuntu)** | \`.deb\` | \`sudo dpkg -i <file>\` |
| **Linux (Fedora/RHEL)** | \`.rpm\` | |
| **Linux (Universal)** | \`.AppImage\` | Works on any distro |

> The \`.sig\`, \`.tar.gz\`, and \`latest.json\` files are for auto-updates — you can ignore them.

### macOS Users
This app is not signed with an Apple Developer certificate. To open it:
1. **Right-click** (or Control-click) the app
2. Select **Open** from the menu
3. Click **Open** in the dialog that appears

Or run this in Terminal after mounting the DMG:
\`\`\`bash
xattr -cr /Applications/MSP\\ Studio.app
\`\`\`

### Linux Users
You may need to install webkit2gtk:
\`\`\`bash
sudo apt install libwebkit2gtk-4.1-0
\`\`\``;

describe('cleanReleaseNotes', () => {
  it('returns null for body with only install instructions', () => {
    expect(cleanReleaseNotes(FULL_RELEASE_BODY)).toBeNull();
  });

  it('preserves actual changelog content', () => {
    const bodyWithChangelog = `## MSP Studio Desktop Release

### What's New
- Added dark mode support
- Fixed bug with feed parsing

### Downloads
| OS | File | Notes |
|----|------|-------|
| **Windows** | \`.msi\` | Recommended |

> The \`.sig\`, \`.tar.gz\`, and \`latest.json\` files are for auto-updates — you can ignore them.

### macOS Users
This app is not signed with an Apple Developer certificate.

### Linux Users
You may need to install webkit2gtk.`;

    const result = cleanReleaseNotes(bodyWithChangelog);
    expect(result).toContain("What's New");
    expect(result).toContain('dark mode support');
    expect(result).toContain('feed parsing');
    expect(result).not.toContain('Downloads');
    expect(result).not.toContain('macOS Users');
    expect(result).not.toContain('Linux Users');
    expect(result).not.toContain('.sig');
  });

  it('returns null for empty string', () => {
    expect(cleanReleaseNotes('')).toBeNull();
  });

  it('returns null for only the header', () => {
    expect(cleanReleaseNotes('## MSP Studio Desktop Release')).toBeNull();
  });

  it('preserves content when no install sections present', () => {
    const simpleBody = '### Bug Fixes\n- Fixed crash on startup';
    const result = cleanReleaseNotes(simpleBody);
    expect(result).toBe(simpleBody);
  });
});
