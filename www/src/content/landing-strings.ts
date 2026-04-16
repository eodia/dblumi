// www/src/content/landing-strings.ts
// Centralized EN + FR strings for the landing page.
// Every user-facing string in the landing components must come from here.

export type Lang = "en" | "fr";

type NavStrings = {
  features: string;
  docs: string;
  pricing: string;
  blog: string;
  stars: string;
  login: string;
  cta: string;
};

type HeroStrings = {
  badge: string;
  headline: { line1: string; line2: string; line3: string; accent: string };
  lead: string;
  ctaPrimary: string;
  ctaSecondary: string;
  dockerCmd: string;
  mockup: {
    envProd: string;
    filterTables: string;
    tableSectionLabel: string;
    navProject: string;
    navTables: string;
    navSqlEditor: string;
    savedQueriesLabel: string;
    accountName: string;
    accountEmail: string;
    tabSave: string;
    tabRun: string;
    tabCopilot: string;
    statusRows: string;
    statusTime: string;
    sort: string;
    explain: string;
    rowsPerPage: string;
    pageOf: string;
    copilotSubtitle: string;
    emptyPrompt: string;
    pill1: string;
    pill2: string;
    pill3: string;
    pill4: string;
    inputPlaceholder: string;
    animUserQuestion: string;
    animAiIntro: string;
  };
};

type TrustStrings = {
  label: string;
  logos: string[];
  starsText: string;
};

type FeatureSection = {
  label: string;
  headline: string; // use {{accent}} placeholder for the Kalam word
  lead: string; // HTML allowed for <strong>
  bullets: string[];
};

type BentoStrings = {
  eyebrow: string;
  headline: string;
  lead: string;
  cards: {
    rest: { label: string; title: string; desc: string };
    mcp: { label: string; title: string; desc: string };
    selfHosted: { label: string; title: string; desc: string };
    drivers: { label: string; title: string; desc: string };
    erd: { label: string; title: string; desc: string };
    safety: { label: string; title: string; desc: string; levels: string[]; levelActive: string };
    i18n: { label: string; title: string; desc: string };
    hassle: { label: string; title: string; desc: string };
    drawer: { label: string; title: string; desc: string };
    versioning: { label: string; title: string; desc: string };
    game: { label: string; title: string; desc: string; hint: string; score: string };
  };
};

type PricingStrings = {
  headline: string;
  sub: string;
  plans: {
    selfHosted: {
      label: string;
      name: string;
      price: string;
      unit: string;
      desc: string;
      bullets: string[];
      cta: string;
    };
    enterprise: {
      label: string;
      name: string;
      price: string;
      desc: string;
      bullets: string[];
      cta: string;
    };
  };
};

type FaqStrings = {
  title: string;
  items: { q: string; a: string }[];
};

type CtaStrings = {
  headline: { line1: string; line2: string; accent: string };
  sub: string;
  primary: string;
  secondary: string;
};

type FooterStrings = {
  tagline: string;
  columns: {
    product: { title: string; links: { label: string; href: string }[] };
    developers: { title: string; links: { label: string; href: string }[] };
    company: { title: string; links: { label: string; href: string }[] };
    legal: { title: string; links: { label: string; href: string }[] };
  };
  copyright: string;
};

export type LandingStrings = {
  nav: NavStrings;
  hero: HeroStrings;
  trust: TrustStrings;
  write: FeatureSection;
  ask: FeatureSection;
  collab: FeatureSection;
  bento: BentoStrings;
  pricing: PricingStrings;
  faq: FaqStrings;
  cta: CtaStrings;
  footer: FooterStrings;
};

const en: LandingStrings = {
  nav: {
    features: "Features",
    docs: "Docs",
    pricing: "Pricing",
    blog: "Blog",
    stars: "stars",
    login: "Log in",
    cta: "Self-host now",
  },
  hero: {
    badge: "Open source · Self-hosted · Team-ready",
    headline: { line1: "Query,", line2: "Explore,", line3: "Ship.", accent: "Without friction." },
    lead: "The <strong>modern SQL client</strong> built for developer teams. Write safer queries, get <strong>AI-powered suggestions</strong>, and <strong>share</strong> everything with your team.",
    ctaPrimary: "Self-host now",
    ctaSecondary: "Live demo",
    dockerCmd: "docker run -p 5173:5173 eodia/dblumi",
    mockup: {
      envProd: "prod",
      filterTables: "Filter tables…",
      tableSectionLabel: "Tables",
      navProject: "Project Overview",
      navTables: "Tables",
      navSqlEditor: "SQL Editor",
      savedQueriesLabel: "Saved queries",
      accountName: "Marc Jamain",
      accountEmail: "marc@eodia.fr",
      tabSave: "Save",
      tabRun: "Run",
      tabCopilot: "Copilot",
      statusRows: "10 rows",
      statusTime: "51 ms",
      sort: "Sort",
      explain: "Explain",
      rowsPerPage: "Rows per page",
      pageOf: "1–10 of 47",
      copilotSubtitle: "Claude Sonnet",
      emptyPrompt: "Ask me anything about your database. I know your schema.",
      pill1: "Last 10 records",
      pill2: "Count rows per table",
      pill3: "Explain this query",
      pill4: "Generate a realistic dataset",
      inputPlaceholder: "Ask the copilot…",
      animUserQuestion: "Top regions by revenue",
      animAiIntro: "Here's the query for the top regions by revenue:",
    },
  },
  trust: {
    label: "Trusted by developer teams at",
    logos: ["Eodia", "Acme Inc", "Pronext", "Northwind", "Stackforge"],
    starsText: "stars on GitHub",
  },
  write: {
    label: "SQL Editor",
    headline: "Write SQL {{accent}}fluently.",
    lead: "A keyboard-first editor that <strong>knows your schema</strong>. Tab-complete columns, joins, and relationships — then multi-tab across <strong>postgres, mysql, oracle and sqlite</strong> in the same window.",
    bullets: [
      "Schema-aware autocomplete on tables, columns, joins",
      "Multi-tab with per-connection contexts",
      "4 drivers supported — postgres, mysql, oracle, sqlite",
      "CSV import & SQL dump built-in",
    ],
  },
  ask: {
    label: "AI Copilot",
    headline: "Your database {{accent}}talks back.",
    lead: "The copilot <strong>sees your whole schema</strong> — every table, column, relationship — and writes queries that actually run. Bring your own key: <strong>Anthropic, OpenAI, Azure or Ollama</strong>.",
    bullets: [
      "Natural language → working SQL, grounded in your schema",
      "Explain, optimize, or debug any query in-place",
      "BYOK — Claude, GPT, Azure OpenAI, or local Ollama",
      "Your data never leaves your infra",
    ],
  },
  collab: {
    label: "Teamwork",
    headline: "Share queries, not {{accent}}screenshots.",
    lead: "Save any query to your workspace and <strong>share it with the team in one click</strong>. Every edit tracked, every version restorable. Two teammates on the same query? They see <strong>each other's cursors in real time</strong>, powered by Yjs.",
    bullets: [
      "Saved queries with folders, tags and team sharing",
      "Real-time collaboration — see cursors and edits live",
      "Full version history — restore any previous state",
      "Per-connection permissions (read-only, writer, admin)",
    ],
  },
  bento: {
    eyebrow: "Everything else",
    headline: "All the plumbing, {{accent}}included.",
    lead: "REST endpoints, MCP server, self-hosting, 4 drivers, ERD, guardrails and i18n — every feature that matters for a production workflow.",
    cards: {
      rest: {
        label: "REST API",
        title: "Every query is {{accent}}an endpoint.",
        desc: "Turn any saved query into a JSON API with one click. Named parameters, API keys, rate limits — all automatic.",
      },
      mcp: {
        label: "MCP",
        title: "AI agents, {{accent}}native.",
        desc: "Expose your schema as an MCP server. Claude, GPT and any agent query your DB in one line of config.",
      },
      selfHosted: {
        label: "Self-hosted",
        title: "Your infra. {{accent}}Your rules.",
        desc: "Docker Compose in 30 seconds. AGPL-3.0 — every feature, forever free. Your data never leaves your network.",
      },
      drivers: {
        label: "4 drivers",
        title: "One UI, {{accent}}four databases.",
        desc: "Postgres, MySQL, Oracle, SQLite. Switch between flavours without breaking a sweat.",
      },
      erd: {
        label: "Schema ERD",
        title: "See your {{accent}}data model.",
        desc: "Auto-generated diagrams you can drag, export, and share.",
      },
      safety: {
        label: "Guardrails",
        title: "4 safety {{accent}}levels.",
        desc: "From unrestricted dev to fully locked prod.",
        levels: ["L1 · Dev", "L2 · Staging", "L3 · Sensitive", "L4 · Prod"],
        levelActive: "L4 · Prod",
      },
      i18n: {
        label: "i18n",
        title: "Français, {{accent}}English…",
        desc: "Both languages shipped. More coming soon.",
      },
      hassle: {
        label: "One client",
        title: "Say goodbye to {{accent}}the hassle.",
        desc: "Stop juggling pgAdmin, DBeaver, TablePlus and a terminal. One tool, every database.",
      },
      drawer: {
        label: "All-in-one",
        title: "Query, share, {{accent}}done.",
        desc: "Write SQL, save queries, explain plans, serve JSON APIs, speak MCP — all in one unified workspace.",
      },
      versioning: {
        label: "Version history",
        title: "Track every change, {{accent}}restore any version.",
        desc: "Every save creates a version. Browse the full timeline of a query, compare any two versions side by side, and restore a previous version in one click.",
      },
      game: {
        label: "Easter egg",
        title: "See how painful it was {{accent}}before dblumi.",
        desc: "Remember juggling 4 clients, 12 tabs, and a terminal? Us neither. We blocked it out. But we did make a game about it — collect every database before the bugs catch you.",
        hint: "Arrow keys",
        score: "Databases",
      },
    },
  },
  pricing: {
    headline: "One plan. {{accent}}All features.",
    sub: "Self-host for free, forever. Need support or managed hosting? We've got you.",
    plans: {
      selfHosted: {
        label: "Open source",
        name: "Self-hosted",
        price: "€0",
        unit: "/ forever",
        desc: "The full product. Every feature, every driver, no limits. AGPL-3.0.",
        bullets: [
          "Unlimited connections and queries",
          "BYOK for AI copilot (Anthropic, OpenAI, Azure, Ollama)",
          "REST API & MCP server",
          "Real-time collaboration + version history",
          "Community support on GitHub Discussions",
        ],
        cta: "Self-host now",
      },
      enterprise: {
        label: "Need help?",
        name: "Enterprise support",
        price: "Custom",
        desc: "Managed hosting, SLA, prioritized bug fixes and onboarding for your team.",
        bullets: [
          "Managed hosting on your cloud or ours",
          "99.9% SLA with email + chat support",
          "Priority bug fixes and feature requests",
          "Onboarding workshop for your team",
        ],
        cta: "Contact sales",
      },
    },
  },
  faq: {
    title: "Frequently asked questions",
    items: [
      {
        q: "Can I use dblumi with my production database?",
        a: "Yes. dblumi ships with 4 configurable safety levels — from unrestricted dev DBs to fully locked prod. Destructive queries are detected before they run, and every action can be scoped by user role.",
      },
      {
        q: "Does my data leave my infrastructure?",
        a: "No. dblumi is self-hosted, and the AI copilot uses your own API key (Anthropic, OpenAI, Azure, or local Ollama). Your queries, results, and schema never leave your network.",
      },
      {
        q: "Which AI providers are supported?",
        a: "Anthropic Claude, OpenAI, Azure OpenAI, and local Ollama. Bring your own API key — we never proxy requests through our servers.",
      },
      {
        q: "How does the MCP server work?",
        a: "Run the bundled MCP server binary and add it to any MCP-compatible client (Claude Desktop, etc.) in one line of config. It exposes list_tables, describe_schema, run_query, and explain_query as native tools any AI agent can call.",
      },
      {
        q: "Is there a hosted version?",
        a: "Not officially. The Enterprise support plan includes managed hosting on request — contact us if that's what you need.",
      },
      {
        q: "What's the difference between dblumi and pgAdmin / DBeaver?",
        a: "Three things: a schema-aware AI copilot, real-time team collaboration with version history, and native REST + MCP exposure for your queries. Plus a modern web UI that works on any device without install.",
      },
    ],
  },
  cta: {
    headline: { line1: "Write SQL", line2: "Starting today.", accent: "better." },
    sub: "Self-host in 30 seconds. AGPL-3.0, every feature included, forever free.",
    primary: "Self-host now",
    secondary: "Live demo",
  },
  footer: {
    tagline: "The open source SQL client with AI copilot. Built in France by Eodia.",
    columns: {
      product: {
        title: "Product",
        links: [
          { label: "Features", href: "#features" },
          { label: "Pricing", href: "#pricing" },
          { label: "Changelog", href: "/changelog/" },
          { label: "Roadmap", href: "/roadmap/" },
        ],
      },
      developers: {
        title: "Developers",
        links: [
          { label: "Docs", href: "/guides/introduction/" },
          { label: "API reference", href: "/api-docs/" },
          { label: "MCP server", href: "/guides/mcp/" },
          { label: "GitHub", href: "https://github.com/eodia/dblumi" },
        ],
      },
      company: {
        title: "Company",
        links: [
          { label: "About", href: "https://eodia.com" },
          { label: "Blog", href: "/blog/" },
          { label: "Contact", href: "mailto:hello@dblumi.dev" },
        ],
      },
      legal: {
        title: "Legal",
        links: [
          { label: "Privacy", href: "/privacy/" },
          { label: "Terms", href: "/terms/" },
          { label: "AGPL-3.0 license", href: "https://github.com/eodia/dblumi/blob/main/LICENSE" },
        ],
      },
    },
    copyright: "© 2026 Eodia · Made with ❤ in France",
  },
};

const fr: LandingStrings = {
  nav: {
    features: "Fonctionnalités",
    docs: "Docs",
    pricing: "Tarifs",
    blog: "Blog",
    stars: "étoiles",
    login: "Connexion",
    cta: "Héberger maintenant",
  },
  hero: {
    badge: "Open source · Auto-hébergé · Prêt pour les équipes",
    headline: { line1: "Query,", line2: "Explore,", line3: "Ship.", accent: "Sans friction." },
    lead: "Le <strong>client SQL moderne</strong> pensé pour les équipes de développement. Écris des requêtes plus sûres, profite des <strong>suggestions de l'IA</strong>, et <strong>partage</strong> tout avec ton équipe.",
    ctaPrimary: "Héberger maintenant",
    ctaSecondary: "Démo live",
    dockerCmd: "docker run -p 5173:5173 eodia/dblumi",
    mockup: {
      envProd: "prod",
      filterTables: "Filtrer les tables…",
      tableSectionLabel: "Tables",
      navProject: "Vue projet",
      navTables: "Tables",
      navSqlEditor: "Éditeur SQL",
      savedQueriesLabel: "Requêtes sauvegardées",
      accountName: "Marc Jamain",
      accountEmail: "marc@eodia.fr",
      tabSave: "Sauvegarder",
      tabRun: "Exécuter",
      tabCopilot: "Copilot",
      statusRows: "10 lignes",
      statusTime: "51 ms",
      sort: "Trier",
      explain: "Expliquer",
      rowsPerPage: "Lignes par page",
      pageOf: "1–10 sur 47",
      copilotSubtitle: "Claude Sonnet",
      emptyPrompt: "Demandez-moi n'importe quoi sur votre base de données. Je connais votre schéma.",
      pill1: "Les 10 derniers enregistrements",
      pill2: "Compter les lignes par table",
      pill3: "Expliquer cette requête",
      pill4: "Génère-moi un jeu de données réaliste",
      inputPlaceholder: "Demandez au copilot…",
      animUserQuestion: "Top régions par revenu",
      animAiIntro: "Voici la requête pour les top régions par revenu :",
    },
  },
  trust: {
    label: "Utilisé par les équipes dev chez",
    logos: ["Eodia", "Acme Inc", "Pronext", "Northwind", "Stackforge"],
    starsText: "étoiles sur GitHub",
  },
  write: {
    label: "Éditeur SQL",
    headline: "Écris du SQL {{accent}}couramment.",
    lead: "Un éditeur clavier d'abord qui <strong>connaît ton schéma</strong>. Autocomplétion sur les colonnes, jointures et relations — et multi-onglets sur <strong>postgres, mysql, oracle et sqlite</strong> dans la même fenêtre.",
    bullets: [
      "Autocomplétion schema-aware sur tables, colonnes et jointures",
      "Multi-onglets avec contextes par connexion",
      "4 drivers supportés — postgres, mysql, oracle, sqlite",
      "Import CSV et dump SQL inclus",
    ],
  },
  ask: {
    label: "Copilot IA",
    headline: "Ta base de données {{accent}}te répond.",
    lead: "Le copilot <strong>voit tout ton schéma</strong> — chaque table, colonne, relation — et écrit des requêtes qui tournent vraiment. Ta clé, ton IA : <strong>Anthropic, OpenAI, Azure ou Ollama</strong>.",
    bullets: [
      "Langage naturel → SQL qui fonctionne, grounded sur ton schéma",
      "Explique, optimise ou débogue n'importe quelle requête sur place",
      "BYOK — Claude, GPT, Azure OpenAI, ou Ollama local",
      "Tes données ne quittent jamais ton infra",
    ],
  },
  collab: {
    label: "Équipe",
    headline: "Partage des requêtes, pas {{accent}}des captures.",
    lead: "Sauvegarde n'importe quelle requête dans ton workspace et <strong>partage-la avec ton équipe en un clic</strong>. Chaque édition tracée, chaque version restaurable. Deux coéquipiers sur la même requête ? Ils voient <strong>les curseurs des autres en temps réel</strong>, propulsé par Yjs.",
    bullets: [
      "Requêtes sauvegardées avec dossiers, tags et partage équipe",
      "Collaboration temps réel — curseurs et édits visibles",
      "Historique complet — restaure n'importe quelle version",
      "Permissions par connexion (lecture seule, éditeur, admin)",
    ],
  },
  bento: {
    eyebrow: "Tout le reste",
    headline: "Toute la plomberie, {{accent}}incluse.",
    lead: "REST endpoints, serveur MCP, auto-hébergement, 4 drivers, ERD, guardrails et i18n — toutes les features qui comptent pour un workflow de production.",
    cards: {
      rest: {
        label: "REST API",
        title: "Chaque requête est {{accent}}un endpoint.",
        desc: "Transforme n'importe quelle requête sauvegardée en API JSON en un clic. Paramètres nommés, clés API, rate limits — tout automatique.",
      },
      mcp: {
        label: "MCP",
        title: "Agents IA, {{accent}}natif.",
        desc: "Expose ton schéma comme serveur MCP. Claude, GPT et n'importe quel agent interroge ta DB en une ligne de config.",
      },
      selfHosted: {
        label: "Auto-hébergé",
        title: "Ton infra. {{accent}}Tes règles.",
        desc: "Docker Compose en 30 secondes. AGPL-3.0 — toutes les features, gratuit à jamais. Tes données ne quittent jamais ton réseau.",
      },
      drivers: {
        label: "4 drivers",
        title: "Une UI, {{accent}}quatre bases.",
        desc: "Postgres, MySQL, Oracle, SQLite. Passe d'une saveur à l'autre sans broncher.",
      },
      erd: {
        label: "Schéma ERD",
        title: "Vois ton {{accent}}modèle de données.",
        desc: "Diagrammes générés automatiquement que tu peux glisser, exporter et partager.",
      },
      safety: {
        label: "Guardrails",
        title: "4 niveaux {{accent}}de sécurité.",
        desc: "Du dev non restreint à la prod verrouillée.",
        levels: ["N1 · Dev", "N2 · Staging", "N3 · Sensible", "N4 · Prod"],
        levelActive: "N4 · Prod",
      },
      i18n: {
        label: "i18n",
        title: "Français, {{accent}}English…",
        desc: "Les deux langues sont livrées. D'autres arrivent bientôt.",
      },
      hassle: {
        label: "Un seul outil",
        title: "Dis adieu à {{accent}}la galère.",
        desc: "Plus besoin de jongler entre pgAdmin, DBeaver, TablePlus et un terminal. Un seul outil, toutes les bases.",
      },
      drawer: {
        label: "Tout-en-un",
        title: "Écris, partage, {{accent}}exécute.",
        desc: "Rédige du SQL, sauvegarde, explain plans, sers des API JSON, parle MCP — tout dans un workspace unifié.",
      },
      versioning: {
        label: "Historique",
        title: "Chaque modif tracée, {{accent}}chaque version restaurable.",
        desc: "Chaque sauvegarde crée une version. Parcours la timeline complète d'une requête, compare deux versions côte à côte, et restaure une version précédente en un clic.",
      },
      game: {
        label: "Easter egg",
        title: "Revivez l'enfer d'{{accent}}avant dblumi.",
        desc: "4 clients, 12 onglets, un terminal qui plante et des erreurs SQL inexplicables. On a refoulé ces souvenirs. Mais on en a quand même fait un jeu — récupère toutes tes bases avant que les bugs ne t'attrapent.",
        hint: "Flèches",
        score: "Bases",
      },
    },
  },
  pricing: {
    headline: "Un plan. {{accent}}Toutes les features.",
    sub: "Héberge gratuitement, à jamais. Besoin de support ou d'un hébergement managé ? On est là.",
    plans: {
      selfHosted: {
        label: "Open source",
        name: "Auto-hébergé",
        price: "0 €",
        unit: "/ à jamais",
        desc: "Le produit complet. Toutes les features, tous les drivers, aucune limite. AGPL-3.0.",
        bullets: [
          "Connexions et requêtes illimitées",
          "BYOK pour le copilot IA (Anthropic, OpenAI, Azure, Ollama)",
          "REST API et serveur MCP",
          "Collaboration temps réel + historique",
          "Support communautaire sur GitHub Discussions",
        ],
        cta: "Héberger maintenant",
      },
      enterprise: {
        label: "Besoin d'aide ?",
        name: "Support entreprise",
        price: "Sur mesure",
        desc: "Hébergement managé, SLA, corrections priorisées et onboarding pour ton équipe.",
        bullets: [
          "Hébergement managé sur ton cloud ou le nôtre",
          "SLA 99,9 % avec support email + chat",
          "Corrections de bugs et features priorisées",
          "Atelier d'onboarding pour ton équipe",
        ],
        cta: "Contacter les ventes",
      },
    },
  },
  faq: {
    title: "Questions fréquentes",
    items: [
      {
        q: "Puis-je utiliser dblumi avec ma base de données de production ?",
        a: "Oui. dblumi inclut 4 niveaux de sécurité configurables — du dev non restreint à la prod verrouillée. Les requêtes destructives sont détectées avant exécution, et chaque action peut être restreinte par rôle utilisateur.",
      },
      {
        q: "Mes données quittent-elles mon infrastructure ?",
        a: "Non. dblumi est auto-hébergé, et le copilot IA utilise ta propre clé API (Anthropic, OpenAI, Azure, ou Ollama local). Tes requêtes, résultats et schéma ne quittent jamais ton réseau.",
      },
      {
        q: "Quels fournisseurs d'IA sont supportés ?",
        a: "Anthropic Claude, OpenAI, Azure OpenAI, et Ollama local. Tu apportes ta clé — on ne proxy jamais les requêtes par nos serveurs.",
      },
      {
        q: "Comment fonctionne le serveur MCP ?",
        a: "Lance le binaire MCP fourni et ajoute-le à n'importe quel client compatible MCP (Claude Desktop, etc.) en une ligne de config. Il expose list_tables, describe_schema, run_query et explain_query comme outils natifs que n'importe quel agent IA peut appeler.",
      },
      {
        q: "Y a-t-il une version hébergée ?",
        a: "Pas officiellement. Le plan Support entreprise inclut un hébergement managé sur demande — contacte-nous si c'est ce qu'il te faut.",
      },
      {
        q: "Quelle est la différence entre dblumi et pgAdmin / DBeaver ?",
        a: "Trois choses : un copilot IA qui connaît ton schéma, de la collaboration temps réel avec historique, et une exposition native REST + MCP pour tes requêtes. Plus une UI web moderne qui marche sur n'importe quel device sans installation.",
      },
    ],
  },
  cta: {
    headline: { line1: "Écris du SQL", line2: "Dès aujourd'hui.", accent: "mieux." },
    sub: "Auto-hébergé en 30 secondes. AGPL-3.0, toutes les features incluses, gratuit à jamais.",
    primary: "Héberger maintenant",
    secondary: "Démo live",
  },
  footer: {
    tagline: "Le client SQL open source avec copilot IA. Fait en France par Eodia.",
    columns: {
      product: {
        title: "Produit",
        links: [
          { label: "Fonctionnalités", href: "#features" },
          { label: "Tarifs", href: "#pricing" },
          { label: "Changelog", href: "/fr/changelog/" },
          { label: "Roadmap", href: "/fr/roadmap/" },
        ],
      },
      developers: {
        title: "Développeurs",
        links: [
          { label: "Docs", href: "/fr/guides/introduction/" },
          { label: "Référence API", href: "/api-docs/" },
          { label: "Serveur MCP", href: "/fr/guides/mcp/" },
          { label: "GitHub", href: "https://github.com/eodia/dblumi" },
        ],
      },
      company: {
        title: "Entreprise",
        links: [
          { label: "À propos", href: "https://eodia.com" },
          { label: "Blog", href: "/fr/blog/" },
          { label: "Contact", href: "mailto:hello@dblumi.dev" },
        ],
      },
      legal: {
        title: "Légal",
        links: [
          { label: "Confidentialité", href: "/fr/privacy/" },
          { label: "Conditions", href: "/fr/terms/" },
          { label: "Licence AGPL-3.0", href: "https://github.com/eodia/dblumi/blob/main/LICENSE" },
        ],
      },
    },
    copyright: "© 2026 Eodia · Fait avec ❤ en France",
  },
};

export const strings: Record<Lang, LandingStrings> = { en, fr };
