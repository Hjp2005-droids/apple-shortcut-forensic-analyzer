# Apple Shortcut Forensic Analyzer (Netlify starter)

## What this version does
- Static Netlify site; no server or account needed.
- Processes selected files in the browser and does not upload them.
- Records byte size, SHA-256, first bytes and format signature.
- Parses JSON and XML plist exports that contain `WFWorkflowActions` (or an `actions` array).
- Produces a Markdown report and JSON download with ordered action dictionaries and raw parameters.
- Detects modern signed `.shortcut` containers (`AEA1`) and reports their header metadata without falsely claiming it extracted the workflow.

## Important limitation
Modern signed Apple Shortcuts files commonly use an `AEA1` signed container wrapping an Apple Archive containing `Shortcut.wflow`, a binary plist. This starter **does not yet unpack AEA1 or decode binary plists**. For full signed-file extraction, implement and test a decoder that supports AEA profile 0, signature verification, Apple Archive extraction, and binary plist parsing. Do not simply scan for `bplist` and assume the result is a valid workflow: the inner archive format must be parsed correctly.

## Deploy to Netlify
1. Extract the ZIP.
2. Put the folder in a GitHub repository, or drag the folder into Netlify's manual deploy area.
3. Netlify uses `netlify.toml`; publish directory is the project root.
4. Open the deployed URL on your iPhone or computer and upload a file.

## Input formats supported by this starter
- JSON workflow exports with a `WFWorkflowActions` array
- XML plist exports with `WFWorkflowActions`
- JSON with a top-level `actions` array

Binary plist and AEA1 inputs are identified but not decoded.

## Accuracy notes
Action names are mapped for a small set of common Apple identifiers. Unknown identifiers remain visible and are not presented as verified localized Shortcuts display titles. Each action's original dictionary and parameter dictionary are preserved in the downloaded report.

## Suggested next milestone
Add a server-side extraction function backed by a tested implementation of Apple AEA profile 0 + Apple Archive + binary plist parsing. The function should return the parsed workflow JSON to this front end and include decoder/version metadata in its response. Avoid trusting unverified certificates or silently skipping malformed archive entries.
