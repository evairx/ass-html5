---
'ass-html5': patch
---

Refactor to single canvas rendering architecture matching libass/jassub, fix subtitle layer stacking order, authentic font sizing matching FreeType EM box, FontFace weight range and alias matching for bold and condensed typefaces, letter spacing (fsp), dead-center alignment for positioned subtitles, vector drawing bbox alignment, outline blur isolation, flicker-free responsive resizing via synchronous forceRender, and eliminate double-scaling distortion on font aspect ratios and animations (\fscx, \fscy, \frx).
