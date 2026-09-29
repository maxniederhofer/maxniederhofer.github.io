# maxniederhofer.github.io

Personal website of Max Niederhofer — a minimal, single-page landing site built
with [Jekyll](https://jekyllrb.com/) and served by GitHub Pages.

## Editing

The homepage is a single verse in `index.html`. The shared shell and footer
live in `_layouts/default.html`; the footer's social links come from
**`_config.yml`**. All styling is in `assets/css/style.css`: a warm off-white
background (approximately Farrow & Ball Tallow) with Cormorant Garamond, loaded
from Google Fonts. Tweak the CSS custom properties at the top to re-theme.

## Running locally

```sh
bundle install
bundle exec jekyll serve
```

Then open http://localhost:4000. GitHub Pages builds the site automatically on
every push to the default branch — no build step or Actions workflow required.
