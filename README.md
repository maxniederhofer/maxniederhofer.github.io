# maxniederhofer.github.io

Personal website of Max Niederhofer — a minimal, single-page landing site built
with [Jekyll](https://jekyllrb.com/) and served by GitHub Pages.

## Editing

The homepage is a single verse in `index.html`. The shared shell and footer
live in `_layouts/default.html`; the footer's social links come from
**`_config.yml`**. All styling is in `assets/css/style.css`: a warm off-white
background (approximately Farrow & Ball Tallow) with Cormorant Garamond, loaded
from Google Fonts. Tweak the CSS custom properties at the top to re-theme.

The background is a canvas texture (`assets/js/letter-wind.js`, started at the
end of `_layouts/default.html`): small monospace letters lit by a drifting wind,
with a ripple wherever the page is clicked. Its two colours are the `--wind-ink`
and `--wind-glow` custom properties in the stylesheet; the script's other knobs
are listed at the top of the file. It stays still for visitors who prefer
reduced motion.

## Running locally

```sh
bundle install
bundle exec jekyll serve
```

Then open http://localhost:4000. GitHub Pages builds the site automatically on
every push to the default branch — no build step or Actions workflow required.
