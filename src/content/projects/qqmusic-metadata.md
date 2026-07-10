---
title: QQ Music metadata explorer
summary: Inspect public song, album, artist, and lyric metadata from QQ Music through a small research-oriented interface.
year: 2024
status: maintained
kind: web utility
order: 8
featured: false
route: /projects/qqmusic-metadata/
tags:
  - metadata
  - lyrics
  - Cloudflare Workers
---

The metadata explorer exposes a small, explicit subset of QQ Music's public catalogue responses. It is useful for inspecting identifiers and exporting album or lyric metadata while keeping the upstream API boundary isolated in a dedicated Worker.
