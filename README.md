# maxniederhofer.github.io

Personal website of Max Niederhofer — a minimal, single-page landing site built
with [Jekyll](https://jekyllrb.com/) and served by GitHub Pages.

## Editing

Most changes are made in **`_config.yml`** — name, tagline, intro text, and the
social links shown on the homepage all live there. The page markup is in
`index.html`, the shared shell in `_layouts/default.html`, and all styling in
`assets/css/style.css` (light/dark aware; tweak the CSS custom properties at the
top to re-theme).

## Running locally

```sh
bundle install
bundle exec jekyll serve
```

Then open http://localhost:4000. GitHub Pages builds the site automatically on
every push to the default branch — no build step or Actions workflow required.
