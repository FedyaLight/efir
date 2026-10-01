# Project website

The public website is [fedyalight.github.io/efir](https://fedyalight.github.io/efir/).
It has static English, Russian, Spanish, Chinese, Hindi and Arabic pages. The
browser app is copied unchanged to `/app/`; native builds still use `web/`.
The existing Netlify app remains independent of this deployment.

Build and preview with Python 3:

```sh
python3 script/build_site.py
python3 -m http.server 8080 --directory work/site
```

Open `http://localhost:8080/`. Output stays in ignored `work/site/`.
Copy updates in `site/messages.json`, layout in `site/template.html` and
`site/style.css`. Release names and URLs are in `script/build_site.py`.
GitHub Actions builds and deploys the site on relevant pushes to `main`.

## Search discovery

Pages contain visible descriptions, installation requirements, FAQs, canonical
URLs, reciprocal language alternatives and SoftwareApplication structured data
with a zero-price offer. There are no invented reviews or ratings. A sitemap
lists the six product pages; session hashes are not search landing pages.

The pages need no JavaScript or external resources. Downloads link directly to
GitHub releases. `llms.txt` is a small factual index for tools that read it;
it is not a requirement or a ranking guarantee for ChatGPT.

OpenAI documents [OAI-SearchBot](https://developers.openai.com/api/docs/bots) as
its search crawler; blocking it prevents inclusion in ChatGPT search answers.
Search access is independent of GPTBot's training controls. The site has no
crawler-specific restrictions.

On GitHub Pages, `/efir/robots.txt` is a project file: crawler rules are read at
the **host root**, `https://fedyalight.github.io/robots.txt`. If a user site later
adds that file, keep this project's paths accessible there. The sitemap can be
submitted to search webmaster tools after verifying ownership. Indexing takes
time and neither search rankings nor ChatGPT recommendations are guaranteed.

Useful references: [Google Search Essentials](https://developers.google.com/search/docs/essentials),
[sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
and [software application markup](https://developers.google.com/search/docs/appearance/structured-data/software-app).
