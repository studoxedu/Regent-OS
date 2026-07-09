# Regent OS — Desktop Build

Two desktop wrappers are scaffolded. Pick one.

## Option A: Electron (recommended — no native toolchain needed)

```
npm install
npm run electron:dev      # dev mode, hot reload
npm run electron:build    # production build for your current OS
npm run electron:build:win   # Windows .exe (NSIS installer)
npm run electron:build:mac   # macOS .dmg
npm run electron:build:linux # Linux AppImage
```

Output lands in `release/`.

## Option B: Tauri (smaller binary, ~10MB vs Electron's ~150MB)

Requires Rust + a working native toolchain:
- Windows: Visual Studio Build Tools (C++ workload) — generates a real MSVC toolchain,
  or use the GNU target with a full MinGW-w64 install (WinLibs build).
- macOS: Xcode Command Line Tools (`xcode-select --install`).
- Linux: `webkit2gtk`, `libgtk-3-dev`, build-essential (see Tauri prerequisites docs).

```
rustup target add x86_64-pc-windows-msvc   # or your platform's target
npm install
npm run tauri:dev
npm run tauri:build
```

Output lands in `src-tauri/target/release/bundle/`.

### Icons
`src-tauri/icons/icon.icns` is currently a placeholder PNG, not a real .icns.
Replace it with a real macOS icon if you're building for Mac
(e.g. via `iconutil` or https://cloudconvert.com/png-to-icns).

## Which to choose
- Want it working today with zero build-toolchain pain → **Electron**.
- Want a small, fast binary and are willing to fix the Rust/MSVC toolchain → **Tauri**.
