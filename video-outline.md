# MSP 2.0 - Overview Video Outline (Beginner)

**Target audience:** Brand new user, never seen the app before
**Tone:** Simple, welcoming, no jargon
**Skip for now:** Nostr login, MSP hosting, Blossom, Publisher mode

---

## 1. Intro (15-20 sec)
- "This is MSP 2.0 - Music Side Project Studio"
- "It's a free tool that turns your music into a Podcasting 2.0 RSS feed — so listeners can stream your album in any podcast app and pay you directly with Bitcoin"
- Quick flash of the app open with a completed feed

## 2. Installing the App (40-50 sec)
- "MSP 2.0 is available for Mac, Windows, and Linux — all free to download"
- "Head to the GitHub releases page to grab the latest version"
- Show: navigating to **github.com/ChadFarrow/MSP-2.0-Desktop-App/releases/latest**

### macOS (15 sec)
- Download the `.dmg` file — **Apple Silicon** (M1/M2/M3/M4) or **Intel**, pick the one that matches your Mac
- Open the DMG and drag MSP Studio into your Applications folder
- First launch: right-click (or Control-click) the app and select **Open** — "macOS will warn you because the app isn't from the App Store, but it's safe — just click Open"
- Show the app launching successfully

### Windows (10 sec)
- Download the `.msi` installer (recommended) or the `.exe`
- Double-click to run the setup — "it may install a small browser component called WebView2 if you don't already have it"
- Show the app launching from the Start menu

### Linux (15 sec)
- Three options depending on your distro:
  - **Ubuntu/Debian:** download the `.deb` and install with `sudo dpkg -i msp-studio_*.deb`
  - **Fedora/RHEL:** download the `.rpm` and install with `sudo rpm -i msp-studio_*.rpm`
  - **Any distro:** download the `.AppImage`, make it executable (`chmod +x`), and run it directly
- "Once it's installed, the app will automatically check for updates whenever you open it — no need to come back to this page"

## 3. The Big Picture (15 sec)
- "Here's what we're doing: filling in your album info, adding your tracks, and getting an RSS feed you can share anywhere"
- Point out the three main areas: header, editor sections, and the menu button

## 4. Album Info (30-40 sec)
- Start fresh — the app opens with a blank album form
- Fill in: **Artist/Band name**, **Album Title**, **Description**
- Note that Language defaults to English
- GUID is auto-generated — "you don't need to touch this"
- Optionally add keywords, website, owner name/email
- Keep it moving — "the required fields are marked with an asterisk"

## 5. Album Artwork (15 sec)
- Paste an image URL into the Album Art field
- Show the live preview appearing below the field
- "That's what listeners will see in their podcast app"

## 6. Credits (20 sec)
- Click + Add Person
- Type a name, optionally add a photo URL (show the thumbnail preview)
- Add a role — pick a Group (e.g., Music) then a Role (e.g., Vocalist, Guitarist)
- "Add as many people and roles as you want"
- Briefly mention the "View All Roles" button for the full list

## 7. Value Block — Get Paid in Bitcoin (30 sec)
- "This is the cool part — Value 4 Value"
- Click + Add Recipient
- Type your Lightning address (e.g., `you@getalby.com`)
- Set a split percentage
- Show community support recipients auto-appearing: "These support the tools that make this possible — MSP 2.0 and Podcast Index. They're optional, you can remove them"
- "When someone listens in a V4V podcast app, sats flow to everyone listed here"

## 8. Adding Tracks (40-50 sec)
- Click + Add Track
- Enter the **Track Title**
- Paste the **MP3 URL** — show the duration auto-filling
- Point out the inline audio player that appears: "You can preview it right here"
- Optionally add: track artwork, description, lyrics URL, pub date
- Show the collapse/expand toggle — "keeps things tidy when you have a lot of tracks"
- Add a second track quickly to show the flow
- Mention track reordering via the track number field

## 9. Preview Your Feed (15 sec)
- Click menu > **View Feed**
- Show the syntax-highlighted XML preview
- "This is your Podcasting 2.0 RSS feed — all the standard tags are generated for you"
- Close the preview

## 10. Saving & Exporting (30 sec)
- Click menu > **Save**
- Walk through the simple options:
  - **Save to Computer** (desktop) — "saves locally so you can come back to it"
  - **Download XML** — "gives you the file to upload to your own server or hosting"
  - **Copy to Clipboard** — "paste it wherever you need"
- "Once your feed XML is hosted at a public URL, you can submit it to Podcast Index and it'll show up in podcast apps"
- Skip the advanced save options for this video

## 11. Feed Sidebar — Managing Your Feeds (15 sec)
- Click the sidebar toggle in the header
- Show saved feeds listed with title, type badge, and timestamp
- Click a feed to load it back up
- "All your feeds are saved right here on your computer"

## 12. Importing a Feed (15 sec)
- Menu > **Import**
- Show: Upload an XML file, paste XML, or fetch from a URL
- "If you already have a feed, you can bring it right in"

## 13. Wrap-up (10 sec)
- "That's MSP 2.0 — fill in your info, add your tracks, set up Lightning payments, and you've got a podcast feed for your music"
- "In the next video we'll cover hosting your feed and syncing with Nostr"

---

**Estimated total runtime:** ~5 minutes
