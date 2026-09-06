# Connection Thinking artwork

Extracted without modification from the user-supplied `ai.json` Lottie template.
Only the two rotating ribbon image assets are included; the original central
spark is replaced with the selected dual-link icon. No external artwork URLs or runtime dependency.

The SVG in `index.html` preserves the 512×512 composition, image order, scale,
position and anchor points. CSS reproduces the two opposite linear rotations:
frames 0–149 at 30 fps, followed by the last-frame hold in the 150-frame loop.
The selected option 01 uses two round-ended links gently joining in a
2.8-second loop. Their original motion is preserved; the middle stroke is removed.
A grayscale/contrast filter adapts the source
blue artwork to the site's monochrome palette without editing the PNGs.

Only the new UI instantiates the SVG. It is shown and animated during connecting,
paused outside that state, and static with reduced motion enabled.
