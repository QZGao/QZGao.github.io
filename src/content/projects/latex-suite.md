---
title: LaTeX Suite
summary: A lightweight desktop application for fast LaTeX composition on Windows and macOS.
year: '2026–'
category: toolkit
order: 4
links:
  - label: GitHub repository
    url: https://github.com/QZGao/latex-suite-app
---

LaTeX Suite is a lightweight Electron desktop companion for composing mathematical notation on Windows and macOS. Its editor is built on a CodeMirror 6 extension derived from [Obsidian LaTeX Suite](https://github.com/artisticat1/obsidian-latex-suite) (developed by artisticat), combining snippet-driven input with a live preview in a small, focused window rather than a full integrated development environment.

The application can be opened from anywhere with a global hotkey. In insert mode it sends the completed formula to the active application at the cursor; selection-replace modes first capture existing text as context, then replace that selection with the edited formula. This makes the same composition workflow available in documents, messages, browsers, and other software.

LaTeX Suite is distributed as both portable and installed builds on Windows and as DMG or ZIP builds on macOS. Launch mode and shortcut settings live in the system tray, while user-defined snippet rules allow the input language to be adapted to individual notation and frequently used expressions.

You can read more about why I built LaTeX Suite and how I developed it in my [blog post](https://quinn.supergrey.uk/why-i-built-latex-suite/).
