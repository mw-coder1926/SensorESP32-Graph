# Some hints

## Download JS to serve locally

``` Shell
curl -L -o vendor/js/lucide.min.js "https://unpkg.com/lucide@latest/dist/umd/lucide.min.js"
curl -L -o vendor/js/supabase.min.js "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/dist/umd/supabase.min.js"
curl -L -o graph/vendor/js/apexcharts.min.js "https://cdn.jsdelivr.net/npm/apexcharts"
```

See also:
<https://www.jsdelivr.com/>

## Use tailwind cli to create minified css

``` Shell
curl -sLO https://github.com/tailwindlabs/tailwindcss/releases/latest/download/tailwindcss-linux-x64
chmod +x tailwindcss-linux-x64
./tailwindcss-linux-x64 -i ./graph/vendor/css/input.css -o ./graph/vendor/css/output.css --minify
```

## Fonts download

Get fonts from:
<https://gwfh.mranftl.com/fonts/inter?subsets=latin>

- choose regular and 600
