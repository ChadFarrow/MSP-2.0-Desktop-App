// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use argon2::{Argon2, password_hash::SaltString};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    XChaCha20Poly1305, XNonce,
};
use directories::ProjectDirs;
use nostr_sdk::prelude::*;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;
use zeroize::Zeroize;

/// Default Nostr relays for publishing and fetching events
const DEFAULT_RELAYS: &[&str] = &[
    "wss://relay.damus.io",
    "wss://relay.primal.net",
    "wss://nos.lol",
    "wss://relay.nostr.band",
];

// Store for the Nostr client and keys
struct NostrState {
    keys: Mutex<Option<Keys>>,
    client: Mutex<Option<Client>>,
}

#[derive(Serialize, Deserialize)]
struct NostrProfile {
    pubkey: String,
    npub: String,
}

#[derive(Serialize, Deserialize)]
struct SignedEvent {
    id: String,
    pubkey: String,
    created_at: u64,
    kind: u16,
    tags: Vec<Vec<String>>,
    content: String,
    sig: String,
}

// Local feed storage types
#[derive(Serialize, Deserialize, Clone)]
struct LocalFeed {
    id: String,
    title: String,
    feed_type: String, // "album" or "publisher"
    xml: String,
    created_at: u64,
    updated_at: u64,
}

#[derive(Serialize, Deserialize)]
struct FeedSummary {
    id: String,
    title: String,
    feed_type: String,
    created_at: u64,
    updated_at: u64,
}

// Encrypted key storage types
#[derive(Serialize, Deserialize, Clone)]
struct StoredKeyFile {
    version: u32,
    mode: String, // "password" or "device"
    nonce: String,
    ciphertext: String,
    argon2_salt: String,
    pubkey: String,
    created_at: u64,
}

#[derive(Serialize, Deserialize)]
struct StoredKeyInfo {
    exists: bool,
    mode: Option<String>,
    pubkey: Option<String>,
    created_at: Option<u64>,
}

// Constants for Argon2
const ARGON2_MEMORY_KB: u32 = 65536; // 64MB
const ARGON2_ITERATIONS: u32 = 3;
const ARGON2_PARALLELISM: u32 = 1;

// App-specific salt for device mode
const DEVICE_MODE_APP_SALT: &[u8] = b"msp-studio-device-key-v1";

/// Get the current Unix timestamp in seconds
fn get_current_timestamp() -> Result<u64, String> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())
        .map(|d| d.as_secs())
}

/// Normalize a server URL by removing trailing slashes
fn normalize_server_url(url: &str) -> &str {
    url.trim_end_matches('/')
}

/// Convert a nostr_sdk Event to our SignedEvent struct
fn event_to_signed_event(event: &Event) -> SignedEvent {
    SignedEvent {
        id: event.id.to_hex(),
        pubkey: event.pubkey.to_hex(),
        created_at: event.created_at.as_u64(),
        kind: event.kind.as_u16(),
        tags: event.tags.iter().map(|t| t.as_slice().to_vec()).collect(),
        content: event.content.to_string(),
        sig: event.sig.to_string(),
    }
}

/// Login helper that sets up the client with keys and connects to relays
async fn login_with_keys(keys: Keys, state: &NostrState) -> Result<NostrProfile, String> {
    let pubkey = keys.public_key().to_hex();
    let npub = keys.public_key().to_bech32().map_err(|e| e.to_string())?;

    let client = Client::new(keys.clone());

    for relay in DEFAULT_RELAYS {
        let _ = client.add_relay(*relay).await;
    }

    client.connect().await;

    *state.keys.lock().unwrap() = Some(keys);
    *state.client.lock().unwrap() = Some(client);

    Ok(NostrProfile { pubkey, npub })
}

/// Get the app data directory
fn get_data_dir() -> Result<PathBuf, String> {
    let proj_dirs = ProjectDirs::from("com", "podtards", "msp-studio")
        .ok_or("Could not determine app data directory")?;
    
    let data_dir = proj_dirs.data_dir().to_path_buf();
    
    // Create feeds subdirectory
    let feeds_dir = data_dir.join("feeds");
    fs::create_dir_all(&feeds_dir).map_err(|e| e.to_string())?;
    
    Ok(feeds_dir)
}

/// Save a feed locally
#[tauri::command]
fn save_feed_local(
    id: Option<String>,
    title: String,
    feed_type: String,
    xml: String,
) -> Result<LocalFeed, String> {
    let feeds_dir = get_data_dir()?;
    let now = get_current_timestamp()?;
    
    // Use existing ID or generate new one
    let feed_id = id.unwrap_or_else(|| Uuid::new_v4().to_string());
    
    // Check if updating existing feed
    let feed_path = feeds_dir.join(format!("{}.json", feed_id));
    let created_at = if feed_path.exists() {
        let existing: LocalFeed = serde_json::from_str(
            &fs::read_to_string(&feed_path).map_err(|e| e.to_string())?
        ).map_err(|e| e.to_string())?;
        existing.created_at
    } else {
        now
    };
    
    let feed = LocalFeed {
        id: feed_id.clone(),
        title,
        feed_type,
        xml,
        created_at,
        updated_at: now,
    };
    
    let json = serde_json::to_string_pretty(&feed).map_err(|e| e.to_string())?;
    fs::write(&feed_path, json).map_err(|e| e.to_string())?;
    
    Ok(feed)
}

/// Load a feed by ID
#[tauri::command]
fn load_feed_local(id: String) -> Result<LocalFeed, String> {
    let feeds_dir = get_data_dir()?;
    let feed_path = feeds_dir.join(format!("{}.json", id));
    
    if !feed_path.exists() {
        return Err(format!("Feed not found: {}", id));
    }
    
    let content = fs::read_to_string(&feed_path).map_err(|e| e.to_string())?;
    let feed: LocalFeed = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    
    Ok(feed)
}

/// List all local feeds
#[tauri::command]
fn list_feeds_local() -> Result<Vec<FeedSummary>, String> {
    let feeds_dir = get_data_dir()?;
    
    let mut feeds = Vec::new();
    
    let entries = fs::read_dir(&feeds_dir).map_err(|e| e.to_string())?;
    
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        
        if path.extension().map_or(false, |ext| ext == "json") {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(feed) = serde_json::from_str::<LocalFeed>(&content) {
                    feeds.push(FeedSummary {
                        id: feed.id,
                        title: feed.title,
                        feed_type: feed.feed_type,
                        created_at: feed.created_at,
                        updated_at: feed.updated_at,
                    });
                }
            }
        }
    }
    
    // Sort by updated_at descending (most recent first)
    feeds.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    
    Ok(feeds)
}

/// Delete a feed by ID
#[tauri::command]
fn delete_feed_local(id: String) -> Result<(), String> {
    let feeds_dir = get_data_dir()?;
    let feed_path = feeds_dir.join(format!("{}.json", id));
    
    if !feed_path.exists() {
        return Err(format!("Feed not found: {}", id));
    }
    
    fs::remove_file(&feed_path).map_err(|e| e.to_string())?;
    
    Ok(())
}

/// Export feed XML to a file (using native save dialog)
#[tauri::command]
fn get_feeds_directory() -> Result<String, String> {
    let feeds_dir = get_data_dir()?;
    Ok(feeds_dir.to_string_lossy().to_string())
}

// Blossom server types
#[derive(Serialize, Deserialize)]
struct BlossomUploadResult {
    url: String,
    sha256: String,
    size: usize,
}

/// Create a Blossom auth event (kind 24242)
fn create_blossom_auth(
    keys: &Keys,
    sha256: &str,
    action: &str,
    expiration_secs: u64,
) -> Result<Event, String> {
    let expiration = get_current_timestamp()? + expiration_secs;

    let event = EventBuilder::new(Kind::from(24242), "")
        .tag(Tag::parse(["t", action]).map_err(|e| e.to_string())?)
        .tag(Tag::parse(["x", sha256]).map_err(|e| e.to_string())?)
        .tag(Tag::parse(["expiration", &expiration.to_string()]).map_err(|e| e.to_string())?)
        .sign_with_keys(keys)
        .map_err(|e| e.to_string())?;

    Ok(event)
}

/// Upload content to a Blossom server
#[tauri::command]
async fn blossom_upload(
    server_url: String,
    content: String,
    content_type: Option<String>,
    state: State<'_, NostrState>,
) -> Result<BlossomUploadResult, String> {
    let keys = state
        .keys
        .lock()
        .unwrap()
        .clone()
        .ok_or("Not logged in - Nostr key required for Blossom upload")?;

    let content_bytes = content.as_bytes();
    let size = content_bytes.len();

    // Calculate SHA256
    let mut hasher = Sha256::new();
    hasher.update(content_bytes);
    let sha256 = hex::encode(hasher.finalize());

    // Create auth event (valid for 5 minutes)
    let auth_event = create_blossom_auth(&keys, &sha256, "upload", 300)?;
    let auth_json = serde_json::to_string(&auth_event).map_err(|e| e.to_string())?;
    let auth_base64 = base64_encode(&auth_json);

    // Determine content type
    let mime_type = content_type.unwrap_or_else(|| "application/xml".to_string());

    // Upload to Blossom server
    let client = reqwest::Client::new();
    let base_url = normalize_server_url(&server_url);
    let upload_url = format!("{}/upload", base_url);

    let response = client
        .put(&upload_url)
        .header("Authorization", format!("Nostr {}", auth_base64))
        .header("Content-Type", &mime_type)
        .body(content_bytes.to_vec())
        .send()
        .await
        .map_err(|e| format!("Upload failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Blossom server error {}: {}", status, error_text));
    }

    // Parse response to get URL
    let blob_url = format!("{}/{}", base_url, sha256);

    Ok(BlossomUploadResult {
        url: blob_url,
        sha256,
        size,
    })
}

/// Upload a file from disk to Blossom
#[tauri::command]
async fn blossom_upload_file(
    server_url: String,
    file_path: String,
    state: State<'_, NostrState>,
) -> Result<BlossomUploadResult, String> {
    let keys = state
        .keys
        .lock()
        .unwrap()
        .clone()
        .ok_or("Not logged in - Nostr key required for Blossom upload")?;

    // Read file
    let content_bytes = fs::read(&file_path).map_err(|e| format!("Failed to read file: {}", e))?;
    let size = content_bytes.len();

    // Calculate SHA256
    let mut hasher = Sha256::new();
    hasher.update(&content_bytes);
    let sha256 = hex::encode(hasher.finalize());

    // Create auth event
    let auth_event = create_blossom_auth(&keys, &sha256, "upload", 300)?;
    let auth_json = serde_json::to_string(&auth_event).map_err(|e| e.to_string())?;
    let auth_base64 = base64_encode(&auth_json);

    // Guess content type from extension
    let mime_type = match file_path.rsplit('.').next() {
        Some("xml") => "application/xml",
        Some("json") => "application/json",
        Some("mp3") => "audio/mpeg",
        Some("flac") => "audio/flac",
        Some("wav") => "audio/wav",
        Some("ogg") => "audio/ogg",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    };

    // Upload
    let client = reqwest::Client::new();
    let base_url = normalize_server_url(&server_url);
    let upload_url = format!("{}/upload", base_url);

    let response = client
        .put(&upload_url)
        .header("Authorization", format!("Nostr {}", auth_base64))
        .header("Content-Type", mime_type)
        .body(content_bytes)
        .send()
        .await
        .map_err(|e| format!("Upload failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Blossom server error {}: {}", status, error_text));
    }

    let blob_url = format!("{}/{}", base_url, sha256);

    Ok(BlossomUploadResult {
        url: blob_url,
        sha256,
        size,
    })
}

/// Delete a blob from a Blossom server
#[tauri::command]
async fn blossom_delete(
    server_url: String,
    sha256: String,
    state: State<'_, NostrState>,
) -> Result<(), String> {
    let keys = state
        .keys
        .lock()
        .unwrap()
        .clone()
        .ok_or("Not logged in")?;

    let auth_event = create_blossom_auth(&keys, &sha256, "delete", 300)?;
    let auth_json = serde_json::to_string(&auth_event).map_err(|e| e.to_string())?;
    let auth_base64 = base64_encode(&auth_json);

    let client = reqwest::Client::new();
    let delete_url = format!("{}/{}", normalize_server_url(&server_url), sha256);

    let response = client
        .delete(&delete_url)
        .header("Authorization", format!("Nostr {}", auth_base64))
        .send()
        .await
        .map_err(|e| format!("Delete failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Blossom server error {}: {}", status, error_text));
    }

    Ok(())
}

/// List blobs on a Blossom server for the logged-in user
#[tauri::command]
async fn blossom_list(
    server_url: String,
    state: State<'_, NostrState>,
) -> Result<Vec<serde_json::Value>, String> {
    let keys = state
        .keys
        .lock()
        .unwrap()
        .clone()
        .ok_or("Not logged in")?;

    let pubkey = keys.public_key().to_hex();

    let client = reqwest::Client::new();
    let list_url = format!("{}/list/{}", normalize_server_url(&server_url), pubkey);

    let response = client
        .get(&list_url)
        .send()
        .await
        .map_err(|e| format!("List failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Blossom server error {}: {}", status, error_text));
    }

    let blobs: Vec<serde_json::Value> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(blobs)
}

fn base64_encode(input: &str) -> String {
    use std::io::Write;
    let mut buf = Vec::new();
    {
        let mut encoder = base64_encoder(&mut buf);
        encoder.write_all(input.as_bytes()).unwrap();
    }
    String::from_utf8(buf).unwrap()
}

fn base64_encoder(writer: &mut Vec<u8>) -> impl std::io::Write + '_ {
    struct Base64Encoder<'a>(&'a mut Vec<u8>);
    
    impl<'a> std::io::Write for Base64Encoder<'a> {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
            
            for chunk in buf.chunks(3) {
                let b0 = chunk[0] as usize;
                let b1 = chunk.get(1).copied().unwrap_or(0) as usize;
                let b2 = chunk.get(2).copied().unwrap_or(0) as usize;
                
                self.0.push(ALPHABET[b0 >> 2]);
                self.0.push(ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)]);
                
                if chunk.len() > 1 {
                    self.0.push(ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)]);
                } else {
                    self.0.push(b'=');
                }
                
                if chunk.len() > 2 {
                    self.0.push(ALPHABET[b2 & 0x3f]);
                } else {
                    self.0.push(b'=');
                }
            }
            Ok(buf.len())
        }
        
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    
    Base64Encoder(writer)
}

/// Login with nsec (private key)
#[tauri::command]
async fn nostr_login_nsec(
    nsec: String,
    state: State<'_, NostrState>,
) -> Result<NostrProfile, String> {
    let secret_key = SecretKey::from_bech32(&nsec).map_err(|e| e.to_string())?;
    let keys = Keys::new(secret_key);
    login_with_keys(keys, &state).await
}

/// Login with hex private key
#[tauri::command]
async fn nostr_login_hex(
    hex_key: String,
    state: State<'_, NostrState>,
) -> Result<NostrProfile, String> {
    let secret_key = SecretKey::from_hex(&hex_key).map_err(|e| e.to_string())?;
    let keys = Keys::new(secret_key);
    login_with_keys(keys, &state).await
}

/// Logout - clear keys and disconnect
#[tauri::command]
async fn nostr_logout(state: State<'_, NostrState>) -> Result<(), String> {
    let client = state.client.lock().unwrap().take();
    if let Some(c) = client {
        let _ = c.disconnect().await;
    }
    *state.keys.lock().unwrap() = None;
    Ok(())
}

/// Get current login status
#[tauri::command]
fn nostr_get_pubkey(state: State<'_, NostrState>) -> Option<NostrProfile> {
    state.keys.lock().unwrap().as_ref().map(|keys| {
        NostrProfile {
            pubkey: keys.public_key().to_hex(),
            npub: keys.public_key().to_bech32().unwrap_or_default(),
        }
    })
}

/// Sign an event
#[tauri::command]
async fn nostr_sign_event(
    kind: u16,
    content: String,
    tags: Vec<Vec<String>>,
    state: State<'_, NostrState>,
) -> Result<SignedEvent, String> {
    let keys = state
        .keys
        .lock()
        .unwrap()
        .clone()
        .ok_or("Not logged in")?;
    
    let kind = Kind::from(kind);
    
    let mut builder = EventBuilder::new(kind, &content);
    
    for tag in &tags {
        if !tag.is_empty() {
            let tag = Tag::parse(tag).map_err(|e| e.to_string())?;
            builder = builder.tag(tag);
        }
    }
    
    let event = builder.sign_with_keys(&keys).map_err(|e| e.to_string())?;

    Ok(event_to_signed_event(&event))
}

/// Publish an event to relays
#[tauri::command]
async fn nostr_publish_event(
    kind: u16,
    content: String,
    tags: Vec<Vec<String>>,
    state: State<'_, NostrState>,
) -> Result<String, String> {
    let keys = state
        .keys
        .lock()
        .unwrap()
        .clone()
        .ok_or("Not logged in")?;
    
    let client = state
        .client
        .lock()
        .unwrap()
        .clone()
        .ok_or("Client not initialized")?;
    
    let kind = Kind::from(kind);
    
    let mut builder = EventBuilder::new(kind, &content);
    
    for tag in &tags {
        if !tag.is_empty() {
            let tag = Tag::parse(tag).map_err(|e| e.to_string())?;
            builder = builder.tag(tag);
        }
    }
    
    let event = builder.sign_with_keys(&keys).map_err(|e| e.to_string())?;
    let event_id = event.id.to_hex();
    
    client
        .send_event(event)
        .await
        .map_err(|e| e.to_string())?;
    
    Ok(event_id)
}

/// Fetch events from relays
#[tauri::command]
async fn nostr_fetch_events(
    kinds: Vec<u16>,
    authors: Option<Vec<String>>,
    limit: Option<usize>,
    state: State<'_, NostrState>,
) -> Result<Vec<SignedEvent>, String> {
    let client = state
        .client
        .lock()
        .unwrap()
        .clone()
        .ok_or("Client not initialized")?;
    
    let kinds: Vec<Kind> = kinds.into_iter().map(Kind::from).collect();
    
    let mut filter = Filter::new().kinds(kinds);
    
    if let Some(authors) = authors {
        let pubkeys: Result<Vec<PublicKey>, _> = authors
            .iter()
            .map(|a| PublicKey::from_hex(a))
            .collect();
        filter = filter.authors(pubkeys.map_err(|e| e.to_string())?);
    }
    
    if let Some(limit) = limit {
        filter = filter.limit(limit);
    }
    
    let events = client
        .fetch_events(vec![filter], None)
        .await
        .map_err(|e| e.to_string())?;

    Ok(events.iter().map(event_to_signed_event).collect())
}

// ============================================================================
// Encrypted Key Storage
// ============================================================================

/// Get the keystore file path
fn get_keystore_path() -> Result<PathBuf, String> {
    let proj_dirs = ProjectDirs::from("com", "podtards", "msp-studio")
        .ok_or("Could not determine app data directory")?;

    let data_dir = proj_dirs.data_dir();
    fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;

    Ok(data_dir.join("keystore.json"))
}

/// Derive encryption key from password using Argon2id
fn derive_key_from_password(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let argon2 = Argon2::new(
        argon2::Algorithm::Argon2id,
        argon2::Version::V0x13,
        argon2::Params::new(ARGON2_MEMORY_KB, ARGON2_ITERATIONS, ARGON2_PARALLELISM, Some(32))
            .map_err(|e| e.to_string())?,
    );

    let mut key = [0u8; 32];
    argon2
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| format!("Key derivation failed: {}", e))?;

    Ok(key)
}

/// Derive encryption key from device ID (for passwordless mode)
fn derive_key_from_device() -> Result<[u8; 32], String> {
    let machine_id = machine_uid::get().map_err(|e| format!("Failed to get machine ID: {}", e))?;

    // Combine machine ID with app salt
    let mut combined = Vec::new();
    combined.extend_from_slice(machine_id.as_bytes());
    combined.extend_from_slice(DEVICE_MODE_APP_SALT);

    // Use SHA256 as salt for Argon2
    let mut hasher = Sha256::new();
    hasher.update(&combined);
    let salt = hasher.finalize();

    derive_key_from_password(&machine_id, &salt[..16])
}

/// Encrypt nsec with the given key
fn encrypt_nsec(nsec: &str, key: &[u8; 32]) -> Result<(String, String), String> {
    let cipher = XChaCha20Poly1305::new_from_slice(key)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;

    // Generate random nonce
    let mut nonce_bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = XNonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, nsec.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    Ok((
        BASE64.encode(nonce_bytes),
        BASE64.encode(ciphertext),
    ))
}

/// Decrypt nsec with the given key
fn decrypt_nsec(nonce_b64: &str, ciphertext_b64: &str, key: &[u8; 32]) -> Result<String, String> {
    let cipher = XChaCha20Poly1305::new_from_slice(key)
        .map_err(|e| format!("Failed to create cipher: {}", e))?;

    let nonce_bytes = BASE64
        .decode(nonce_b64)
        .map_err(|e| format!("Invalid nonce: {}", e))?;

    if nonce_bytes.len() != 24 {
        return Err("Invalid nonce length".to_string());
    }

    let nonce = XNonce::from_slice(&nonce_bytes);

    let ciphertext = BASE64
        .decode(ciphertext_b64)
        .map_err(|e| format!("Invalid ciphertext: {}", e))?;

    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_slice())
        .map_err(|_| "Decryption failed - incorrect password or corrupted data".to_string())?;

    String::from_utf8(plaintext).map_err(|e| format!("Invalid UTF-8: {}", e))
}

/// Set restrictive file permissions on Unix
#[cfg(unix)]
fn set_file_permissions(path: &PathBuf) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let permissions = std::fs::Permissions::from_mode(0o600);
    fs::set_permissions(path, permissions).map_err(|e| e.to_string())
}

#[cfg(not(unix))]
fn set_file_permissions(_path: &PathBuf) -> Result<(), String> {
    // Windows doesn't use Unix-style permissions
    Ok(())
}

/// Check if a stored key exists and return its info
#[tauri::command]
fn check_stored_key() -> Result<StoredKeyInfo, String> {
    let keystore_path = get_keystore_path()?;

    if !keystore_path.exists() {
        return Ok(StoredKeyInfo {
            exists: false,
            mode: None,
            pubkey: None,
            created_at: None,
        });
    }

    let content = fs::read_to_string(&keystore_path).map_err(|e| e.to_string())?;
    let stored: StoredKeyFile = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    Ok(StoredKeyInfo {
        exists: true,
        mode: Some(stored.mode),
        pubkey: Some(stored.pubkey),
        created_at: Some(stored.created_at),
    })
}

/// Store key with password protection
#[tauri::command]
fn store_key_with_password(nsec: String, password: String) -> Result<(), String> {
    if password.is_empty() {
        return Err("Password cannot be empty".to_string());
    }

    // Validate nsec and get pubkey
    let secret_key = SecretKey::from_bech32(&nsec).map_err(|e| e.to_string())?;
    let keys = Keys::new(secret_key);
    let pubkey = keys.public_key().to_hex();

    // Generate salt
    let salt = SaltString::generate(&mut rand::thread_rng());
    let salt_str = salt.as_str();

    // Derive key and encrypt
    let mut encryption_key = derive_key_from_password(&password, salt_str.as_bytes())?;
    let (nonce, ciphertext) = encrypt_nsec(&nsec, &encryption_key)?;

    // Zeroize sensitive data
    encryption_key.zeroize();

    let stored = StoredKeyFile {
        version: 1,
        mode: "password".to_string(),
        nonce,
        ciphertext,
        argon2_salt: salt.to_string(),
        pubkey,
        created_at: get_current_timestamp()?,
    };

    let keystore_path = get_keystore_path()?;
    let json = serde_json::to_string_pretty(&stored).map_err(|e| e.to_string())?;
    fs::write(&keystore_path, json).map_err(|e| e.to_string())?;
    set_file_permissions(&keystore_path)?;

    Ok(())
}

/// Store key with device-only protection (passwordless)
#[tauri::command]
fn store_key_without_password(nsec: String) -> Result<(), String> {
    // Validate nsec and get pubkey
    let secret_key = SecretKey::from_bech32(&nsec).map_err(|e| e.to_string())?;
    let keys = Keys::new(secret_key);
    let pubkey = keys.public_key().to_hex();

    // Derive key from device ID
    let mut encryption_key = derive_key_from_device()?;
    let (nonce, ciphertext) = encrypt_nsec(&nsec, &encryption_key)?;

    // Zeroize sensitive data
    encryption_key.zeroize();

    let stored = StoredKeyFile {
        version: 1,
        mode: "device".to_string(),
        nonce,
        ciphertext,
        argon2_salt: String::new(), // Not used for device mode
        pubkey,
        created_at: get_current_timestamp()?,
    };

    let keystore_path = get_keystore_path()?;
    let json = serde_json::to_string_pretty(&stored).map_err(|e| e.to_string())?;
    fs::write(&keystore_path, json).map_err(|e| e.to_string())?;
    set_file_permissions(&keystore_path)?;

    Ok(())
}

/// Unlock stored key and login
#[tauri::command]
async fn unlock_stored_key(
    password: Option<String>,
    state: State<'_, NostrState>,
) -> Result<NostrProfile, String> {
    let keystore_path = get_keystore_path()?;

    if !keystore_path.exists() {
        return Err("No stored key found".to_string());
    }

    let content = fs::read_to_string(&keystore_path).map_err(|e| e.to_string())?;
    let stored: StoredKeyFile = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    // Derive decryption key based on mode
    let mut decryption_key = match stored.mode.as_str() {
        "password" => {
            let password = password.ok_or("Password required for this key")?;
            derive_key_from_password(&password, stored.argon2_salt.as_bytes())?
        }
        "device" => derive_key_from_device()?,
        _ => return Err(format!("Unknown storage mode: {}", stored.mode)),
    };

    // Decrypt nsec
    let mut nsec = decrypt_nsec(&stored.nonce, &stored.ciphertext, &decryption_key)?;
    decryption_key.zeroize();

    // Parse and login
    let secret_key = SecretKey::from_bech32(&nsec).map_err(|e| e.to_string())?;
    nsec.zeroize();

    let keys = Keys::new(secret_key);

    // Verify pubkey matches
    let pubkey = keys.public_key().to_hex();
    if pubkey != stored.pubkey {
        return Err("Key verification failed - pubkey mismatch".to_string());
    }

    login_with_keys(keys, &state).await
}

/// Clear stored key
#[tauri::command]
fn clear_stored_key() -> Result<(), String> {
    let keystore_path = get_keystore_path()?;

    if keystore_path.exists() {
        fs::remove_file(&keystore_path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Change key password or protection mode
#[tauri::command]
fn change_key_password(
    current_password: Option<String>,
    new_password: Option<String>,
) -> Result<(), String> {
    let keystore_path = get_keystore_path()?;

    if !keystore_path.exists() {
        return Err("No stored key found".to_string());
    }

    let content = fs::read_to_string(&keystore_path).map_err(|e| e.to_string())?;
    let stored: StoredKeyFile = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    // Decrypt with current credentials
    let mut decryption_key = match stored.mode.as_str() {
        "password" => {
            let password = current_password.ok_or("Current password required")?;
            derive_key_from_password(&password, stored.argon2_salt.as_bytes())?
        }
        "device" => derive_key_from_device()?,
        _ => return Err(format!("Unknown storage mode: {}", stored.mode)),
    };

    let mut nsec = decrypt_nsec(&stored.nonce, &stored.ciphertext, &decryption_key)?;
    decryption_key.zeroize();

    // Re-encrypt with new credentials
    match new_password {
        Some(password) if !password.is_empty() => {
            store_key_with_password(nsec.clone(), password)?;
        }
        _ => {
            store_key_without_password(nsec.clone())?;
        }
    }

    nsec.zeroize();
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(NostrState {
            keys: Mutex::new(None),
            client: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            nostr_login_nsec,
            nostr_login_hex,
            nostr_logout,
            nostr_get_pubkey,
            nostr_sign_event,
            nostr_publish_event,
            nostr_fetch_events,
            save_feed_local,
            load_feed_local,
            list_feeds_local,
            delete_feed_local,
            get_feeds_directory,
            blossom_upload,
            blossom_upload_file,
            blossom_delete,
            blossom_list,
            check_stored_key,
            store_key_with_password,
            store_key_without_password,
            unlock_stored_key,
            clear_stored_key,
            change_key_password,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
