---
'ass-html5': patch
---

Scale font sizes using TrueType/OpenType cell metrics (`unitsPerEm / (winAscent + winDescent)`) to match libass font sizing, isolate outline blur from text fill to keep typography crisp, and add standard font fallbacks.
