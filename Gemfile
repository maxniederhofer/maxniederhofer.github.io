source "https://rubygems.org"

# GitHub Pages builds this site natively. The github-pages gem pins Jekyll and
# all whitelisted plugins to the exact versions GitHub Pages runs, so a local
# `bundle exec jekyll serve` matches production. Upgrade with `bundle update`.
gem "github-pages", group: :jekyll_plugins

# Windows and JRuby do not include zoneinfo files, so bundle the tzinfo-data gem
# and associated library.
platforms :mingw, :x64_mingw, :mswin, :jruby do
  gem "tzinfo", ">= 1", "< 3"
  gem "tzinfo-data"
end

# Performance booster for watching directories on Windows.
gem "wdm", "~> 0.1.1", :platforms => [:mingw, :x64_mingw, :mswin]
