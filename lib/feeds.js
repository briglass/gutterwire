// RSS feeds the wirebot scans for candidate articles. Add or remove freely;
// each entry just needs to be a public RSS/Atom feed URL.
export const FEEDS = [
  'https://feeds.npr.org/1001/rss.xml', // NPR top stories
  'https://feeds.bbci.co.uk/news/world/rss.xml', // BBC world
  'https://www.theguardian.com/world/rss', // Guardian world
  'https://rss.politico.com/politics-news.xml', // Politico politics
  'https://www.aljazeera.com/xml/rss/all.xml', // Al Jazeera
];

// Articles analyzed per run. Keep modest so a run fits comfortably inside a
// serverless function's time limit (each article costs a fetch + an LLM call).
export const MAX_PER_RUN = 5;
