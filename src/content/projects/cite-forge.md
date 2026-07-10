---
title: Cite Forge
summary: An interface for inspecting, renaming, reorganising, and checking every citation on a Wikimedia page.
year: '2025–'
category: wikipedia
order: 2
links:
  - label: Project page
    url: https://meta.wikimedia.org/wiki/Cite_Forge
  - label: Source code
    url: https://github.com/QZGao/CiteForge
---

Cite Forge adds a floating citation workbench directly to Wikipedia articles. It inventories the references on a page and makes them browsable through an alphabetical index and search filter. Editors can jump between a citation and its uses in the article, highlight those uses, and copy names or raw reference content without searching through an undifferentiated block of wikitext.

Editing operations are collected as pending changes rather than applied one at a time. The workbench can rename named or nameless references with conflict detection, deduplicate and normalise reference markup, move citations between inline and list-defined forms, sort reference lists, and generate names from bibliographic fields. A diff preview keeps these larger transformations reviewable before they are saved.

Cite Forge also extends WikiEditor with compact citation-insertion dialogs and Citoid-assisted metadata lookup. Its source checks identify CS1/CS2 style problems, broken Harvard citation links or targets, page-range anomalies, incomplete COinS metadata, and duplicate or sorting issues. Together, these tools make routine citation maintenance possible without leaving the article being edited.
